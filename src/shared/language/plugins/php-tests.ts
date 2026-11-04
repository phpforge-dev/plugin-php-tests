import { CompletionKind, type CodeCompletion, type CodeSite, type IdePlugin, type PluginCompletion, type PluginLocation, type ProjectFiles, type StringSite } from './api';
import { isTestFile, type TestFramework } from '../php-tests';
import { datasetsIn, expectChain, expectationMembers, expectationType, visibleDatasets, type Chain } from '../pest';
import { classMembers, customExpectations, pestSources, testCaseClasses, typeOf, type Source } from '../pest-context';
import { codeOnly, position } from '../php-source';

/** Argumento do comando `php-ide.runTests`: arquivo relativo, filtro (vazio = arquivo inteiro) e rótulo do painel. */
export type TestRunRequest = { framework: TestFramework; path: string; filter: string; label: string };
const packages: Record<TestFramework, string> = { pest: 'pestphp/pest', phpunit: 'phpunit/phpunit' };
type Hover = { contents: string; range?: { start: { line: number; character: number }; end: { line: number; character: number } } };

/**
 * Pest e PHPUnit: detecta o runner pelo `composer.json` (ou `vendor/bin`) e mostra a versão
 * instalada do `composer.lock`. As ações de executar ficam no gutter (módulo de workbench), como
 * na referência; aqui ficam completar/ir para datasets do Pest e o tipo de `expect()`.
 */
export class PhpTestsPlugin implements IdePlugin {
 readonly id = 'php-tests';
 name = 'PHPUnit';
 framework: TestFramework = 'phpunit';
 documents(path: string) { return isTestFile(path) || /(^|\/)tests\/(Pest\.php$|Datasets\/)/.test(path); }

 async detect(files: ProjectFiles) {
  const json = await files.read('composer.json').then(t => t ? JSON.parse(t) : {}).catch(() => ({}));
  const declared = (pkg: string) => !!(json.require?.[pkg] ?? json['require-dev']?.[pkg]);
  const has = async (framework: TestFramework) => declared(packages[framework]) || await files.exists(`vendor/bin/${framework}`);
  const framework: TestFramework | null = await has('pest') ? 'pest' : await has('phpunit') ? 'phpunit' : null;
  if (!framework) return null;
  this.framework = framework; this.name = framework === 'pest' ? 'Pest' : 'PHPUnit';
  const lock = await files.read('composer.lock').then(t => t ? JSON.parse(t) : null).catch(() => null);
  const installed = [...(lock?.packages ?? []), ...(lock?.['packages-dev'] ?? [])].find((p: { name?: string }) => p.name === packages[framework]);
  const version = installed?.version?.replace(/^v/, '') ?? (json.require?.[packages[framework]] ?? json['require-dev']?.[packages[framework]]);
  return version ? { version } : {};
 }

 /** `->with('…')` (qualquer argumento) em teste Pest. */
 private datasetSite(site: StringSite) { return this.framework === 'pest' && /^->with$/.test(site.callee) && isTestFile(site.path); }

 async completeString(site: StringSite, files: ProjectFiles): Promise<PluginCompletion[] | null> {
  if (!this.datasetSite(site)) return null;
  const seen = new Set<string>();
  return (await visibleDatasets(site.path, site.text, files)).filter(d => !seen.has(d.name) && seen.add(d.name))
   .map(d => ({ label: d.name, kind: CompletionKind.Value, detail: d.path, labelDetails: { description: d.shared ? d.path.split('/').pop() : 'dataset local' } }));
 }

 async defineString(site: StringSite, files: ProjectFiles): Promise<PluginLocation[] | null> {
  if (!this.datasetSite(site)) return null;
  const name = site.literal.value;
  const found = (await visibleDatasets(site.path, site.text, files)).filter(d => d.name === name);
  if (!found.length) return [];
  // O dataset local tem prioridade sobre o compartilhado de mesmo nome.
  const best = found.filter(d => d.path === site.path).length ? found.filter(d => d.path === site.path) : found;
  return Promise.all(best.map(async d => {
   const text = d.path === site.path ? site.text : await files.read(d.path) ?? '';
   return { uri: files.uri(d.path), range: { start: position(text, d.offset), end: position(text, d.end) } };
  }));
 }

 /** Tipo do valor da cadeia, inclusive retorno de chamadas e `$this` de `uses()->in()`. */
 private async valueType(chain: Chain, site: CodeSite, files: ProjectFiles, sources: Source[]): Promise<string> {
  const deep = await typeOf({ path: site.path, text: chain.source, files, sources }, chain.tokens, chain.span[0], chain.span[1]).catch(() => 'mixed');
  return deep !== 'mixed' ? deep : chain.valueType;
 }

 /**
  * Depois de `expect(…)->`: métodos da expectativa (do pacote em vendor/ e os de `expect()->extend`),
  * `not`/`each`/`and` e membros do valor (higher order). Depois de `$this->` num teste Pest: membros da
  * classe ligada por `uses()`/`pest()->extend()->in()` (observado no PhpStorm 2026.1.4).
  */
 async completeCode(site: CodeSite, files: ProjectFiles): Promise<CodeCompletion | null> {
  if (this.framework !== 'pest' || !isTestFile(site.path)) return null;
  const chain = expectChain(site.text, site.offset);
  if (!chain) return this.completeThis(site, files);
  const sources = await pestSources(files);
  chain.valueType = await this.valueType(chain, site, files, sources);
  const type = expectationType(chain);
  const items: CodeCompletion['items'] = [];
  if (!chain.higherOrder) {
   const seen = new Set<string>();
   for (const m of await expectationMembers(files)) {
    if (chain.negated && ['not', 'and', 'each'].includes(m.name)) continue;
    seen.add(m.name);
    items.push({ label: m.name, kind: m.kind === 'method' ? CompletionKind.Method : CompletionKind.Property, insertText: m.kind === 'method' ? `${m.name}(` : m.name, detail: m.doc, labelDetails: { detail: m.kind === 'method' ? m.signature.slice(m.name.length) : '', description: m.name === 'and' ? 'Expectation' : m.returns === 'self' || m.returns === 'static' ? type : m.returns } });
   }
   // Expectativas customizadas: `expect()->extend('nome', function (...) {...})`.
   for (const e of [...sources, { path: site.path, text: site.text }].flatMap(src => customExpectations(src.path, src.text))) {
    if (seen.has(e.name)) continue; seen.add(e.name);
    items.push({ label: e.name, kind: CompletionKind.Method, insertText: `${e.name}(`, detail: `expect()->extend('${e.name}') · ${e.path}`, labelDetails: { detail: `(${e.params})`, description: type } });
   }
  }
  // Higher order expectations: propriedades/métodos públicos do objeto testado.
  if (!chain.each && /\\|^[A-Z]/.test(chain.valueType) && !chain.higherOrder) {
   for (const m of (await classMembers(chain.valueType, files)).filter(m => m.visibility === 'public' && !m.static)) items.push({ label: m.name, kind: m.kind === 'method' ? CompletionKind.Method : CompletionKind.Property, insertText: m.kind === 'method' ? `${m.name}(` : m.name, detail: `${m.owner}::${m.kind === 'method' ? `${m.name}(${m.params})` : '$' + m.name}`, labelDetails: { detail: m.kind === 'method' ? `(${m.params})` : '', description: `→ Expectation<${m.returns}>` } });
  }
  if (!items.length) return null;
  return { from: chain.from, items };
 }

 /** `$this->` dentro de um arquivo de teste Pest: membros das classes de `uses()->in()`. */
 private async completeThis(site: CodeSite, files: ProjectFiles): Promise<CodeCompletion | null> {
  const before = site.text.slice(0, site.offset);
  const m = /\$this\s*->\s*(\w*)$/.exec(before);
  if (!m || !/->\s*\w*$/.test(codeOnly(before))) return null;
  const sources = await pestSources(files);
  const classes = testCaseClasses(site.path, site.text, sources);
  const items: CodeCompletion['items'] = []; const seen = new Set<string>();
  for (const fqn of classes) for (const member of await classMembers(fqn, files)) {
   if (member.static || seen.has(member.kind + member.name)) continue; seen.add(member.kind + member.name);
   items.push({ label: member.name, kind: member.kind === 'method' ? CompletionKind.Method : CompletionKind.Property, insertText: member.kind === 'method' ? `${member.name}(` : member.name, detail: `${member.owner}::${member.name}`, labelDetails: { detail: member.kind === 'method' ? `(${member.params})` : '', description: member.returns } });
  }
  return items.length ? { from: site.offset - m[1].length, items } : null;
 }

 /** Ir para a declaração de uma expectativa customizada (`->toBeOne(` → `expect()->extend('toBeOne', …)`). */
 async defineCode(site: CodeSite, files: ProjectFiles): Promise<PluginLocation[] | null> {
  if (this.framework !== 'pest' || !isTestFile(site.path)) return null;
  const left = /\w*$/.exec(site.text.slice(0, site.offset))![0]; const right = /^\w*/.exec(site.text.slice(site.offset))![0];
  const name = left + right; const start = site.offset - left.length;
  if (!name || !/->\s*$/.test(site.text.slice(0, start)) || site.text[start + name.length] !== '(') return null;
  const sources = await pestSources(files);
  const found = [...customExpectations(site.path, site.text).map(e => ({ e, text: site.text })), ...sources.flatMap(src => customExpectations(src.path, src.text).map(e => ({ e, text: src.text })))].filter(x => x.e.name === name);
  if (!found.length) return null;
  return found.map(({ e, text }) => ({ uri: files.uri(e.path), range: { start: position(text, e.offset), end: position(text, e.end) } }));
 }

 /** Hover em `expect` mostra o tipo da expectativa criada. */
 async hover(site: CodeSite, files?: ProjectFiles): Promise<Hover | null> {
  if (this.framework !== 'pest' || !isTestFile(site.path)) return null;
  const at = /\bexpect\s*\(/g; let m: RegExpExecArray | null;
  while ((m = at.exec(site.text))) {
   if (site.offset < m.index || site.offset > m.index + 6) continue;
   let depth = 0, i = m.index + m[0].length - 1;
   for (; i < site.text.length; i++) { const c = site.text[i]; if (c === '(') depth++; else if (c === ')' && !--depth) break; }
   const chain = expectChain(site.text.slice(0, i + 1) + '->', i + 3);
   if (!chain) return null;
   if (files) chain.valueType = await this.valueType(chain, site, files, await pestSources(files));
   return { contents: '```php\n' + `function expect(mixed $value): ${expectationType(chain)}` + '\n```', range: { start: position(site.text, m.index), end: position(site.text, m.index + 6) } };
  }
  return null;
 }

 /** Os datasets são relidos a cada pedido; nada a invalidar além do cache do vendor. */
 invalidates(path: string) { return path.startsWith('vendor/pestphp/') || datasetsIn(path, '').length > 0; }
}
