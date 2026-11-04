// Árvore de resultados a partir das mensagens TeamCity (`--teamcity`) do PHPUnit 10+ e do Pest 2+.
// Formato documentado publicamente pelo TeamCity ("Service Messages"); os nomes e `locationHint`
// foram conferidos na saída real do PHPUnit 11.5 e do Pest 3.8 (fixtures do php-ide).
export type NodeStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error' | 'ignored' | 'terminated';
export type TestNode = {
 id: number; name: string; kind: 'root' | 'suite' | 'test';
 status: NodeStatus;
 /** Milissegundos informados pelo runner (testes) ou soma dos filhos (suítes). */
 duration?: number;
 /** Arquivo relativo à raiz; `fqn`: `Classe::método` (PHPUnit) ou descrição (Pest). */
 file?: string; fqn?: string;
 message?: string; details?: string;
 comparison?: { expected: string; actual: string };
 /** Saída do teste (linhas que não são mensagens TeamCity). */
 output: string[];
 children: TestNode[]; parent?: TestNode;
};
export type Message = { name: string; attrs: Record<string, string> };

const escapes: Record<string, string> = { "'": "'", n: '\n', r: '\r', x: '\u0085', l: ' ', p: ' ', '|': '|', '[': '[', ']': ']' };
const unescape = (value: string) => value.replace(/\|(0x[0-9a-fA-F]{4}|.)/g, (m, c: string) => c.length > 1 ? String.fromCharCode(parseInt(c.slice(2), 16)) : escapes[c] ?? m);

/** `##teamcity[nome chave='valor' …]`; null para linhas comuns. */
export function parseMessage(line: string): Message | null {
 const m = /^\s*##teamcity\[(\w+)((?:\s+[\w.-]+='(?:\|.|[^'|])*')*)\s*\]\s*$/.exec(line);
 if (!m) return null;
 const attrs: Record<string, string> = {};
 for (const a of m[2].matchAll(/([\w.-]+)='((?:\|.|[^'|])*)'/g)) attrs[a[1]] = unescape(a[2]);
 return { name: m[1], attrs };
}

/** `php_qn:///abs/tests/X.php::\Ns\XTest::testA` ou `pest_qn://tests/X.php::descrição`. */
export function parseLocation(hint: string | undefined, root: string): { file?: string; fqn?: string } {
 const m = hint && /^(?:php|pest)_qn:\/\/(.*?\.php)(?:::(.*))?$/s.exec(hint);
 if (!m) return {};
 const plain = m[1];
 const file = plain.startsWith(root + '/') ? plain.slice(root.length + 1) : plain.startsWith('/') ? undefined : plain;
 return { file, fqn: m[2]?.replace(/^\\/, '') };
}

const rank: Record<NodeStatus, number> = { failed: 6, error: 6, terminated: 5, running: 4, pending: 3, passed: 2, ignored: 1 };
/** Estado de uma suíte: o pior dos filhos (falha > interrompido > em execução > aprovado > ignorado). */
export function aggregate(node: TestNode): NodeStatus {
 if (node.kind === 'test' || !node.children.length) return node.status;
 return node.children.map(aggregate).reduce((a, b) => rank[b] > rank[a] ? b : a);
}
export function total(node: TestNode): number {
 return node.kind === 'test' ? node.duration ?? 0 : node.children.reduce((t, c) => t + total(c), 0);
}
export const leaves = (node: TestNode): TestNode[] => node.kind === 'test' ? [node] : node.children.flatMap(leaves);

/**
 * Consome linhas do runner (em tempo real ou de uma vez) e mantém a árvore.
 * O Pest abrevia o nome da suíte de data sets (`… → it su`); o nome mostrado vem do primeiro teste.
 */
export class RunTree {
 root: TestNode;
 count?: number;
 private next = 1;
 private current: TestNode;
 private running?: TestNode;
 constructor(name: string, readonly projectRoot: string) {
  this.root = { id: 0, name, kind: 'root', status: 'running', output: [], children: [] };
  this.current = this.root;
 }
 private add(kind: 'suite' | 'test', attrs: Record<string, string>): TestNode {
  const node: TestNode = { id: this.next++, name: attrs.name ?? '', kind, status: kind === 'test' ? 'running' : 'pending', output: [], children: [], parent: this.current, ...parseLocation(attrs.locationHint, this.projectRoot) };
  this.current.children.push(node);
  return node;
 }
 /** Uma linha da saída padrão; devolve o nó alterado (para atualizar só o necessário). */
 line(text: string): TestNode | undefined {
  text = text.replace(/\r$/, ''); // CRLF do PHPUnit no Windows
  const message = parseMessage(text);
  if (!message) { (this.running ?? this.current).output.push(text); return this.running ?? this.current; }
  const a = message.attrs;
  switch (message.name) {
   case 'testCount': this.count = (this.count ?? 0) + (Number(a.count) || 0); return this.root;
   case 'testSuiteStarted': { const suite = this.add('suite', a); this.current = suite; return suite; }
   case 'testSuiteFinished': {
    const suite = this.current;
    if (suite !== this.root) {
     const first = suite.children[0]?.name.replace(/ with data set .*$/s, '');
     if (first && first.startsWith(suite.name) && first.length > suite.name.length) suite.name = first;
     suite.status = aggregate(suite) === 'running' ? 'terminated' : aggregate(suite);
     this.current = suite.parent ?? this.root;
    }
    return suite;
   }
   case 'testStarted': { this.running = this.add('test', a); return this.running; }
   case 'testFailed': {
    const node = this.find(a.name); if (!node) return;
    node.status = 'failed'; node.message = a.message; node.details = a.details?.trim();
    if (a.type === 'comparisonFailure' && 'expected' in a && 'actual' in a) node.comparison = { expected: a.expected, actual: a.actual };
    if (a.duration) node.duration = Number(a.duration);
    return node;
   }
   case 'testIgnored': { const node = this.find(a.name); if (!node) return; node.status = 'ignored'; node.message = a.message; return node; }
   case 'testFinished': {
    const node = this.find(a.name); if (!node) return;
    if (node.status === 'running') node.status = 'passed';
    if (a.duration !== undefined) node.duration = Number(a.duration) || 0;
    if (node === this.running) this.running = undefined;
    return node;
   }
   case 'testStdOut': case 'testStdErr': { const node = this.find(a.name) ?? this.current; node.output.push(...(a.out ?? '').replace(/\n$/, '').split('\n')); return node; }
  }
  return undefined;
 }
 private find(name: string | undefined) {
  if (this.running && this.running.name === name) return this.running;
  return [...this.current.children].reverse().find(c => c.kind === 'test' && c.name === name);
 }
 /** Fim do processo: o que ficou em execução foi interrompido (nunca vira aprovado). */
 finish(stopped: boolean) {
  for (const leaf of leaves(this.root)) if (leaf.status === 'running') leaf.status = 'terminated';
  const walk = (n: TestNode) => { n.children.forEach(walk); if (n.kind !== 'test') n.status = aggregate(n); };
  walk(this.root);
  if (stopped && this.root.status === 'passed') this.root.status = 'terminated';
  this.running = undefined;
 }
}

export type Counts = { total: number; passed: number; failed: number; ignored: number; terminated: number; running: number };
export function counts(root: TestNode): Counts {
 const all = leaves(root);
 const n = (...s: NodeStatus[]) => all.filter(l => s.includes(l.status)).length;
 return { total: all.length, passed: n('passed'), failed: n('failed', 'error'), ignored: n('ignored'), terminated: n('terminated'), running: n('running') };
}

/** Duração como no painel de referência: `850 ms`, `1 s 250 ms`, `2 m 5 s`. */
export function formatDuration(ms: number): string {
 if (ms < 1000) return `${Math.round(ms)} ms`;
 const s = Math.floor(ms / 1000);
 if (s < 60) return `${s} s ${Math.round(ms % 1000)} ms`;
 return `${Math.floor(s / 60)} m ${s % 60} s`;
}

/** Linha onde a falha ocorreu no arquivo do teste, a partir de `details` (PHPUnit e Pest). */
export function failureLine(node: TestNode): number | undefined {
 if (!node.file || !node.details) return undefined;
 const name = node.file.split('/').pop()!;
 const at = [...node.details.matchAll(/([^\s:]+\.php):(\d+)/g)].filter(m => m[1].endsWith(name)).at(-1);
 return at ? Number(at[2]) : undefined;
}
