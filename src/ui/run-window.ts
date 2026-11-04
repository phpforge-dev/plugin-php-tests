// Janela Run para testes: abas por configuração, barra vertical (Rerun, Rerun Failed, auto-test,
// Stop), barra de teste (filtros, ordenação, expandir, falha anterior/próxima), estado com
// progresso, árvore e console da seleção, com "Clique para ver a diferença" em falhas de comparação.
// Ações e rótulos seguem a ajuda pública "Test Runner tab" da referência.
import { RunTree, counts, failureLine, formatDuration, leaves, total, type NodeStatus, type TestNode } from '../shared/language/teamcity';
import { discoverTests, parseJunit, type TestCase } from '../shared/language/php-tests';
import { failedFilter, planFor, type CoverageEngine, type RunConfiguration } from '../shared/language/run-configs';
import { h, on, sdk, tr, type RunOutput } from './sdk';
import { icon, icons, type IconName } from './icons';

export type Session = {
 key: string; config: RunConfiguration; tree: RunTree; output: string[];
 command?: string; running: boolean; runId?: string; result?: RunOutput; started: number;
 coverage?: CoverageEngine; label?: string; note?: string; error?: string;
 selected?: number; expanded: Set<number>; autoTest: boolean; promise?: Promise<void>; streamed: number;
};
type Options = {
 /** Resultados (parciais ou finais) para o gutter. */
 results(session: Session, final: boolean): void;
 coverage(xml: string, session: Session): void;
 /** Cobertura pedida mas indisponível: devolve o mecanismo ou explica por que não há. */
 engine(config: RunConfiguration): Promise<CoverageEngine | string>;
};
const AUTO_TEST_DELAY = 3000;
const statusIcon: Record<NodeStatus, IconName> = { passed: 'passed', failed: 'failed', error: 'failed', ignored: 'ignored', terminated: 'terminated', running: 'running', pending: 'pending' };

export function mountRunWindow(options: Options) {
 const panel = h('section', { id: 'test-panel', hidden: true, attrs: { 'aria-label': 'Run' } });
 const resize = h('div', { id: 'test-resize', className: 'tool-window-resize', tabIndex: 0, attrs: { role: 'separator', 'aria-label': tr('Altura da janela Run'), 'aria-orientation': 'horizontal' } });
 const tabsBar = h('div', { className: 'pt-run-tabs', attrs: { role: 'tablist' } });
 const hide = h('button', { id: 'test-hide', type: 'button', className: 'pt-tool', title: tr('Ocultar'), attrs: { 'aria-label': tr('Ocultar a janela Run') } }, icon('remove'));
 const header = h('div', { className: 'pt-run-header' }, h('strong', { textContent: 'Run' }), tabsBar, h('span', { className: 'pt-spacer' }), hide);
 const tool = (id: string, name: IconName, label: string, action?: string) => { const b = h('button', { id, type: 'button', className: 'pt-tool', attrs: { 'aria-label': tr(label) } }, icon(name)); b.dataset.label = tr(label); if (action) b.dataset.action = action; return b; };
 const rerun = tool('test-rerun', 'rerun', 'Executar novamente', 'tests.rerun');
 const rerunFailed = tool('test-rerun-failed', 'rerunFailed', 'Executar novamente os testes com falha', 'tests.rerunFailed');
 const autoTest = tool('test-auto', 'autoTest', 'Alternar auto-test');
 const stop = tool('test-stop', 'stop', 'Interromper', 'tests.stop');
 const showPassed = tool('test-show-passed', 'showPassed', 'Mostrar aprovados'); const showIgnored = tool('test-show-ignored', 'showIgnored', 'Mostrar ignorados');
 const sortAlpha = tool('test-sort-alpha', 'sortAlpha', 'Ordenar alfabeticamente'); const sortDuration = tool('test-sort-duration', 'sortDuration', 'Ordenar por duração');
 const expandAll = tool('test-expand', 'expand', 'Expandir tudo'); const collapseAll = tool('test-collapse', 'collapse', 'Recolher tudo');
 const prevFailed = tool('test-prev-failed', 'previous', 'Teste com falha anterior'); const nextFailed = tool('test-next-failed', 'next', 'Próximo teste com falha');
 const sep = () => h('span', { className: 'pt-sep' });
 const statusText = h('span', { id: 'test-summary', attrs: { role: 'status', 'aria-live': 'polite' } });
 const progress = h('span', { className: 'pt-progress' }, h('span', { className: 'pt-progress-bar' }));
 // Uma barra horizontal, como na referência observada: execução | filtros | ordenação e navegação.
 const testBar = h('div', { className: 'pt-test-toolbar', attrs: { role: 'toolbar', 'aria-label': tr('Ações da execução') } }, rerun, rerunFailed, autoTest, stop, sep(), showPassed, showIgnored, sep(), sortAlpha, sortDuration, expandAll, collapseAll, sep(), prevFailed, nextFailed);
 const statusLine = h('div', { className: 'pt-status-line' }, statusText, progress);
 const treeEl = h('div', { id: 'test-tree', className: 'pt-tree', tabIndex: 0, attrs: { role: 'tree', 'aria-label': tr('Resultados dos testes') } });
 const consoleEl = h('pre', { id: 'test-console', className: 'pt-console', tabIndex: 0, attrs: { 'aria-label': tr('Saída') } });
 const splitter = h('div', { className: 'pt-split-handle', attrs: { role: 'separator', 'aria-orientation': 'vertical' } });
 const empty = h('div', { className: 'pt-run-empty' }, h('p', { textContent: tr('Para executar testes, faça uma das ações:') }), h('p', { textContent: tr('— Clique no ícone Executar no gutter do editor') }), h('p', { textContent: tr('— Escolha uma configuração no seletor da barra superior') }));
 const main = h('div', { className: 'pt-run-main' }, testBar, h('div', { className: 'pt-run-split' }, treeEl, splitter, h('div', { className: 'pt-console-pane' }, statusLine, consoleEl)));
 const body = h('div', { className: 'pt-run-body' }, main, empty);
 panel.append(resize, header, body);
 document.querySelector('.code')!.append(panel);
 const button = h('button', { id: 'show-tests' }); sdk.toolIcon(button, '<path d="M7 5v14l11-7Z"/>', 'Run');
 document.querySelector('.left-rail')!.append(button);
 sdk.resizeToolWindow(panel, resize, 'php-ide-run-window-height');
 const show = sdk.dockWindow(panel, button, () => hideWindow());
 function hideWindow() { panel.hidden = true; button.setAttribute('aria-pressed', 'false'); }
 button.onclick = () => panel.hidden ? show() : hideWindow();
 hide.onclick = hideWindow;
 // Divisor árvore | console.
 splitter.onpointerdown = e => { splitter.setPointerCapture(e.pointerId); e.preventDefault(); };
 splitter.onpointermove = e => { if (!splitter.hasPointerCapture(e.pointerId)) return; const box = main.getBoundingClientRect(); treeEl.style.flexBasis = Math.max(160, Math.min(box.width - 200, e.clientX - box.left)) + 'px'; };
 splitter.onpointerup = e => splitter.releasePointerCapture(e.pointerId);

 const prefs = (() => { try { return { passed: false, ignored: true, alpha: false, duration: false, ...JSON.parse(localStorage.getItem('php-ide-test-view') ?? '{}') }; } catch { return { passed: false, ignored: true, alpha: false, duration: false }; } })();
 const savePrefs = () => { try { localStorage.setItem('php-ide-test-view', JSON.stringify(prefs)); } catch { /* opcional */ } };
 const sessions: Session[] = []; let active: Session | undefined; let root = '';
 const discovered = new Map<string, TestCase[]>();

 // --- Execução -------------------------------------------------------------------------------
 const findSession = (runId: string) => sessions.find(s => s.runId === runId);
 let pending = 0;
 const schedule = () => { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; render(); if (active) options.results(active, false); }); };
 sdk.own(() => cancelAnimationFrame(pending));
 void sdk.listen('test-progress', event => {
  const p = event.payload; const s = p && findSession(p.run); if (!s) return;
  if (p.command) s.command = p.command;
  for (const line of (p.lines ?? []) as string[]) {
   const message = line.trimStart().startsWith('##teamcity[');
   if (message) s.streamed++; else s.output.push(line);
   s.tree.line(line);
  }
  if (s === active) schedule();
 }).catch(error => console.warn(tr('Eventos de testes indisponíveis'), error));

 async function start(config: RunConfiguration, opts: { coverage?: boolean; filter?: string; label?: string; note?: string } = {}) {
  root ||= (await sdk.api.workspace()).root;
  const busy = sessions.find(s => s.running);
  if (busy) { await cancel(busy); await busy.promise?.catch(() => {}); }
  let engine: CoverageEngine | undefined;
  if (opts.coverage) {
   const found = await options.engine(config);
   if (found !== 'xdebug' && found !== 'pcov') {
    const s = session(config, opts.label);
    s.tree = new RunTree(tr('Resultados dos testes'), root); s.output = []; s.result = undefined; s.command = undefined; s.note = undefined; s.coverage = undefined;
    s.error = found; s.running = false; s.selected = 0; s.tree.finish(true); show(); select(s); render(); sdk.host.status(found); return;
   }
   engine = found;
  }
  const s = session(config, opts.label);
  s.coverage = engine; s.note = opts.note; s.error = undefined; s.output = []; s.result = undefined; s.command = undefined; s.streamed = 0;
  s.tree = new RunTree(tr('Resultados dos testes'), root); s.expanded = new Set([0]); s.selected = 0; s.running = true; s.started = Date.now();
  const runId = crypto.randomUUID(); s.runId = runId;
  show(); select(s); render();
  s.promise = (async () => {
   let out: RunOutput | undefined;
   try {
    const plan = planFor(config, engine);
    if (opts.filter !== undefined) plan.filter = opts.filter;
    out = await sdk.api.testRun(runId, plan.framework, plan.path, plan.filter, plan.extra);
   } catch (error) { if (s.runId === runId) s.error = String((error as Error)?.message ?? error); }
   if (s.runId !== runId) return;
   s.running = false; s.result = out;
   if (out) finish(s, out);
   else s.tree.finish(true);
   for (const n of walk(s.tree.root)) if (n.kind !== 'test') s.expanded.add(n.id);
   render(); options.results(s, true);
   if (out?.clover) options.coverage(out.clover, s);
   const c = counts(s.tree.root);
   sdk.host.status(out ? summaryText(s) : tr('Falha ao executar testes'));
   if (c.failed && s === active) revealSelected();
  })();
  return s.promise;
 }
 function finish(s: Session, out: RunOutput) {
  if (out.command) s.command = out.command;
  const messages = out.teamcity ? out.teamcity.split('\n').filter(Boolean) : [];
  // Eventos podem ter sido descartados pela fila do host: a lista final completa é autoritativa.
  if (messages.length !== s.streamed) {
   const output = s.output.length ? s.output : out.output.split('\n');
   s.tree = new RunTree(tr('Resultados dos testes'), root); s.output = output;
   for (const line of messages) s.tree.line(line);
  }
  if (!messages.length && out.junit) junitTree(s, out.junit);
  if (out.stderr) s.output.push(...out.stderr.replace(/\n$/, '').split('\n'));
  s.tree.finish(out.cancelled || out.timedOut);
  if (out.teamcityTruncated) s.error = tr('Mensagens do runner truncadas (limite de 8 MiB); resultados incompletos.');
 }
 /** Sem mensagens TeamCity (runner antigo): árvore final a partir do JUnit, sem saída por teste. */
 function junitTree(s: Session, xml: string) {
  for (const r of parseJunit(xml, root)) {
   const status = r.status === 'skipped' ? 'ignored' : r.status;
   const line = `##teamcity[testStarted name='${esc(r.name)}' locationHint='php_qn://${esc(root + '/' + (r.file ?? ''))}::\\${esc((r.className ?? '') + '::' + r.name)}']`;
   s.tree.line(line);
   if (status === 'failed' || status === 'error') s.tree.line(`##teamcity[testFailed name='${esc(r.name)}' message='${esc(r.message ?? '')}']`);
   if (status === 'ignored') s.tree.line(`##teamcity[testIgnored name='${esc(r.name)}']`);
   s.tree.line(`##teamcity[testFinished name='${esc(r.name)}' duration='${Math.round(r.time * 1000)}']`);
  }
 }
 const esc = (v: string) => v.replace(/[|'\n\r[\]]/g, c => ({ '|': '||', "'": "|'", '\n': '|n', '\r': '|r', '[': '|[', ']': '|]' })[c]!);
 function session(config: RunConfiguration, label?: string): Session {
  const key = config.id;
  let s = sessions.find(x => x.key === key);
  if (!s) { s = { key, config, tree: new RunTree(tr('Resultados dos testes'), root), output: [], running: false, started: Date.now(), expanded: new Set([0]), autoTest: false, streamed: 0 }; sessions.push(s); }
  s.config = config; s.label = label;
  return s;
 }
 async function cancel(s: Session) { if (s.running && s.runId) await sdk.api.testCancel(s.runId).catch(error => { s.error = String(error); }); }
 function rerunSession(s = active) { if (s) void start(s.config, { coverage: !!s.coverage }); }
 function rerunFailedSession(s = active) {
  if (!s || s.running) return;
  const failed = leaves(s.tree.root).filter(l => l.status === 'failed' || l.status === 'error');
  if (!failed.length) return;
  const { filter, broadened } = failedFilter(s.config.framework, failed);
  const config = { ...s.config, scope: s.config.scope === 'method' || s.config.scope === 'class' ? 'file' as const : s.config.scope };
  void start({ ...config, id: s.config.id }, { filter, note: broadened ? tr('Pest não seleciona um data set isolado: os testes com falha foram repetidos com todos os data sets.') : undefined });
 }

 /**
  * "Executar '…'" no menu de contexto da árvore (DOC: Test Runner tab). PHPUnit roda a identidade exata,
  * inclusive um data set isolado; o Pest 3.8 compara o filtro só com a descrição montada antes do
  * data set (conferido no código do Pest em vendor/ e na CLI), então o teste inteiro é repetido com aviso.
  */
 function runNode(s: Session, node: TestNode, coverage = false) {
  if (s.running) return;
  if (node.kind === 'root') { void start(s.config, { coverage }); return; }
  const picked = leaves(node).filter(l => l.fqn || l.name);
  if (!picked.length) return;
  const { filter, broadened } = failedFilter(s.config.framework, picked);
  const config = { ...s.config, scope: s.config.scope === 'method' || s.config.scope === 'class' ? 'file' as const : s.config.scope };
  const name = node.name;
  void start({ ...config, id: s.config.id }, { coverage, filter, note: broadened ? `${tr('Pest não seleciona um data set isolado: o teste foi repetido com todos os data sets')} (${name.replace(/ with data set .*$/s, '')}).` : undefined });
 }
 let treeMenu: HTMLElement | undefined;
 const closeTreeMenu = () => { treeMenu?.remove(); treeMenu = undefined; };
 sdk.own(closeTreeMenu);
 on(document, 'pointerdown', e => { if (treeMenu && !treeMenu.contains(e.target as Node)) closeTreeMenu(); });
 function openTreeMenu(s: Session, node: TestNode, x: number, y: number) {
  closeTreeMenu();
  treeMenu = h('div', { className: 'tool-context-menu pt-gutter-menu', id: 'test-tree-menu', attrs: { role: 'menu' } });
  const label = node.kind === 'root' ? s.config.name : node.name;
  const item = (text: string, action: string, run: () => void, shortcut?: string, iconName?: IconName, disabled = false) => {
   const b = h('button', { type: 'button', disabled, attrs: { role: 'menuitem', 'data-action': action } }, h('span', { className: 'pt-icon-box' }, iconName ? icon(iconName) : ''), h('span', { className: 'pt-menu-label', textContent: text }), shortcut ? h('kbd', { textContent: shortcut }) : '');
   b.onclick = () => { closeTreeMenu(); run(); };
   treeMenu!.append(b);
  };
  item(`${tr('Executar')} '${label}'`, 'run', () => runNode(s, node), sdk.keymap.shortcut('tests.runContext'), 'run', s.running);
  item(`${tr('Executar')} '${label}' ${tr('com cobertura')}`, 'coverage', () => runNode(s, node, true), undefined, 'coverage', s.running);
  treeMenu.append(h('hr'));
  item(tr('Ir para o código'), 'navigate', () => void navigate(node), /Mac/.test(navigator.platform) ? '⌘↓' : 'F4', undefined, !(node.file || node.children.some(c => c.file)));
  document.body.append(treeMenu);
  treeMenu.style.left = Math.min(x, window.innerWidth - treeMenu.offsetWidth - 8) + 'px'; treeMenu.style.top = Math.min(y, window.innerHeight - treeMenu.offsetHeight - 8) + 'px';
  treeMenu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  on<KeyboardEvent>(treeMenu, 'keydown', e => {
   const buttons = [...treeMenu!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
   if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
   if (e.key === 'Escape') { e.preventDefault(); closeTreeMenu(); treeEl.focus(); }
  });
 }

 // --- Auto-test ------------------------------------------------------------------------------
 let autoTimer: ReturnType<typeof setTimeout> | undefined;
 sdk.own(() => clearTimeout(autoTimer));
 on<CustomEvent>(window, 'ide-workspace-file-changed', event => {
  const path = String(event.detail?.path ?? '');
  if (!path.endsWith('.php') || path.includes('/vendor/') || !sessions.some(s => s.autoTest)) return;
  discovered.delete(path.startsWith(root + '/') ? path.slice(root.length + 1) : path);
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => { for (const s of sessions) if (s.autoTest && !s.running) void start(s.config, { coverage: !!s.coverage }); }, AUTO_TEST_DELAY);
 });

 // --- Renderização ---------------------------------------------------------------------------
 const walk = (n: TestNode): TestNode[] => [n, ...n.children.flatMap(walk)];
 function select(s: Session) { active = s; }
 function visible(n: TestNode): boolean {
  if (n.kind === 'root') return true;
  if (n.kind === 'test') return (prefs.passed || n.status !== 'passed') && (prefs.ignored || n.status !== 'ignored');
  return n.children.some(visible) || (!n.children.length && (prefs.passed || n.status !== 'passed'));
 }
 function sorted(children: TestNode[]) {
  const list = children.filter(visible);
  if (prefs.duration) return [...list].sort((a, b) => total(b) - total(a));
  if (prefs.alpha) return [...list].sort((a, b) => a.name.localeCompare(b.name));
  return list;
 }
 const rows = (s: Session) => { const out: { node: TestNode; level: number }[] = []; const add = (n: TestNode, level: number) => { out.push({ node: n, level }); if (s.expanded.has(n.id)) for (const c of sorted(n.children)) add(c, level + 1); }; add(s.tree.root, 1); return out; };
 function summaryText(s: Session) {
  const c = counts(s.tree.root); const all = s.tree.count && s.running ? Math.max(s.tree.count, c.total) : c.total;
  const time = formatDuration(s.running ? Date.now() - s.started : total(s.tree.root));
  if (s.error && !c.total) return s.error;
  if (s.running) return !all ? tr('Executando testes…') : `${tr('Testes')}: ${c.total - c.running} ${tr('de')} ${all}`;
  if (s.result?.cancelled || (c.terminated && !c.failed)) return `${tr('Testes interrompidos')}: ${[c.failed && `${tr('com falha')}: ${c.failed}`, `${tr('aprovados')}: ${c.passed}`, c.ignored && `${tr('ignorados')}: ${c.ignored}`].filter(Boolean).join(', ')} ${tr('de')} ${all} ${tr('testes')} – ${time}`;
  if (!c.total) return s.result ? `${tr('Nenhum teste foi executado')} (${tr('código de saída')} ${s.result.exitCode ?? '—'})` : '';
  const rest = [`${tr('aprovados')}: ${c.passed}`, c.ignored && `${tr('ignorados')}: ${c.ignored}`].filter(Boolean).join(', ');
  return c.failed ? `${tr('Testes com falha')}: ${c.failed}, ${rest} ${tr('de')} ${all} ${tr('testes')} – ${time}` : `${tr('Testes aprovados')}: ${c.passed}${c.ignored ? `, ${tr('ignorados')}: ${c.ignored}` : ''} ${tr('de')} ${all} ${tr('testes')} – ${time}`;
 }
 function render() {
  empty.hidden = !!sessions.length; main.hidden = !sessions.length;
  tabsBar.replaceChildren(...sessions.map(s => {
   const status = s.running ? 'running' : s.tree.root.status;
   const tab = h('span', { className: 'pt-run-tab', attrs: { role: 'tab', 'aria-selected': String(s === active), 'data-status': status, 'data-config': s.config.id } }, icon(s.config.framework), h('span', { textContent: s.label ?? s.config.name }));
   const close = h('button', { type: 'button', className: 'pt-tab-close', title: tr('Fechar'), attrs: { 'aria-label': `${tr('Fechar')} ${s.config.name}` } }, icon('close'));
   close.onclick = e => { e.stopPropagation(); void cancel(s); sessions.splice(sessions.indexOf(s), 1); if (active === s) active = sessions.at(-1); render(); if (!sessions.length) options.results(s, true); };
   tab.onclick = () => { active = s; render(); options.results(s, true); };
   tab.append(close); return tab;
  }));
  const s = active;
  for (const [b, on] of [[showPassed, prefs.passed], [showIgnored, prefs.ignored], [sortAlpha, prefs.alpha], [sortDuration, prefs.duration]] as const) b.setAttribute('aria-pressed', String(on));
  const failed = s ? leaves(s.tree.root).some(l => l.status === 'failed' || l.status === 'error') : false;
  rerun.disabled = !s; rerunFailed.disabled = !s || s.running || !failed; stop.disabled = !s?.running;
  autoTest.disabled = !s; autoTest.setAttribute('aria-pressed', String(!!s?.autoTest));
  prevFailed.disabled = nextFailed.disabled = !failed;
  if (!s) { treeEl.replaceChildren(); consoleEl.replaceChildren(); statusText.textContent = ''; return; }
  const c = counts(s.tree.root);
  statusText.textContent = summaryText(s);
  statusText.dataset.state = s.running ? 'running' : s.error && !c.total ? 'error' : c.failed ? 'failed' : c.terminated || s.result?.cancelled ? 'terminated' : c.total ? 'passed' : 'error';
  if (!s.running && c.total && !s.result?.cancelled) {
   // Formato observado: "✗ 2 tests failed, 1 passed, 1 ignored   3 tests total, 16 ms".
   const parts: (Node | string)[] = [];
   const put = (text: string, cls: string) => { if (parts.length) parts.push(', '); parts.push(h('span', { className: cls, textContent: text })); };
   if (c.failed) put(`${c.failed} ${c.failed === 1 ? tr('teste falhou') : tr('testes falharam')}`, 'pt-s-failed');
   if (c.passed) put(c.failed || c.ignored ? `${c.passed} ${c.passed === 1 ? tr('aprovado') : tr('aprovados')}` : `${c.passed} ${c.passed === 1 ? tr('teste aprovado') : tr('testes aprovados')}`, 'pt-s-passed');
   if (c.ignored) put(`${c.ignored} ${c.ignored === 1 ? tr('ignorado') : tr('ignorados')}`, 'pt-s-ignored');
   statusText.replaceChildren(...parts, h('span', { className: 'pt-s-total', textContent: `${c.total} ${c.total === 1 ? tr('teste no total') : tr('testes no total')}, ${formatDuration(total(s.tree.root))}` }));
  }
  if (s.running) statusText.prepend(icon('running')); else if (c.total || s.error) statusText.prepend(icon(c.failed || s.error ? 'failed' : c.terminated ? 'terminated' : 'passed'));
  const expected = s.tree.count ?? 0;
  progress.dataset.state = c.failed ? 'failed' : 'passed';
  progress.hidden = !s.running && !c.total;
  (progress.firstChild as HTMLElement).style.width = (s.running ? expected ? Math.min(100, ((c.total - c.running) / expected) * 100) : 5 : 100) + '%';
  const list = rows(s);
  treeEl.replaceChildren(...list.map(({ node, level }) => {
   const status = node.kind === 'root' && s.running ? 'running' : node.status;
   const row = h('div', { className: 'pt-row', attrs: { role: 'treeitem', 'aria-level': String(level), 'aria-selected': String(node.id === s.selected), 'data-node': String(node.id), 'data-status': status, 'data-kind': node.kind } });
   if (node.children.length) row.setAttribute('aria-expanded', String(s.expanded.has(node.id)));
   row.style.paddingLeft = `${(level - 1) * 16 + 4}px`;
   const chevron = h('span', { className: 'pt-twisty' }, node.children.length ? icon('chevron') : '');
   chevron.onclick = e => { e.stopPropagation(); toggle(s, node); };
   const time = node.kind === 'test' ? node.duration : total(node);
   row.append(chevron, icon(statusIcon[status]), h('span', { className: 'pt-row-name', textContent: node.name }), h('span', { className: 'pt-row-time', textContent: time !== undefined && status !== 'running' && status !== 'pending' && (node.kind !== 'root' || !s.running) ? formatDuration(time) : '' }));
   row.onclick = () => { s.selected = node.id; render(); };
   row.ondblclick = () => void navigate(node);
   row.oncontextmenu = e => { e.preventDefault(); s.selected = node.id; render(); openTreeMenu(s, node, e.clientX, e.clientY); };
   return row;
  }));
  renderConsole(s);
 }
 function toggle(s: Session, node: TestNode) { if (s.expanded.has(node.id)) s.expanded.delete(node.id); else s.expanded.add(node.id); render(); }
 const nodeById = (s: Session, id?: number) => walk(s.tree.root).find(n => n.id === id);
 function renderConsole(s: Session) {
  const node = nodeById(s, s.selected) ?? s.tree.root;
  const out: (Node | string)[] = [];
  const line = (text: string, cls = '') => { out.push(cls ? h('span', { className: cls }, ...linkify(text)) : h('span', {}, ...linkify(text)), '\n'); };
  if (node.kind === 'root') {
   if (s.command) line(s.command, 'pt-cmd');
   line(`${tr('Testes iniciados às')} ${new Date(s.started).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ...`, 'pt-cmd');
   if (s.note) line(s.note, 'pt-note');
   if (s.error) line(s.error, 'pt-err');
   for (const l of s.output) line(l);
   if (s.result && !s.running) line(s.result.cancelled ? tr('Processo interrompido') : s.result.timedOut ? tr('Tempo limite de 10 minutos atingido; o processo foi encerrado.') : `${tr('Processo finalizado com código de saída')} ${s.result.exitCode ?? '—'}`, 'pt-cmd');
  } else for (const n of walk(node)) {
   if (n.kind === 'test' && n !== node) line(n.name, 'pt-cmd');
   for (const l of n.output) line(l);
   if (n.message) line(n.message, 'pt-err');
   if (n.comparison) {
    const link = h('a', { href: '#', className: 'pt-diff-link', textContent: `<${tr('Clique para ver a diferença')}>` });
    link.onclick = e => { e.preventDefault(); openDiff(n); };
    out.push(link, '\n');
   }
   if (n.details) { out.push('\n'); for (const l of n.details.split('\n')) line(l, 'pt-err'); }
   if (n.status === 'terminated' && n === node) line(tr('Teste interrompido'), 'pt-cmd');
  }
  consoleEl.replaceChildren(...out);
 }
 /** Caminhos `arquivo.php:linha` viram links para o editor (só arquivos do projeto). */
 function linkify(text: string): (Node | string)[] {
  const parts: (Node | string)[] = []; let last = 0;
  for (const m of text.matchAll(/((?:\/|tests\/|src\/|app\/)[^\s:'"]*\.php):(\d+)/g)) {
   const file = m[1].startsWith(root + '/') ? m[1].slice(root.length + 1) : m[1].startsWith('/') ? null : m[1];
   if (!file) continue;
   parts.push(text.slice(last, m.index));
   const a = h('a', { href: '#', className: 'pt-link', textContent: m[0] }); a.onclick = e => { e.preventDefault(); void sdk.host.open(file, Number(m[2]) - 1); };
   parts.push(a); last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
 }
 /** Linha (1-based) do teste no arquivo, pela descoberta estática; a falha não é adivinhada. */
 async function sourceLine(node: TestNode): Promise<number | undefined> {
  if (!node.file) return undefined;
  if (!discovered.has(node.file)) discovered.set(node.file, await sdk.api.read(node.file).then(f => discoverTests(f.path, f.text)).catch(() => []));
  const cases = discovered.get(node.file)!;
  const name = (node.fqn ?? node.name).replace(/ with data set .*$/s, '');
  const hit = cases.find(c => c.kind === 'method' && c.name === name) ?? cases.find(c => c.kind === 'pest' && c.name === name) ?? cases.find(c => c.kind === 'class' && c.name === name) ?? cases.find(c => c.kind === 'describe' && c.name === name);
  return hit ? hit.line + 1 : undefined;
 }
 async function navigate(node: TestNode) {
  const target = node.kind === 'test' || node.file ? node : node.children.find(c => c.file);
  if (!target?.file) return;
  const line = await sourceLine(target) ?? failureLine(target) ?? 1;
  await sdk.host.open(target.file, line - 1).catch(error => sdk.host.status(`${tr('Não foi possível abrir')} ${target.file}: ${String(error)}`));
 }

 // --- Diferença ------------------------------------------------------------------------------
 const diffDialog = h('dialog', { id: 'test-diff-dialog', className: 'pt-dialog pt-diff-dialog' });
 document.body.append(diffDialog); sdk.own(() => diffDialog.remove());
 let diffEditor: any; let diffModels: any[] = [];
 const disposeDiff = () => { diffEditor?.dispose(); diffEditor = undefined; diffModels.forEach(m => m.dispose()); diffModels = []; };
 sdk.own(disposeDiff);
 on(diffDialog, 'close', disposeDiff);
 function openDiff(node: TestNode) {
  disposeDiff();
  const close = h('button', { type: 'button', className: 'pt-default', textContent: tr('Fechar') }); close.onclick = () => diffDialog.close();
  const host = h('div', { className: 'pt-diff-host', id: 'test-diff-editor' });
  diffDialog.replaceChildren(h('header', { className: 'pt-dialog-title', textContent: `${tr('Falha de comparação')} (${node.name})` }), h('div', { className: 'pt-diff-titles' }, h('span', { textContent: tr('Esperado') }), h('span', { textContent: tr('Obtido') })), host, h('footer', { className: 'pt-dialog-actions' }, h('span', { className: 'pt-spacer' }), close));
  diffDialog.showModal();
  const { monaco } = sdk;
  diffModels = [monaco.editor.createModel(node.comparison!.expected, 'plaintext'), monaco.editor.createModel(node.comparison!.actual, 'plaintext')];
  diffEditor = monaco.editor.createDiffEditor(host, { readOnly: true, originalEditable: false, automaticLayout: true, renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false, renderOverviewRuler: false, ignoreTrimWhitespace: false });
  diffEditor.setModel({ original: diffModels[0], modified: diffModels[1] });
 }

 // --- Teclado e barras -----------------------------------------------------------------------
 function revealSelected() { treeEl.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }
 on<KeyboardEvent>(treeEl, 'keydown', e => {
  const s = active; if (!s) return;
  const list = rows(s); const i = list.findIndex(r => r.node.id === s.selected); const node = list[i]?.node;
  const move = (j: number) => { const r = list[Math.max(0, Math.min(list.length - 1, j))]; if (r) { s.selected = r.node.id; render(); revealSelected(); } };
  if (e.key === 'ArrowDown') move(i + 1); else if (e.key === 'ArrowUp') move(i - 1);
  else if (e.key === 'ArrowRight' && node?.children.length) { if (!s.expanded.has(node.id)) toggle(s, node); else move(i + 1); }
  else if (e.key === 'ArrowLeft' && node) { if (s.expanded.has(node.id) && node.children.length) toggle(s, node); else if (node.parent) { s.selected = node.parent.id; render(); } }
  else if ((e.key === 'Enter' || e.key === 'F4' || (e.metaKey && e.key === 'ArrowDown')) && node) void navigate(node);
  // ⌃⇧R (macOS) / Ctrl+Shift+F10: executa o nó selecionado; Shift+F10 / ContextMenu abre o menu.
  else if (node && ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'r') || (e.ctrlKey && e.shiftKey && e.key === 'F10'))) { e.stopPropagation(); runNode(s, node); }
  else if (node && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { const r = treeEl.querySelector('[aria-selected=true]')?.getBoundingClientRect(); openTreeMenu(s, node, r?.left ?? 0, r?.bottom ?? 0); }
  else return;
  e.preventDefault();
 });
 function jumpFailed(step: 1 | -1) {
  const s = active; if (!s) return;
  const failed = rows(s).map(r => r.node).filter(n => n.kind === 'test' && (n.status === 'failed' || n.status === 'error'));
  const all = leaves(s.tree.root).filter(n => n.status === 'failed' || n.status === 'error');
  if (!failed.length && all.length) { for (const n of walk(s.tree.root)) s.expanded.add(n.id); return jumpFailed(step); }
  const i = failed.findIndex(n => n.id === s.selected);
  const next = failed[(i + step + failed.length) % failed.length] ?? failed[0];
  if (next) { s.selected = next.id; render(); revealSelected(); void navigate(next); }
 }
 rerun.onclick = () => rerunSession();
 rerunFailed.onclick = () => rerunFailedSession();
 stop.onclick = () => { if (active) void cancel(active); };
 autoTest.onclick = () => { if (!active) return; active.autoTest = !active.autoTest; render(); sdk.host.status(active.autoTest ? tr('Auto-test ativado: os testes rodam de novo 3 s após salvar um arquivo PHP.') : tr('Auto-test desativado')); };
 showPassed.onclick = () => { prefs.passed = !prefs.passed; savePrefs(); render(); };
 showIgnored.onclick = () => { prefs.ignored = !prefs.ignored; savePrefs(); render(); };
 sortAlpha.onclick = () => { prefs.alpha = !prefs.alpha; if (prefs.alpha) prefs.duration = false; savePrefs(); render(); };
 sortDuration.onclick = () => { prefs.duration = !prefs.duration; if (prefs.duration) prefs.alpha = false; savePrefs(); render(); };
 expandAll.onclick = () => { if (!active) return; for (const n of walk(active.tree.root)) if (n.children.length) active.expanded.add(n.id); render(); };
 collapseAll.onclick = () => { if (!active) return; active.expanded = new Set([0]); render(); };
 prevFailed.onclick = () => jumpFailed(-1); nextFailed.onclick = () => jumpFailed(1);
 // Dicas com atalhos do keymap central.
 const hint = () => { for (const b of [rerun, rerunFailed, autoTest, stop, showPassed, showIgnored, sortAlpha, sortDuration, expandAll, collapseAll, prevFailed, nextFailed]) { const key = b.dataset.action ? sdk.keymap.shortcut(b.dataset.action) : undefined; b.title = b.dataset.label! + (key ? ` · ${key}` : ''); } };
 sdk.keymap.onChange(hint); hint();
 // Tempo decorrido durante a execução.
 const ticker = setInterval(() => { if (active?.running && !panel.hidden) statusText.lastChild && (statusText.lastChild.textContent = summaryText(active)); }, 500);
 sdk.own(() => clearInterval(ticker));
 render();

 return {
  start, show, rerun: () => rerunSession(), rerunFailed: () => rerunFailedSession(), stop: () => { if (active) void cancel(active); },
  active: () => active, sessions: () => sessions, running: () => sessions.some(s => s.running),
  reset() { for (const s of sessions) void cancel(s); sessions.length = 0; active = undefined; discovered.clear(); root = ''; render(); hideWindow(); },
  invalidate(path: string) { discovered.delete(path); },
 };
}
export { icons };
