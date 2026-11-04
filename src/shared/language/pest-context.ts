// Contexto Pest além do arquivo de teste: `uses(...)->in(...)`/`pest()->extend(...)->in(...)`,
// expectativas customizadas (`expect()->extend('nome', fn)`) e funções globais de `tests/Pest.php`,
// e a inferência do tipo de expressões com chamadas (`formatter()`, `$this->currency()`,
// `(new Table())->rate(...)`). Implementado a partir da documentação pública do Pest (Configuring
// Tests, Custom Expectations, Global Functions) e de observação do PhpStorm 2026.1.4; não reproduz o
// plugin Pest da JetBrains.
import { analyze, namespaceAt, phpTokens, type PhpToken } from './php-source';
import type { ProjectFiles } from './plugins/api';

export type Source = { path: string; text: string };
/** Classes (e traits) ligadas a pastas de `tests/` por `uses()`/`pest()->extend()->in()`. */
export type UsesRule = { classes: string[]; dirs: string[]; path: string };
export type CustomExpectation = { name: string; params: string; path: string; offset: number; end: number };
export type GlobalFunction = { name: string; params: string; returns: string; path: string; offset: number };
export type ClassMember = { name: string; kind: 'method' | 'property'; params: string; returns: string; visibility: 'public' | 'protected'; static: boolean; owner: string };

const scalar = new Set(['int', 'float', 'string', 'bool', 'array', 'mixed', 'null', 'void', 'callable', 'iterable', 'object', 'never', 'false', 'true']);
/** Nome de classe como escrito no arquivo → FQN pelos `use`/namespace do arquivo. */
export function resolveName(text: string, name: string, offset: number, self?: string): string {
 const clean = name.replace(/^\?/, '');
 const lower = clean.toLowerCase();
 if (scalar.has(lower)) return lower;
 if ((lower === 'self' || lower === 'static' || lower === '$this') && self) return self;
 if (clean.startsWith('\\')) return clean.slice(1);
 const context = analyze(text);
 const [head, ...rest] = clean.split('\\');
 const imported = context.imports.find(i => i.alias === head);
 if (imported) return [imported.fqn, ...rest].join('\\');
 const ns = namespaceAt(context, offset);
 return ns ? `${ns}\\${clean}` : clean;
}
/** Tipo declarado (`?A|B`) → o primeiro tipo não nulo, resolvido. */
const declared = (text: string, type: string | undefined, offset: number, self?: string) => {
 if (!type) return 'mixed';
 const first = type.replace(/^\?/, '').split('|').map(t => t.trim()).find(t => t && t.toLowerCase() !== 'null') ?? 'mixed';
 return resolveName(text, first, offset, self);
};

const matching = (tokens: PhpToken[], open: number) => { let depth = 0; for (let i = open; i < tokens.length; i++) { const v = tokens[i].value; if (tokens[i].type !== 'punct') continue; if (v === '(' || v === '[' || v === '{') depth++; else if (v === ')' || v === ']' || v === '}') { depth--; if (!depth) return i; } } return tokens.length - 1; };
/** Argumentos `A::class` (nomes qualificados) entre `open` e o parêntese correspondente. */
function classArgs(text: string, tokens: PhpToken[], open: number): string[] {
 const close = matching(tokens, open); const out: string[] = [];
 for (let i = open + 1; i < close; i++) {
  if (tokens[i].value !== '::' || tokens[i + 1]?.value !== 'class') continue;
  let j = i - 1; let name = '';
  while (j > open && (tokens[j].type === 'word' || tokens[j].value === '\\')) { name = tokens[j].value + name; j--; }
  if (name) out.push(resolveName(text, name, tokens[i].offset));
 }
 return out;
}
const stringArgs = (tokens: PhpToken[], open: number) => { const close = matching(tokens, open); return tokens.slice(open + 1, close).filter(t => t.type === 'string').map(t => t.value); };

/** `uses(A::class)->in('Feature')`, `pest()->extend(A::class)->use(B::class)->in('Unit')`; sem `in`, vale para o próprio arquivo. */
export function usesRules(path: string, text: string): UsesRule[] {
 const tokens = phpTokens(text); const out: UsesRule[] = [];
 const base = path.split('/').slice(0, -1).join('/');
 for (let i = 0; i < tokens.length - 1; i++) {
  const t = tokens[i]; const prev = tokens[i - 1]?.value;
  if (t.type !== 'word' || !['uses', 'pest'].includes(t.value) || prev === '->' || prev === '::' || prev === 'function' || tokens[i + 1].value !== '(') continue;
  const classes = t.value === 'uses' ? classArgs(text, tokens, i + 1) : [];
  let j = matching(tokens, i + 1) + 1; let dirs: string[] | undefined;
  while (tokens[j]?.value === '->' && tokens[j + 1]?.type === 'word' && tokens[j + 2]?.value === '(') {
   const name = tokens[j + 1].value;
   if (name === 'extend' || name === 'use' || name === 'uses') classes.push(...classArgs(text, tokens, j + 2));
   if (name === 'in') dirs = stringArgs(tokens, j + 2).map(d => d === '.' || d === '' ? base : `${base}/${d.replace(/^\.\//, '').replace(/\/$/, '')}`);
   j = matching(tokens, j + 2) + 1;
  }
  if (classes.length) out.push({ classes, dirs: dirs ?? [path], path });
  i = j - 1;
 }
 return out;
}

/** `expect()->extend('nome', function (params) {...})` (também `fn`). */
export function customExpectations(path: string, text: string): CustomExpectation[] {
 const tokens = phpTokens(text); const out: CustomExpectation[] = [];
 for (let i = 0; i < tokens.length - 8; i++) {
  if (tokens[i].value !== 'expect' || tokens[i + 1].value !== '(' || tokens[i + 2].value !== ')' || tokens[i + 3].value !== '->' || tokens[i + 4].value !== 'extend' || tokens[i + 5].value !== '(' || tokens[i + 6].type !== 'string') continue;
  const name = tokens[i + 6]; let k = i + 7; while (k < tokens.length && tokens[k].value !== 'function' && tokens[k].value !== 'fn') k++;
  let params = '';
  if (tokens[k + 1]?.value === '(') { const close = matching(tokens, k + 1); params = text.slice(tokens[k + 1].offset + 1, tokens[close].offset).replace(/\s+/g, ' ').trim(); }
  out.push({ name: name.value, params, path, offset: name.offset, end: name.offset + name.value.length + 2 });
 }
 return out;
}

/** Funções globais declaradas no arquivo (fora de classes), com tipo de retorno resolvido. */
export function functionsIn(path: string, text: string): GlobalFunction[] {
 const out: GlobalFunction[] = [];
 for (const m of text.matchAll(/(?:^|\n)[ \t]*function\s+(\w+)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*(?::\s*([?\\\w|]+))?/g)) {
  const offset = m.index! + m[0].indexOf('function');
  out.push({ name: m[1], params: m[2].replace(/\s+/g, ' ').trim(), returns: declared(text, m[3], offset), path, offset: offset + m[0].slice(m[0].indexOf('function')).indexOf(m[1]) });
 }
 return out;
}

/** `tests/Pest.php` e os demais PHP de `tests/` que não são testes nem datasets (helpers, expectativas). */
export async function pestSources(files: ProjectFiles): Promise<Source[]> {
 const listed = await files.list('tests', n => n.endsWith('.php')).catch(() => [] as string[]);
 const paths = listed.map(p => p.startsWith('tests/') ? p : `tests/${p}`).filter(p => p === 'tests/Pest.php' || (!/Test\.php$/.test(p) && !/^tests\/Datasets\//.test(p))).slice(0, 40);
 if (!paths.includes('tests/Pest.php') && await files.exists('tests/Pest.php')) paths.unshift('tests/Pest.php');
 return (await Promise.all(paths.map(async path => ({ path, text: await files.read(path).catch(() => null) ?? '' })))).filter(s => s.text);
}

/** Classes cujo `$this` vale dentro das closures do arquivo de teste (a mais específica primeiro). */
export function testCaseClasses(path: string, text: string, sources: Source[]): string[] {
 const rules = [...sources.flatMap(s => usesRules(s.path, s.text)), ...usesRules(path, text)];
 const hits = rules.filter(r => r.dirs.some(d => path === d || path.startsWith(d + '/'))).sort((a, b) => Math.max(...b.dirs.map(d => d.length)) - Math.max(...a.dirs.map(d => d.length)));
 return [...new Set(hits.flatMap(r => r.classes))];
}

/** Arquivo de uma classe pelo autoload PSR-4 do composer.json (projeto). */
export async function classFile(fqn: string, files: ProjectFiles): Promise<string | null> {
 const json = await files.read('composer.json').then(t => t ? JSON.parse(t) : {}).catch(() => ({}));
 const maps = { ...(json.autoload?.['psr-4'] ?? {}), ...(json['autoload-dev']?.['psr-4'] ?? {}) } as Record<string, string | string[]>;
 for (const [prefix, dirs] of Object.entries(maps).sort((a, b) => b[0].length - a[0].length)) {
  if (!fqn.startsWith(prefix)) continue;
  for (const dir of [dirs].flat()) { const path = `${dir.replace(/\/$/, '')}/${fqn.slice(prefix.length).replace(/\\/g, '/')}.php`.replace(/^\.\//, ''); if (await files.exists(path)) return path; }
 }
 return null;
}

/** Métodos e propriedades públicos/protegidos de uma classe do projeto e de seus pais/traits no projeto. */
export async function classMembers(fqn: string, files: ProjectFiles, seen = new Set<string>()): Promise<ClassMember[]> {
 if (seen.has(fqn) || seen.size > 8) return []; seen.add(fqn);
 const path = await classFile(fqn, files); const text = path ? await files.read(path).catch(() => null) : null;
 if (!text) return [];
 const out: ClassMember[] = [];
 for (const m of text.matchAll(/(?:^|[;{}\s])((?:(?:public|protected|private|static|final|abstract)\s+)*)function\s+&?(\w+)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*(?::\s*([?\\\w|]+))?/g)) {
  const mods = m[1]; if (/private/.test(mods) || m[2].startsWith('__')) continue;
  out.push({ name: m[2], kind: 'method', params: m[3].replace(/\s+/g, ' ').trim(), returns: declared(text, m[4], m.index!, fqn), visibility: /protected/.test(mods) ? 'protected' : 'public', static: /static/.test(mods), owner: fqn });
 }
 for (const m of text.matchAll(/(public|protected)\s+(?:readonly\s+)?(?:static\s+)?([?\\\w|]+)\s+\$(\w+)/g)) out.push({ name: m[3], kind: 'property', params: '', returns: declared(text, m[2], m.index!, fqn), visibility: m[1] as 'public' | 'protected', static: false, owner: fqn });
 // Inclui a promoção no construtor (`public readonly string $code`).
 const context = analyze(text); const decl = context.declarations.find(d => d.fqn === fqn);
 const head = decl ? text.slice(decl.offset, text.indexOf('{', decl.offset)) : '';
 const parent = /\bextends\s+([\\\w]+)/.exec(head)?.[1];
 const traits = [...text.matchAll(/\n\s*use\s+([\\\w,\s]+);/g)].filter(t => decl && t.index! > decl.offset).flatMap(t => t[1].split(',').map(s => s.trim()));
 for (const other of [...traits, ...(parent ? [parent] : [])]) for (const m of await classMembers(resolveName(text, other, decl?.offset ?? 0), files, seen)) if (!out.some(o => o.name === m.name && o.kind === m.kind)) out.push(m);
 return out;
}

export type TypeEnv = { path: string; text: string; files: ProjectFiles; sources: Source[] };
/**
 * Tipo de uma expressão com chamadas: literal, `new X`, variável atribuída/parâmetro tipado,
 * `função()` global (arquivo ou tests/Pest.php), `$this` (classe de `uses()->in()`), `X::m()` e
 * cadeias `->método()`/`->propriedade`. `mixed` quando não dá para saber.
 */
export async function typeOf(env: TypeEnv, tokens: PhpToken[], start: number, end: number, depth = 0): Promise<string> {
 if (depth > 6 || start >= end) return 'mixed';
 const { text } = env; const first = tokens[start];
 // Base da cadeia.
 let i = start; let type = 'mixed';
 if (first.value === '(') { const close = matching(tokens, start); type = await typeOf(env, tokens, start + 1, close, depth + 1); i = close + 1; }
 else if (end - start === 1 && first.type === 'string') return 'string';
 else if (end - start === 1 && first.type === 'number') return /[.eE]/.test(first.value) ? 'float' : 'int';
 else if (end - start === 1 && /^(true|false)$/i.test(first.value)) return 'bool';
 else if (end - start === 1 && /^null$/i.test(first.value)) return 'null';
 else if (first.value === '[' || (/^array$/i.test(first.value) && tokens[start + 1]?.value === '(')) { const close = matching(tokens, start + (first.value === '[' ? 0 : 1)); type = 'array'; i = close + 1; }
 else if (first.value === 'new') {
  let j = start + 1; let name = ''; while (j < end && (tokens[j].type === 'word' || tokens[j].value === '\\')) name += tokens[j++].value;
  type = name ? resolveName(text, name, first.offset) : 'mixed'; i = tokens[j]?.value === '(' ? matching(tokens, j) + 1 : j;
 }
 else if (first.value === '$' && tokens[start + 1]?.type === 'word') {
  const name = tokens[start + 1].value; i = start + 2;
  // `$this`: todas as classes/traits de uses() (a mais específica primeiro), unidas por `|`.
  if (name === 'this') type = testCaseClasses(env.path, text, env.sources).join('|') || 'PHPUnit\\Framework\\TestCase';
  else type = await variableType(env, tokens, start, name, depth);
 }
 else if (first.type === 'word' || first.value === '\\') {
  let j = start; let name = ''; while (j < end && (tokens[j].type === 'word' || tokens[j].value === '\\')) name += tokens[j++].value;
  if (tokens[j]?.value === '(') { // função global
   const fn = [...functionsIn(env.path, text), ...env.sources.flatMap(s => functionsIn(s.path, s.text))].find(f => f.name === name.replace(/^\\/, ''));
   type = fn?.returns ?? 'mixed'; i = matching(tokens, j) + 1;
  } else if (tokens[j]?.value === '::' && tokens[j + 1]?.type === 'word' && tokens[j + 2]?.value === '(') { // X::m()
   const owner = resolveName(text, name, first.offset);
   type = (await classMembers(owner, env.files)).find(m => m.kind === 'method' && m.name === tokens[j + 1].value)?.returns ?? 'mixed'; i = matching(tokens, j + 2) + 1;
  } else return 'mixed';
 }
 else return 'mixed';
 // Cadeia ->membro / ->método(...).
 while (i < end) {
  if ((tokens[i].value !== '->' && tokens[i].value !== '?->') || tokens[i + 1]?.type !== 'word') return i === end ? type : 'mixed';
  const member = tokens[i + 1].value; const call = tokens[i + 2]?.value === '(';
  if (scalar.has(type)) return 'mixed';
  let found: ClassMember | undefined;
  for (const owner of type.split('|')) { found = (await classMembers(owner, env.files)).find(m => m.name === member && m.kind === (call ? 'method' : 'property')); if (found) break; }
  type = found?.returns ?? 'mixed';
  i = call ? matching(tokens, i + 2) + 1 : i + 2;
 }
 return type;
}

/** Parâmetro tipado da closure (`function (User $u)`) ou a última atribuição antes do uso. */
async function variableType(env: TypeEnv, tokens: PhpToken[], at: number, name: string, depth: number): Promise<string> {
 for (let i = at - 1; i >= 0; i--) {
  if (tokens[i].value !== '$' || tokens[i + 1]?.value !== name) continue;
  const type = tokens[i - 1]; const before = tokens[i - 2]?.value;
  if (type?.type === 'word' && (before === '(' || before === ',' || before === '?')) return resolveName(env.text, type.value, tokens[i].offset);
  if (tokens[i + 2]?.value === '=' && tokens[i + 3]?.value !== '=' && tokens[i + 3]?.value !== '>') { let j = i + 3; while (j < tokens.length && tokens[j].value !== ';') j++; return typeOf(env, tokens, i + 3, j, depth + 1); }
 }
 return 'mixed';
}
