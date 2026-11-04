// Janela Coverage: árvore de pastas/arquivos com "Class, %", "Method, %" e "Line, %"
// (colunas descritas na ajuda pública da referência) e ação para ocultar as marcas do editor.
import { coverageTree, label, percent, type CoverageNode, type FileCoverage } from '../shared/language/coverage';
import { h, sdk, tr } from './sdk';
import { icon } from './icons';

export function mountCoverage(options: { clear(): void }) {
 const panel = h('section', { id: 'coverage-panel', hidden: true, attrs: { 'aria-label': 'Coverage' } });
 const resize = h('div', { className: 'tool-window-resize', tabIndex: 0, attrs: { role: 'separator', 'aria-label': tr('Altura da janela Coverage'), 'aria-orientation': 'horizontal' } });
 const title = h('span', { id: 'coverage-title', className: 'pt-muted' });
 const clear = h('button', { id: 'coverage-clear', type: 'button', className: 'pt-tool', title: tr('Ocultar a cobertura no editor'), attrs: { 'aria-label': tr('Ocultar a cobertura no editor') } }, icon('close'));
 const hide = h('button', { type: 'button', className: 'pt-tool', title: tr('Ocultar'), attrs: { 'aria-label': tr('Ocultar a janela Coverage') } }, icon('remove'));
 const table = h('div', { id: 'coverage-table', className: 'pt-cov-table', tabIndex: 0, attrs: { role: 'treegrid', 'aria-label': tr('Cobertura') } });
 panel.append(resize, h('div', { className: 'pt-run-header' }, h('strong', { textContent: 'Coverage' }), title, h('span', { className: 'pt-spacer' }), clear, hide), table);
 document.querySelector('.code')!.append(panel);
 const button = h('button', { id: 'show-coverage' });
 sdk.toolIcon(button, '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', 'Coverage');
 button.hidden = true;
 document.querySelector('.left-rail')!.append(button);
 sdk.resizeToolWindow(panel, resize, 'php-ide-coverage-window-height');
 const show = sdk.dockWindow(panel, button, () => hideWindow());
 function hideWindow() { panel.hidden = true; button.setAttribute('aria-pressed', 'false'); }
 button.onclick = () => panel.hidden ? show() : hideWindow();
 hide.onclick = hideWindow;
 clear.onclick = () => { options.clear(); table.replaceChildren(); title.textContent = ''; button.hidden = true; hideWindow(); };
 let tree: CoverageNode | undefined; const collapsed = new Set<string>();
 function cell(r: { covered: number; total: number }, column: string) {
  const p = percent(r);
  return h('span', { className: 'pt-cov-cell', attrs: { role: 'gridcell', 'data-column': column, 'data-level': p === null ? 'none' : p >= 80 ? 'high' : p >= 50 ? 'mid' : 'low' } }, label(r));
 }
 function render() {
  const head = h('div', { className: 'pt-cov-row pt-cov-head', attrs: { role: 'row' } }, ...[tr('Elemento'), 'Class, %', 'Method, %', 'Line, %'].map(t => h('span', { attrs: { role: 'columnheader' }, textContent: t })));
  const rows: HTMLElement[] = [head];
  const add = (n: CoverageNode, level: number) => {
   const open = !collapsed.has(n.path);
   const row = h('div', { className: 'pt-cov-row', tabIndex: -1, attrs: { role: 'row', 'aria-level': String(level), 'data-path': n.path, 'data-kind': n.kind } });
   if (n.kind === 'dir') row.setAttribute('aria-expanded', String(open));
   const name = h('span', { className: 'pt-cov-name', attrs: { role: 'gridcell' } });
   name.style.paddingLeft = `${(level - 1) * 16}px`;
   const twisty = h('span', { className: 'pt-twisty' }, n.kind === 'dir' ? icon('chevron') : '');
   name.append(twisty, h('span', { textContent: n.name }));
   row.append(name, cell(n.classes, 'class'), cell(n.methods, 'method'), cell(n.lines, 'line'));
   row.onclick = () => { if (n.kind === 'dir') { if (open) collapsed.add(n.path); else collapsed.delete(n.path); render(); } };
   row.ondblclick = () => { if (n.kind === 'file') void sdk.host.open(n.path, 0); };
   row.onkeydown = e => { if (e.key === 'Enter' && n.kind === 'file') void sdk.host.open(n.path, 0); };
   rows.push(row);
   if (n.kind === 'dir' && open) for (const c of n.children) add(c, level + 1);
  };
  if (tree) { const top = h('div', { className: 'pt-cov-row pt-cov-total', attrs: { role: 'row', 'aria-level': '1', 'data-path': '' } }, h('span', { className: 'pt-cov-name', textContent: tr('Todas as classes') }), cell(tree.classes, 'class'), cell(tree.methods, 'method'), cell(tree.lines, 'line')); rows.push(top); for (const c of tree.children) add(c, 2); }
  table.replaceChildren(...rows);
 }
 return {
  show(files: FileCoverage[], suite: string) {
   tree = coverageTree(files); title.textContent = `${suite}: ${tr('resultados da cobertura')}`;
   button.hidden = false; render(); show();
  },
  reset() { tree = undefined; table.replaceChildren(); button.hidden = true; hideWindow(); },
 };
}
