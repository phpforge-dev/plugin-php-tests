// Janela Coverage como no PhpStorm 2026.1.4 para PHP (observado com relatório Clover importado):
// colunas "Element" e "Statistics, %" ("100% files, 59% lines" na pasta, "40% lines" no arquivo),
// pastas no primeiro nível (sem nó "todas as classes"), ordenação clicando no cabeçalho e barra com
// "Navigate with Single Click" e "Always Select Opened Element". A mesma estatística aparece em cinza
// ao lado das pastas/arquivos na árvore Project, pelo ponto de extensão `projectTree` do host.
// "Flatten packages" não existe nessa janela para PHP na referência e não é oferecido.
import { coverageTree, findNode, percent, statistics, type CoverageNode, type FileCoverage } from '../shared/language/coverage';
import { activePath, h, on, sdk, tr } from './sdk';
import { icon } from './icons';

type Sort = { by: 'name' | 'stats'; desc: boolean };
const stored = (key: string, fallback: boolean) => { try { const v = localStorage.getItem(key); return v === null ? fallback : v === 'true'; } catch { return fallback; } };
const store = (key: string, value: boolean) => { try { localStorage.setItem(key, String(value)); } catch { /* sem armazenamento: só nesta sessão */ } };

export function mountCoverage(options: { clear(): void }) {
 const words = () => ({ files: tr('arquivos'), lines: tr('linhas') });
 const panel = h('section', { id: 'coverage-panel', hidden: true, attrs: { 'aria-label': 'Coverage' } });
 const resize = h('div', { className: 'tool-window-resize', tabIndex: 0, attrs: { role: 'separator', 'aria-label': tr('Altura da janela Coverage'), 'aria-orientation': 'horizontal' } });
 const suiteName = h('span', { id: 'coverage-title' });
 const clear = h('button', { id: 'coverage-clear', type: 'button', className: 'pt-tab-close', title: tr('Fechar a cobertura e ocultá-la no editor'), attrs: { 'aria-label': tr('Fechar a cobertura e ocultá-la no editor') } }, icon('close'));
 const suite = h('span', { className: 'pt-cov-suite' }, suiteName, clear);
 const hide = h('button', { type: 'button', className: 'pt-tool', title: tr('Ocultar'), attrs: { 'aria-label': tr('Ocultar a janela Coverage') } }, icon('remove'));
 const toggle = (id: string, label: string, key: string, path: string, fallback: boolean) => {
  const b = h('button', { type: 'button', id, className: 'pt-tool', title: label, attrs: { 'aria-label': label, 'aria-pressed': String(stored(key, fallback)) } });
  b.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  b.onclick = () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); store(key, on); if (on && b === select) follow(); };
  return b;
 };
 const single = toggle('coverage-single-click', tr('Navegar com um clique'), 'php-ide-coverage-single-click', 'M8 13V3M4 7l4-4 4 4M3 2h10', false);
 const select = toggle('coverage-select-opened', tr('Sempre selecionar o elemento aberto'), 'php-ide-coverage-select-opened', 'M8 3v10M4 9l4 4 4-4M3 14h10', false);
 const table = h('div', { id: 'coverage-table', className: 'pt-cov-table', tabIndex: 0, attrs: { role: 'treegrid', 'aria-label': tr('Cobertura') } });
 panel.append(resize, h('div', { className: 'pt-run-header' }, h('strong', { textContent: 'Coverage' }), suite, h('span', { className: 'pt-spacer' }), hide),
  h('div', { className: 'pt-test-toolbar', attrs: { role: 'toolbar', 'aria-label': tr('Ações da cobertura') } }, single, select), table);
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

 let tree: CoverageNode | undefined; let selected: string | undefined;
 const expanded = new Set<string>(); let sort: Sort = { by: 'name', desc: false };
 const order = (nodes: CoverageNode[]) => {
  const out = [...nodes].sort((a, b) => {
   if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
   const r = sort.by === 'name' ? a.name.localeCompare(b.name) : (percent(a.lines) ?? -1) - (percent(b.lines) ?? -1) || a.name.localeCompare(b.name);
   return sort.desc ? -r : r;
  });
  return out;
 };
 const open = (n: CoverageNode) => { if (n.kind === 'file') void sdk.host.open(n.path, 0); };
 function visible(): CoverageNode[] {
  const out: CoverageNode[] = [];
  const walk = (nodes: CoverageNode[]) => { for (const n of order(nodes)) { out.push(n); if (n.kind === 'dir' && expanded.has(n.path)) walk(n.children); } };
  if (tree) walk(tree.children);
  return out;
 }
 function render() {
  const header = (label: string, by: Sort['by']) => {
   const b = h('button', { type: 'button', className: 'pt-cov-sort', attrs: { role: 'columnheader', 'aria-sort': sort.by === by ? (sort.desc ? 'descending' : 'ascending') : 'none', 'data-sort': by } }, label, sort.by === by ? h('span', { className: 'pt-cov-arrow', textContent: sort.desc ? '⌄' : '⌃' }) : '');
   b.onclick = () => { sort = sort.by === by ? { by, desc: !sort.desc } : { by, desc: false }; render(); };
   return b;
  };
  const rows: HTMLElement[] = [h('div', { className: 'pt-cov-row pt-cov-head', attrs: { role: 'row' } }, header(tr('Elemento'), 'name'), header(tr('Estatísticas, %'), 'stats'))];
  const depth = (n: CoverageNode) => n.path.split('/').length - (tree!.children.find(c => n.path === c.path || n.path.startsWith(c.path + '/'))!.path.split('/').length) + 1;
  for (const n of visible()) {
   const level = depth(n); const isOpen = expanded.has(n.path);
   const row = h('div', { className: 'pt-cov-row', tabIndex: n.path === selected ? 0 : -1, attrs: { role: 'row', 'aria-level': String(level), 'aria-selected': String(n.path === selected), 'data-path': n.path, 'data-kind': n.kind } });
   if (n.kind === 'dir') row.setAttribute('aria-expanded', String(isOpen));
   const name = h('span', { className: 'pt-cov-name', attrs: { role: 'gridcell' } });
   name.style.paddingLeft = `${(level - 1) * 16}px`;
   const twisty = h('span', { className: 'pt-twisty' }, n.kind === 'dir' ? icon('chevron') : '');
   twisty.onclick = e => { e.stopPropagation(); toggleDir(n); };
   const fileIcon = sdk.fileIcon?.(n.path, n.kind === 'dir');
   name.append(twisty, ...(fileIcon ? [fileIcon] : []), h('span', { textContent: n.name }));
   row.append(name, h('span', { className: 'pt-cov-cell', attrs: { role: 'gridcell', 'data-column': 'statistics' }, textContent: statistics(n, words()) }));
   row.onclick = () => { selected = n.path; render(); focusSelected(); if (single.getAttribute('aria-pressed') === 'true') open(n); };
   row.ondblclick = () => { if (n.kind === 'dir') toggleDir(n); else open(n); };
   rows.push(row);
  }
  table.replaceChildren(...rows);
 }
 function toggleDir(n: CoverageNode) { if (expanded.has(n.path)) expanded.delete(n.path); else expanded.add(n.path); render(); focusSelected(); }
 function focusSelected() { table.querySelector<HTMLElement>(`.pt-cov-row[aria-selected=true]`)?.focus(); }
 on<KeyboardEvent>(table, 'keydown', e => {
  const list = visible(); if (!list.length) return;
  const i = Math.max(0, list.findIndex(n => n.path === selected)); const n = list[i];
  const move = (j: number) => { selected = list[Math.max(0, Math.min(list.length - 1, j))].path; render(); focusSelected(); if (single.getAttribute('aria-pressed') === 'true') open(findNode(tree!, selected)!); };
  if (e.key === 'ArrowDown') move(selected === undefined ? 0 : i + 1);
  else if (e.key === 'ArrowUp') move(i - 1);
  else if (e.key === 'ArrowRight' && n.kind === 'dir') { if (!expanded.has(n.path)) toggleDir(n); else move(i + 1); }
  else if (e.key === 'ArrowLeft') { if (n.kind === 'dir' && expanded.has(n.path)) toggleDir(n); else { const parent = n.path.split('/').slice(0, -1).join('/'); const p = list.findIndex(x => x.path === parent); if (p >= 0) move(p); } }
  else if (e.key === 'Enter') { if (n.kind === 'dir') toggleDir(n); else open(n); }
  else return;
  e.preventDefault();
 });
 /** "Sempre selecionar o elemento aberto": seleciona (e expande até) o arquivo ativo no editor. */
 function follow() {
  const path = activePath(); if (!tree || !path || select.getAttribute('aria-pressed') !== 'true' || !findNode(tree, path) || findNode(tree, path)!.kind !== 'file') return;
  const parts = path.split('/'); for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
  selected = path; render();
  table.querySelector<HTMLElement>(`.pt-cov-row[aria-selected=true]`)?.scrollIntoView({ block: 'nearest' });
 }
 const changed = sdk.host.editor.onDidChangeModel(() => follow()); sdk.own(() => changed.dispose());

 // Árvore Project: texto cinza depois do nome (pastas e arquivos com cobertura), como na referência.
 const projectTree = sdk.projectTree;
 projectTree?.decorate(({ path }) => { const n = tree && findNode(tree, path); return n && n.path === path ? { text: statistics(n, words()), title: `${tr('Cobertura')}: ${suiteName.textContent}` } : null; });

 const clearAll = () => { options.clear(); tree = undefined; selected = undefined; table.replaceChildren(); suiteName.textContent = ''; button.hidden = true; hideWindow(); projectTree?.refresh(); };
 clear.onclick = clearAll;
 return {
  show(files: FileCoverage[], suite: string) {
   tree = coverageTree(files); suiteName.textContent = suite;
   // Primeiro nível aberto, como a referência mostra `src` expandido.
   for (const c of tree.children) if (c.kind === 'dir') expanded.add(c.path);
   button.hidden = false; render(); show(); follow(); projectTree?.refresh();
  },
  /** "Ocultar cobertura" do popup do gutter: tira as marcas do editor e fecha a janela. */
  hide: clearAll,
  reset() { tree = undefined; table.replaceChildren(); button.hidden = true; hideWindow(); projectTree?.refresh(); },
 };
}
