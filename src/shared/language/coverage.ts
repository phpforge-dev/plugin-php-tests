// Cobertura a partir do relatório Clover (`--coverage-clover`, PHPUnit e Pest). As colunas
// "Class, %", "Method, %" e "Line, %" seguem a janela Coverage descrita na ajuda da JetBrains.
export type LineHit = { line: number; count: number; method?: string };
export type ClassCoverage = { name: string; methods: number; coveredMethods: number; statements: number; coveredStatements: number };
export type FileCoverage = { path: string; lines: LineHit[]; classes: ClassCoverage[] };
export type Ratio = { covered: number; total: number };
/** Pastas: arquivos com alguma linha executada e linhas; arquivos: só linhas (como a coluna "Statistics, %" da referência). */
export type CoverageNode = { name: string; path: string; kind: 'dir' | 'file'; files: Ratio; lines: Ratio; children: CoverageNode[] };

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
/** Percentual inteiro truncado, como na referência (7/13 → 53%); `null` quando não há o que medir. */
export const percent = (r: Ratio) => r.total ? Math.floor((r.covered / r.total) * 100) : null;
export const label = (r: Ratio) => { const p = percent(r); return p === null ? '–' : `${p}% (${r.covered}/${r.total})`; };

/**
 * Texto da coluna "Estatísticas, %" e da árvore Project. Observado no PhpStorm 2026.1.4 com Clover:
 * pasta "100% files, 59% lines", arquivo "40% lines". Linhas = todas as entradas `<line>` do Clover
 * (declaração de método + instruções); arquivo coberto = ao menos uma linha executada.
 */
export function statistics(node: Pick<CoverageNode, 'kind' | 'files' | 'lines'>, words: { files: string; lines: string } = { files: 'files', lines: 'lines' }): string {
 const lines = percent(node.lines); const files = percent(node.files);
 const l = `${lines ?? 0}% ${words.lines}`;
 return node.kind === 'file' ? l : `${files ?? 0}% ${words.files}, ${l}`;
}

function fileNode(f: FileCoverage): CoverageNode {
 const lines = { covered: f.lines.filter(l => l.count > 0).length, total: f.lines.length };
 return { name: f.path.split('/').pop()!, path: f.path, kind: 'file', files: { covered: lines.covered > 0 ? 1 : 0, total: 1 }, lines, children: [] };
}

/**
 * Árvore de pastas com totais agregados, sem compactar pastas (na referência `src` › `Money` aparecem
 * como na árvore Project). A raiz (path '') soma o projeto; suas filhas são as pastas de primeiro nível.
 */
export function coverageTree(files: FileCoverage[]): CoverageNode {
 const root: CoverageNode = { name: '', path: '', kind: 'dir', files: zero(), lines: zero(), children: [] };
 for (const f of files) {
  const parts = f.path.split('/'); let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
   const path = parts.slice(0, i + 1).join('/');
   let next = dir.children.find(c => c.kind === 'dir' && c.path === path);
   if (!next) { next = { name: parts[i], path, kind: 'dir', files: zero(), lines: zero(), children: [] }; dir.children.push(next); }
   dir = next;
  }
  dir.children.push(fileNode(f));
 }
 const sum = (n: CoverageNode) => {
  if (n.kind === 'file') return;
  n.children.forEach(sum);
  n.files = n.children.reduce((r, c) => add(r, c.files), zero()); n.lines = n.children.reduce((r, c) => add(r, c.lines), zero());
  n.children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
 };
 sum(root);
 return root;
}

/** Nó por caminho relativo ('' = raiz). */
export function findNode(root: CoverageNode, path: string): CoverageNode | undefined {
 if (root.path === path) return root;
 for (const c of root.children) if (c.kind === 'dir' ? path === c.path || path.startsWith(c.path + '/') : c.path === path) return findNode(c, path);
 return undefined;
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
