// Ícones de executar no gutter de arquivos de teste (classe/método PHPUnit, it/test/describe do
// Pest) com o estado da última execução (aprovado, falhou, ignorado) e marcas de cobertura por linha.
import { discoverTests, isTestFile, type TestCase, type TestFramework } from '../shared/language/php-tests';
import { leaves, type NodeStatus, type TestNode } from '../shared/language/teamcity';
import { lineStates, type FileCoverage } from '../shared/language/coverage';
import { activePath, disposable, h, on, sdk, tr } from './sdk';
import { icons, runIcon } from './icons';

export type GutterAction = 'run' | 'coverage' | 'edit';
type State = 'passed' | 'failed' | 'ignored';
/** Chave de um teste: `arquivo::Classe::método` (PHPUnit) ou `arquivo::descrição` (Pest), sem data set. */
const key = (file: string, name: string) => `${file}::${name.replace(/ with data set .*$/s, '')}`;
const worse = (a: State | undefined, b: State): State => !a ? b : a === 'failed' || b === 'failed' ? 'failed' : a === 'passed' || b === 'passed' ? 'passed' : 'ignored';
const toState = (s: NodeStatus): State | undefined => s === 'passed' ? 'passed' : s === 'failed' || s === 'error' ? 'failed' : s === 'ignored' ? 'ignored' : undefined;

// Cores fixas dos ícones (data URI não lê variáveis CSS); próximas nos temas claro e escuro.
const palette: Record<string, string> = { '--pt-run': '#4FA35A', '--pt-passed': '#4FA35A', '--pt-failed': '#DB5C5C', '--pt-ignored': '#8C8C8C' };
const uri = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/var\((--pt-[a-z]+)\)/g, (_, v) => palette[v] ?? '#888').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}")`;

export function mountGutter(options: { framework: () => TestFramework | null; act(action: GutterAction, path: string, test: TestCase | null): void }) {
 const editor = sdk.host.editor; const { monaco } = sdk;
 const style = h('style', { textContent: [
  `.pt-g{background-repeat:no-repeat;background-position:center;background-size:16px 16px;cursor:pointer}`,
  `.pt-g-run{background-image:${uri(runIcon(false))}}`, `.pt-g-run-all{background-image:${uri(runIcon(true))}}`,
  ...(['passed', 'failed', 'ignored'] as const).flatMap(s => [`.pt-g-${s}{background-image:${uri(runIcon(false, s))}}`, `.pt-g-all-${s}{background-image:${uri(runIcon(true, s))}}`]),
 ].join('\n') });
 document.head.append(style); sdk.own(() => style.remove());
 const decorations = editor.createDecorationsCollection();
 const coverageDecorations = editor.createDecorationsCollection();
 const states = new Map<string, State>();
 let coverage = new Map<string, FileCoverage>();
 let tests: TestCase[] = []; let file: string | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
 sdk.own(() => { clearTimeout(timer); decorations.clear(); coverageDecorations.clear(); closeMenu(); });

 function stateOf(test: TestCase): State | undefined {
  if (!file) return undefined;
  if (test.kind === 'method' || test.kind === 'pest') return states.get(key(file, test.name));
  // Classe/describe: o pior estado entre os testes dentro dela que já rodaram.
  const prefix = test.kind === 'class' ? `${file}::${test.name}::` : `${file}::${test.name} → `;
  let out: State | undefined;
  for (const [k, v] of states) if (k.startsWith(prefix)) out = worse(out, v);
  return out;
 }
 function paint() {
  const model = editor.getModel(); const path = model ? activePath() : undefined;
  file = path && isTestFile(path) && options.framework() ? path : undefined;
  tests = file ? discoverTests(file, model.getValue()) : [];
  decorations.set(tests.map(t => {
   const state = stateOf(t); const group = t.kind === 'class' || t.kind === 'describe';
   const cls = state ? `pt-g ${group ? 'pt-g-all-' : 'pt-g-'}${state}` : `pt-g ${group ? 'pt-g-run-all' : 'pt-g-run'}`;
   const label = state === 'passed' ? tr('Teste aprovado') : state === 'failed' ? tr('Teste falhou') : state === 'ignored' ? tr('Teste ignorado') : '';
   return { range: new monaco.Range(t.line + 1, 1, t.line + 1, 1), options: { glyphMarginClassName: `${cls} pt-gutter`, glyphMarginHoverMessage: { value: [label, `${tr('Executar')} '${t.label}'`].filter(Boolean).join(' · ') }, stickiness: 1 } };
  }));
  paintCoverage();
 }
 function paintCoverage() {
  const model = editor.getModel(); const path = model ? activePath() : undefined;
  const data = path ? coverage.get(path) : undefined;
  coverageDecorations.set(data ? [...lineStates(data)].filter(([line]) => line <= model.getLineCount()).map(([line, s]) => ({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, linesDecorationsClassName: s.covered ? 'pt-cov pt-cov-covered' : 'pt-cov pt-cov-uncovered', overviewRuler: undefined, hoverMessage: undefined, linesDecorationsTooltip: s.covered ? `${tr('Execuções')}: ${s.count}` : tr('Linha não coberta') } })) : []);
 }
 const schedule = () => { clearTimeout(timer); timer = setTimeout(paint, 200); };
 disposable(editor.onDidChangeModel(() => { closeMenu(); paint(); }));
 disposable(editor.onDidChangeModelContent(schedule));

 // Menu do ícone: a captura no contêiner impede que outro dono do gutter (breakpoints) receba o clique.
 let menu: HTMLElement | undefined;
 function closeMenu() { menu?.remove(); menu = undefined; }
 function lineOf(target: Element) {
  const top = (target as HTMLElement).getBoundingClientRect().top + 2;
  const hit = editor.getTargetAtClientPoint?.(editor.getDomNode().getBoundingClientRect().left + 40, top);
  return hit?.position?.lineNumber as number | undefined;
 }
 function openMenu(test: TestCase, x: number, y: number) {
  closeMenu(); const path = file!;
  menu = h('div', { className: 'tool-context-menu pt-gutter-menu', id: 'test-gutter-menu', attrs: { role: 'menu' } });
  const item = (label: string, action: GutterAction, shortcut?: string, iconName?: keyof typeof icons) => {
   const b = h('button', { type: 'button', attrs: { role: 'menuitem', 'data-action': action } });
   if (iconName) { const s = h('span', { className: 'pt-icon-box' }); s.innerHTML = icons[iconName]; b.append(s); } else b.append(h('span', { className: 'pt-icon-box' }));
   b.append(h('span', { className: 'pt-menu-label', textContent: label }));
   if (shortcut) b.append(h('kbd', { textContent: shortcut }));
   b.onclick = () => { closeMenu(); editor.focus(); options.act(action, path, test); };
   menu!.append(b);
  };
  const name = test.kind === 'method' ? test.label : test.kind === 'class' ? test.label : test.label;
  item(`${tr('Executar')} '${name}'`, 'run', sdk.keymap.shortcut('tests.runContext'), 'run');
  item(`${tr('Executar')} '${name}' ${tr('com cobertura')}`, 'coverage', undefined, 'coverage');
  menu.append(h('hr'));
  item(tr('Modificar configuração de execução…'), 'edit');
  document.body.append(menu);
  menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 8) + 'px'; menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + 'px';
  menu.querySelector('button')?.focus();
  on<KeyboardEvent>(menu, 'keydown', e => {
   const buttons = [...menu!.querySelectorAll<HTMLButtonElement>('button')]; const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
   if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
   if (e.key === 'Escape') { e.preventDefault(); closeMenu(); editor.focus(); }
  });
 }
 const container: HTMLElement = editor.getContainerDomNode();
 const swallow = (e: Event) => {
  const target = (e.target as Element | null)?.closest?.('.pt-gutter'); if (!target || !file) return;
  e.stopImmediatePropagation(); e.preventDefault();
  if (e.type !== 'click') return;
  const line = lineOf(target); const test = tests.find(t => t.line + 1 === line);
  if (test) openMenu(test, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
 };
 for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) on(container, type, swallow, { capture: true });
 on(document, 'pointerdown', e => { if (menu && !menu.contains(e.target as Node)) closeMenu(); });

 paint();
 return {
  refresh: paint,
  /** Teste sob o cursor (o mais interno que começa antes dele), para "Executar contexto". */
  atCaret(): { path: string; test: TestCase | null } | null {
   if (!file) return null; const line = (editor.getPosition()?.lineNumber ?? 1) - 1;
   const before = tests.filter(t => t.line <= line);
   const method = [...before].reverse().find(t => t.kind === 'method' || t.kind === 'pest' || t.kind === 'describe');
   return { path: file, test: method ?? before.find(t => t.kind === 'class') ?? null };
  },
  file: () => file,
  /** Estados de uma execução: sobrescrevem os anteriores só para os testes que rodaram. */
  results(root: TestNode) {
   const fresh = new Map<string, State>();
   for (const leaf of leaves(root)) {
    const s = toState(leaf.status); if (!s || !leaf.file) continue;
    const k = key(leaf.file, leaf.fqn ?? leaf.name); fresh.set(k, worse(fresh.get(k), s));
   }
   for (const [k, v] of fresh) states.set(k, v);
   paint();
  },
  coverage(files: FileCoverage[] | null) { coverage = new Map((files ?? []).map(f => [f.path, f])); paintCoverage(); },
  tests: () => tests,
 };
}
