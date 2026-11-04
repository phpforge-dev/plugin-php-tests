// Cobertura a partir do relatório Clover (`--coverage-clover`, PHPUnit e Pest). As colunas
// "Class, %", "Method, %" e "Line, %" seguem a janela Coverage descrita na ajuda da JetBrains.
export type LineHit = { line: number; count: number; method?: string };
export type ClassCoverage = { name: string; methods: number; coveredMethods: number; statements: number; coveredStatements: number };
export type FileCoverage = { path: string; lines: LineHit[]; classes: ClassCoverage[] };
export type Ratio = { covered: number; total: number };
export type CoverageNode = { name: string; path: string; kind: 'dir' | 'file'; classes: Ratio; methods: Ratio; lines: Ratio; children: CoverageNode[] };

const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&')]));

/** Arquivos do projeto no relatório (caminhos absolutos fora da raiz são descartados). */
export function parseClover(xml: string, root: string): FileCoverage[] {
 const out: FileCoverage[] = [];
 for (const f of xml.matchAll(/<file\b([^>]*)>([\s\S]*?)<\/file>/g)) {
  const name = attrs(f[1]).name ?? '';
  if (!name.startsWith(root + '/')) continue;
  const body = f[2];
  const lines: LineHit[] = [];
  for (const l of body.matchAll(/<line\b([^>]*?)\/>/g)) {
   const a = attrs(l[1]);
   lines.push({ line: Number(a.num), count: Number(a.count) || 0, method: a.type === 'method' ? a.name : undefined });
  }
  const classes = [...body.matchAll(/<class\b([^>]*)>\s*<metrics\b([^>]*)\/>/g)].map(c => {
   const m = attrs(c[2]);
   return { name: attrs(c[1]).name ?? '', methods: Number(m.methods) || 0, coveredMethods: Number(m.coveredmethods) || 0, statements: Number(m.statements) || 0, coveredStatements: Number(m.coveredstatements) || 0 };
  });
  out.push({ path: name.slice(root.length + 1), lines, classes });
 }
 return out.sort((a, b) => a.path.localeCompare(b.path));
}

const add = (a: Ratio, b: Ratio): Ratio => ({ covered: a.covered + b.covered, total: a.total + b.total });
const zero = (): Ratio => ({ covered: 0, total: 0 });
/** Percentual inteiro como na referência; `null` quando não há o que medir (mostrado como "–"). */
export const percent = (r: Ratio) => r.total ? Math.floor((r.covered / r.total) * 100) : null;
export const label = (r: Ratio) => { const p = percent(r); return p === null ? '–' : `${p}% (${r.covered}/${r.total})`; };

function fileNode(f: FileCoverage): CoverageNode {
 const statements = f.lines.filter(l => !l.method);
 const methods = f.lines.filter(l => l.method);
 // Classe coberta quando ao menos um método dela foi executado.
 const classes = f.classes.reduce((r, c) => add(r, { covered: c.coveredMethods > 0 || (c.methods === 0 && c.coveredStatements > 0) ? 1 : 0, total: 1 }), zero());
 return { name: f.path.split('/').pop()!, path: f.path, kind: 'file', classes, methods: { covered: methods.filter(m => m.count > 0).length, total: methods.length }, lines: { covered: statements.filter(l => l.count > 0).length, total: statements.length }, children: [] };
}

/** Árvore de pastas com totais agregados; pastas com um único filho pasta são compactadas (`src/App`). */
export function coverageTree(files: FileCoverage[]): CoverageNode {
 const root: CoverageNode = { name: 'all', path: '', kind: 'dir', classes: zero(), methods: zero(), lines: zero(), children: [] };
 for (const f of files) {
  const parts = f.path.split('/'); let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
   const path = parts.slice(0, i + 1).join('/');
   let next = dir.children.find(c => c.kind === 'dir' && c.path === path);
   if (!next) { next = { name: parts[i], path, kind: 'dir', classes: zero(), methods: zero(), lines: zero(), children: [] }; dir.children.push(next); }
   dir = next;
  }
  dir.children.push(fileNode(f));
 }
 const sum = (n: CoverageNode) => {
  if (n.kind === 'file') return;
  n.children.forEach(sum);
  n.classes = n.children.reduce((r, c) => add(r, c.classes), zero()); n.methods = n.children.reduce((r, c) => add(r, c.methods), zero()); n.lines = n.children.reduce((r, c) => add(r, c.lines), zero());
  n.children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
 };
 sum(root);
 const compact = (n: CoverageNode): CoverageNode => {
  n.children = n.children.map(compact);
  if (n !== root && n.kind === 'dir' && n.children.length === 1 && n.children[0].kind === 'dir') { const only = n.children[0]; return { ...only, name: `${n.name}/${only.name}` }; }
  return n;
 };
 return compact(root);
}

/**
 * Estado por linha para o gutter. Na referência (PhpStorm 2026.1.4, relatório Clover importado) a
 * linha da declaração do método também recebe marca, verde ou vermelha conforme o método rodou.
 */
export function lineStates(file: FileCoverage): Map<number, { covered: boolean; count: number }> {
 const out = new Map<number, { covered: boolean; count: number }>();
 for (const l of file.lines) out.set(l.line, { covered: l.count > 0, count: l.count });
 return out;
}

/**
 * Próxima (ou anterior) linha não coberta a partir de `line`, como "Next/Previous Uncovered" do popup
 * do gutter: só o início de cada trecho contínuo de linhas não cobertas conta; não dá a volta no arquivo.
 */
export function uncoveredFrom(states: Map<number, { covered: boolean }>, line: number, direction: 1 | -1): number | undefined {
 const starts = [...states].filter(([n, s]) => !s.covered && states.get(n - 1)?.covered !== false).map(([n]) => n).sort((a, b) => a - b);
 return direction === 1 ? starts.find(n => n > line) : starts.reverse().find(n => n < line);
}
