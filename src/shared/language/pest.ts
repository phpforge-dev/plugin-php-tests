// Pest: datasets compartilhados/locais (`dataset('nome', …)` + `->with('nome')`) e o tipo de
// `expect()`. Implementado a partir da documentação pública do Pest (Datasets, Expectations,
// Higher Order Expectations) e das assinaturas do pacote instalado em vendor/; não reproduz o
// plugin Pest da JetBrains.
import { analyze, codeOnly, namespaceAt, phpTokens, type PhpToken } from './php-source';
import type { ProjectFiles } from './plugins/api';

export type Dataset = { name: string; path: string; offset: number; end: number; shared: boolean };
/** Datasets declarados no texto: `dataset('nome', …)` fora de métodos/strings. */
export function datasetsIn(path: string, text: string): Dataset[] {
 const tokens = phpTokens(text); const out: Dataset[] = [];
 for (let i = 0; i < tokens.length - 2; i++) {
  const t = tokens[i]; const prev = tokens[i - 1]?.value;
  if (t.type !== 'word' || t.value !== 'dataset' || prev === '->' || prev === '::' || prev === 'function' || tokens[i + 1].value !== '(' || tokens[i + 2].type !== 'string') continue;
  const s = tokens[i + 2];
  out.push({ name: s.value, path, offset: s.offset, end: s.offset + rawLength(text, s.offset), shared: /(^|\/)tests\/(Datasets\/|Pest\.php$)/.test(path) });
 }
 return out;
}
const rawLength = (text: string, start: number) => { const q = text[start]; let i = start + 1; while (i < text.length && text[i] !== q) i += text[i] === '\\' ? 2 : 1; return i + 1 - start; };

/** Visíveis num arquivo de teste: os compartilhados (tests/Datasets, tests/Pest.php) e os do próprio arquivo. */
export async function visibleDatasets(path: string, text: string, files: ProjectFiles): Promise<Dataset[]> {
 const shared = await files.list('tests', n => n.endsWith('.php')).catch(() => [] as string[]);
 const candidates = shared.map(p => p.startsWith('tests/') ? p : `tests/${p}`).filter(p => p !== path && (/^tests\/Datasets\//.test(p) || p === 'tests/Pest.php'));
 const lists = await Promise.all(candidates.map(async p => datasetsIn(p, await files.read(p) ?? '')));
 return [...datasetsIn(path, text).map(d => ({ ...d, shared: false })), ...lists.flat()];
}

// --- expect() ------------------------------------------------------------------------------
export type Member = { name: string; kind: 'method' | 'property'; signature: string; returns: string; doc?: string };
type Chain = { valueType: string; negated: boolean; each: boolean; prefix: string; from: number; higherOrder?: string };

const matchingBack = (tokens: PhpToken[], close: number) => { let depth = 0; for (let i = close; i >= 0; i--) { const v = tokens[i].value; if (tokens[i].type !== 'punct') continue; if (v === ')' || v === ']') depth++; else if (v === '(' || v === '[') { depth--; if (!depth) return i; } } return -1; };
const matching = (tokens: PhpToken[], open: number) => { let depth = 0; for (let i = open; i < tokens.length; i++) { const v = tokens[i].value; if (tokens[i].type !== 'punct') continue; if (v === '(' || v === '[') depth++; else if (v === ')' || v === ']') { depth--; if (!depth) return i; } } return tokens.length; };

/** Tipo aproximado de uma expressão simples: literal, `new Classe`, variável atribuída ou parâmetro tipado. */
export function inferType(text: string, tokens: PhpToken[], start: number, end: number): string {
 const first = tokens[start]; const span = tokens.slice(start, end);
 if (!first) return 'mixed';
 if (span.length === 1 && first.type === 'string') return 'string';
 if (span.length === 1 && first.type === 'number') return /[.eE]/.test(first.value) ? 'float' : 'int';
 if (span.length === 1 && /^(true|false)$/i.test(first.value)) return 'bool';
 if (span.length === 1 && /^null$/i.test(first.value)) return 'null';
 if (first.value === '[' || /^array$/i.test(first.value)) return 'array';
 if (first.value === '(' && tokens[start + 1]?.value === 'new') return inferType(text, tokens, start + 1, end);
 if (first.value === 'new' && tokens[start + 1]?.type === 'word') return resolveClass(text, tokens[start + 1].value, first.offset);
 if (first.value === '$' && tokens[start + 1]?.type === 'word') {
  const name = tokens[start + 1].value;
  // Parâmetro tipado da closure (`function (User $u)`) ou última atribuição `$x = new X` antes do uso.
  for (let i = start - 1; i >= 0; i--) {
   if (tokens[i].value !== '$' || tokens[i + 1]?.value !== name) continue;
   const type = tokens[i - 1]; const before = tokens[i - 2]?.value;
   if (type?.type === 'word' && (before === '(' || before === ',' || before === '?')) return resolveClass(text, type.value, tokens[i].offset);
   if (tokens[i + 2]?.value === '=' && tokens[i + 3]?.value !== '=' && tokens[i + 3]?.value !== '>') { let j = i + 3; while (j < tokens.length && tokens[j].value !== ';') j++; return inferType(text, tokens, i + 3, j); }
  }
 }
 return 'mixed';
}
const scalar = new Set(['int', 'float', 'string', 'bool', 'array', 'mixed', 'null', 'callable', 'iterable', 'object', 'self', 'static']);
function resolveClass(text: string, name: string, offset: number): string {
 if (scalar.has(name.toLowerCase())) return name.toLowerCase();
 if (name.startsWith('\\')) return name.slice(1);
 const context = analyze(text);
 const [head, ...rest] = name.split('\\');
 const imported = context.imports.find(i => i.alias === head);
 if (imported) return [imported.fqn, ...rest].join('\\');
 const ns = namespaceAt(context, offset);
 return ns ? `${ns}\\${name}` : name;
}

/** Cadeia `expect(…)->…->prefixo` terminando no cursor, ou null. */
export function expectChain(text: string, offset: number): Chain | null {
 const before = text.slice(0, offset);
 const word = /[A-Za-z_]\w*$/.exec(before)?.[0] ?? '';
 const inCode = !before.includes('<?');
 const code = codeOnly(before.slice(0, before.length - word.length), inCode);
 if (!/->\s*$/.test(code)) return null;
 const tokens = phpTokens(before.slice(0, before.length - word.length), inCode);
 let i = tokens.length - 1; // `->`
 const links: { name: string; args?: [number, number] }[] = [];
 while (i > 0) {
  if (tokens[i].value !== '->') return null;
  let j = i - 1;
  if (tokens[j].value === ')') {
   const open = matchingBack(tokens, j); if (open < 1) return null;
   const callee = tokens[open - 1];
   if (callee.type !== 'word') return null;
   if (callee.value === 'expect' && tokens[open - 2]?.value !== '->' && tokens[open - 2]?.value !== '::') {
    let type = inferType(before, tokens, open + 1, j);
    let negated = false; let each = false; let higherOrder: string | undefined;
    for (const link of links.reverse()) {
     if (link.name === 'not') { negated = true; continue; }
     if (link.name === 'each') { each = true; continue; }
     if (link.name === 'and' && link.args) { type = inferType(before, tokens, link.args[0], link.args[1]); negated = false; each = false; higherOrder = undefined; continue; }
     if (!link.args && link.name !== 'not' && link.name !== 'each') higherOrder = higherOrder ? `${higherOrder}->${link.name}` : link.name;
     else negated = false;
    }
    return { valueType: type, negated, each, prefix: word, from: offset - word.length, higherOrder };
   }
   if (tokens[open - 2]?.value !== '->') return null;
   links.push({ name: callee.value, args: [open + 1, j] });
   i = open - 2; continue;
  }
  if (tokens[j].type === 'word' && tokens[j - 1]?.value === '->') { links.push({ name: tokens[j].value }); i = j - 1; continue; }
  return null;
 }
 return null;
}

/** Métodos públicos e propriedades `@property` de uma classe PHP (assinatura simplificada). */
export function membersOf(text: string): Member[] {
 const out: Member[] = [];
 for (const m of text.matchAll(/@property(?:-read)?\s+(\S+)\s+\$(\w+)\s*([^\n]*)/g)) out.push({ name: m[2], kind: 'property', signature: m[2], returns: m[1].replace(/<.*$/, ''), doc: m[3].trim() || undefined });
 for (const m of text.matchAll(/(\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?public\s+(?!static\b)function\s+(\w+)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*(?::\s*([\\\w|?]+))?/g)) {
  const name = m[2]; if (name.startsWith('__')) continue;
  const doc = m[1]?.replace(/^\/\*\*|\*\/$/g, '').split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim()).find(l => l && !l.startsWith('@'));
  const params = m[3].replace(/\s+/g, ' ').trim().replace(/\b[\w\\]+\\(\w+)/g, '$1');
  out.push({ name, kind: 'method', signature: `${name}(${params})`, returns: (m[4] ?? 'mixed').replace(/^\\/, '').split('\\').pop()!, doc });
 }
 return out;
}

let cache: { key: string; members: Member[] } | undefined;
/** Membros de `Pest\Expectation` e do mixin de expectativas do pacote instalado. */
export async function expectationMembers(files: ProjectFiles): Promise<Member[]> {
 const paths = ['vendor/pestphp/pest/src/Expectation.php', 'vendor/pestphp/pest/src/Mixins/Expectation.php'];
 const texts = await Promise.all(paths.map(p => files.read(p).catch(() => null)));
 const key = texts.map(t => t?.length ?? 0).join(':');
 if (cache?.key === key) return cache.members;
 const seen = new Set<string>(); const members: Member[] = [];
 for (const text of texts) for (const m of membersOf(text ?? '')) if (!seen.has(m.name) && !['classes', 'traits', 'interfaces', 'enums'].includes(m.name)) { seen.add(m.name); members.push(m); }
 cache = { key, members };
 return members;
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

/** Rótulo do tipo da expectativa, como no hover/completar: `Expectation<App\Formatter>`. */
export const expectationType = (chain: Pick<Chain, 'valueType' | 'negated' | 'each'>) => `${chain.each ? 'EachExpectation' : chain.negated ? 'OppositeExpectation' : 'Expectation'}<${chain.valueType}>`;
