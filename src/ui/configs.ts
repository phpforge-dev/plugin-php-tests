// Configurações de execução: seletor no widget Run da barra superior e diálogo
// "Run/Debug Configurations" (campos da documentação pública da referência).
import { addTemporary, defaultName, normalize, persisted, scopeLabels, validate, type ConfigStore, type RunConfiguration, type RunScope } from '../shared/language/run-configs';
import type { TestFramework } from '../shared/language/php-tests';
import { h, on, sdk, tr } from './sdk';
import { icon, icons } from './icons';

export type Configs = ReturnType<typeof mountConfigs>;
type Options = {
 framework: () => TestFramework | null;
 run: (config: RunConfiguration, coverage?: boolean) => void;
 /** Executa o arquivo atual (seleção "Arquivo atual"), ou null quando não é um teste. */
 currentFile: () => (() => void) | null;
};
const uid = () => crypto.randomUUID();

export function mountConfigs(options: Options) {
 let store: ConfigStore = { version: 1, configurations: [] };
 let loaded = false; let error = '';
 const listeners = new Set<() => void>();
 const changed = () => { paint(); listeners.forEach(fn => fn()); };
 const selected = () => store.configurations.find(c => c.id === store.selected);

 async function load() {
  try { store = normalize(await sdk.api.testConfigRead()); error = ''; }
  catch (e) { error = String((e as Error)?.message ?? e); store = { version: 1, configurations: [] }; }
  loaded = true; changed();
 }
 async function save() {
  try { await sdk.api.testConfigWrite(persisted(store)); error = ''; return true; }
  catch (e) { error = String((e as Error)?.message ?? e); sdk.host.status(tr('Não foi possível salvar as configurações de execução: ') + error); return false; }
  finally { changed(); }
 }

 // --- Widget Run da barra superior -----------------------------------------------------------
 // O host (0.2.20+) mostra um único seletor com os tipos de todos os plugins, como a referência;
 // este plugin entra como o tipo PHPUnit/Pest. Sem configuração escolhida, o botão Run do host
 // executa os testes do arquivo atual por este plugin.
 const widget = document.querySelector<HTMLElement>('.run-widget');
 const hostRun = widget?.querySelector<HTMLButtonElement>('#run-current');
 const selector = h('button', { id: 'run-config-select', type: 'button', className: 'pt-config-select' }); // âncora do popup ⌃⌥R
 const frameworkName = (c: RunConfiguration) => c.framework === 'pest' ? 'Pest' : 'PHPUnit';
 sdk.provide?.('runConfigurations:php-tests', {
  type: 'php-tests', label: 'PHPUnit / Pest', icon: icons.phpunit,
  list: () => store.configurations.map(c => ({ id: c.id, name: c.name, temporary: c.temporary, description: frameworkName(c) })),
  run: (id: string) => { const c = store.configurations.find(x => x.id === id); if (c) { store.selected = id; changed(); options.run(c); } },
  edit: (id?: string) => edit(id),
  save: (id: string) => { const c = store.configurations.find(x => x.id === id); if (c) void saveTemporary(c); },
  select: (id: string | undefined) => { if (store.selected === id) return; store.selected = id; changed(); void save(); },
  selected: () => store.selected,
  // Uma seleção nova feita aqui (temporária do gutter, popup ⌃⌥R) é repassada para o seletor do host.
  onChange: (fn: (select?: string) => void) => { let last = store.selected; const listener = () => { const now = store.selected; const moved = now !== last; last = now; fn(moved ? now : undefined); }; listeners.add(listener); return () => listeners.delete(listener); },
 });
 const runCurrent = (event: Event) => { if (hostRun?.dataset.runConfig) return; const current = options.currentFile(); if (current) { event.stopPropagation(); current(); } };
 if (hostRun) { hostRun.addEventListener('click', runCurrent); sdk.own(() => hostRun.removeEventListener('click', runCurrent)); }
 const hostOriginal = hostRun ? { disabled: hostRun.disabled, title: hostRun.title, aria: hostRun.getAttribute('aria-label') ?? '' } : undefined;
 function paint() {
  if (!hostRun || !hostOriginal || hostRun.dataset.runConfig) return;
  const current = options.currentFile();
  const label = current ? tr('Executar os testes do arquivo atual') : hostOriginal.aria;
  const key = sdk.keymap.shortcut('tests.runSelected');
  hostRun.disabled = current ? false : hostOriginal.disabled;
  hostRun.title = current ? label + (key ? ` · ${key}` : '') : hostOriginal.title; hostRun.setAttribute('aria-label', label);
 }
 function runSelected() { const c = selected(); if (c) options.run(c); else options.currentFile()?.(); }

 // --- Popup de configurações ---------------------------------------------------------------
 let menu: HTMLElement | undefined;
 const closeMenu = () => { menu?.remove(); menu = undefined; selector.setAttribute('aria-expanded', 'false'); };
 function openMenu(popup = false) {
  closeMenu();
  menu = h('div', { className: 'tool-context-menu pt-config-menu', id: 'run-config-menu', attrs: { role: 'menu' } });
  const item = (label: string, act: () => void, extra: Partial<HTMLButtonElement> & { attrs?: Record<string, string> } = {}, ...prefix: Node[]) => {
   const b = h('button', { type: 'button', ...extra, attrs: { role: 'menuitem', ...(extra.attrs ?? {}) } }, ...prefix, h('span', { className: 'pt-menu-label', textContent: label }));
   b.onclick = () => { closeMenu(); act(); }; menu!.append(b); return b;
  };
  if (error) menu.append(h('p', { className: 'pt-menu-error', textContent: error }));
  if (popup) {
   // Popup "Run" observado: título, "0 Edit Configurations…", configurações numeradas com o tipo; executa ao escolher.
   menu.classList.add('pt-run-popup'); menu.append(h('div', { className: 'pt-menu-title', textContent: tr('Executar') }));
   item(tr('Editar configurações…'), () => edit(), { attrs: { 'data-action': 'edit', 'data-mnemonic': '0' } }, h('span', { className: 'pt-mnemonic', textContent: '0' }));
   menu.append(h('hr'));
   store.configurations.forEach((c, i) => item(`${c.name} (${c.framework === 'pest' ? 'Pest' : 'PHPUnit'})`, () => { store.selected = c.id; changed(); options.run(c); }, { className: c.temporary ? 'pt-temporary' : '', attrs: { 'data-config': c.id, ...(i < 9 ? { 'data-mnemonic': String(i + 1) } : {}) } }, h('span', { className: 'pt-mnemonic', textContent: i < 9 ? String(i + 1) : '' }), icon(c.framework)));
  } else for (const c of store.configurations) {
   const b = item(c.name, () => { store.selected = c.id; changed(); void save(); }, { className: c.temporary ? 'pt-temporary' : '', attrs: { 'data-config': c.id, 'aria-checked': String(c.id === store.selected), role: 'menuitemradio' } }, icon(c.framework));
   const play = h('span', { className: 'pt-menu-run', title: `${tr('Executar')} '${c.name}'`, attrs: { role: 'button', 'aria-label': `${tr('Executar')} '${c.name}'` } }, icon('run'));
   play.onclick = e => { e.stopPropagation(); closeMenu(); store.selected = c.id; changed(); options.run(c); };
   b.append(play);
  }
  if (!popup) {
  if (store.configurations.length) menu.append(h('hr'));
  item(tr('Arquivo atual'), () => { store.selected = undefined; changed(); void save(); }, { attrs: { 'aria-checked': String(!selected()), role: 'menuitemradio', 'data-config': '' } });
  menu.append(h('hr'));
  const c = selected();
  if (c?.temporary) item(`${tr('Salvar a configuração')} '${c.name}'`, () => void saveTemporary(c), { attrs: { 'data-action': 'save' } });
  item(tr('Editar configurações…'), () => edit(), { attrs: { 'data-action': 'edit' } });
  }
  document.body.append(menu);
  const box = selector.getBoundingClientRect();
  if (popup) { menu.style.left = Math.round((window.innerWidth - menu.offsetWidth) / 2) + 'px'; menu.style.top = Math.round(window.innerHeight * 0.3) + 'px'; }
  else { menu.style.left = Math.max(8, Math.min(box.left, window.innerWidth - menu.offsetWidth - 8)) + 'px'; menu.style.top = box.bottom + 4 + 'px'; }
  selector.setAttribute('aria-expanded', 'true');
  (menu.querySelector('[aria-checked=true]') as HTMLElement ?? menu.querySelector('button'))?.focus();
  on<KeyboardEvent>(menu, 'keydown', e => {
   const buttons = [...menu!.querySelectorAll<HTMLButtonElement>('button')]; const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
   if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
   if (e.key === 'Escape') { e.preventDefault(); closeMenu(); selector.focus(); }
   const mnemonic = menu?.querySelector<HTMLButtonElement>(`[data-mnemonic="${e.key}"]`); if (mnemonic) { e.preventDefault(); mnemonic.click(); }
  });
 }
 on(document, 'pointerdown', e => { if (menu && !menu.contains(e.target as Node) && !selector.contains(e.target as Node)) closeMenu(); });
 async function saveTemporary(c: RunConfiguration) { delete c.temporary; await save(); }

 // --- Diálogo Run/Debug Configurations -----------------------------------------------------
 const dialog = h('dialog', { id: 'run-config-dialog', className: 'pt-dialog' });
 document.body.append(dialog); sdk.own(() => dialog.remove());
 let draft: ConfigStore = store; let current: string | undefined; let environment = ''; let env: { xdebug: boolean; pcov: boolean } | undefined; let warnCoverage = () => {};
 function edit(id?: string) {
  draft = structuredClone(store); current = id ?? store.selected ?? draft.configurations[0]?.id;
  renderDialog(); if (!dialog.open) dialog.showModal();
  void sdk.api.testEnvironment().then(found => { env = found; environment = `PHP ${found.version} (${found.php})${found.xdebug ? ' · Xdebug' : ''}${found.pcov ? ' · PCOV' : ''}`; const el = dialog.querySelector('#run-config-interpreter'); if (el) el.textContent = environment; warnCoverage(); }).catch(e => { environment = String((e as Error)?.message ?? e); });
 }
 const field = (label: string, control: HTMLElement, id: string) => h('div', { className: 'pt-field' }, h('label', { htmlFor: id, textContent: label }), control);
 function renderDialog() {
  const c = draft.configurations.find(x => x.id === current);
  const list = h('div', { className: 'pt-config-tree', attrs: { role: 'tree', 'aria-label': tr('Configurações') } });
  for (const framework of ['phpunit', 'pest'] as TestFramework[]) {
   const items = draft.configurations.filter(x => x.framework === framework);
   if (!items.length) continue;
   list.append(h('div', { className: 'pt-config-group', attrs: { role: 'treeitem', 'aria-expanded': 'true' } }, icon(framework), framework === 'pest' ? 'Pest' : 'PHPUnit'));
   for (const x of items) {
    const row = h('button', { type: 'button', className: 'pt-config-row' + (x.temporary ? ' pt-temporary' : ''), attrs: { role: 'treeitem', 'aria-selected': String(x.id === current), 'data-config': x.id } }, icon(x.framework), x.name);
    row.onclick = () => { commitForm(); current = x.id; renderDialog(); };
    list.append(row);
   }
  }
  const add = h('button', { type: 'button', title: tr('Adicionar configuração'), attrs: { 'aria-label': tr('Adicionar configuração'), 'data-action': 'add' } }, icon('add'));
  add.onclick = () => {
   commitForm();
   const framework = options.framework() ?? 'phpunit';
   const created: RunConfiguration = { id: uid(), name: '', framework, scope: 'directory', path: 'tests' };
   created.name = uniqueName(defaultName(created)); draft.configurations.push(created); current = created.id; renderDialog();
  };
  const remove = h('button', { type: 'button', title: tr('Remover configuração'), disabled: !c, attrs: { 'aria-label': tr('Remover configuração'), 'data-action': 'remove' } }, icon('remove'));
  remove.onclick = () => { const i = draft.configurations.findIndex(x => x.id === current); if (i < 0) return; draft.configurations.splice(i, 1); current = draft.configurations[Math.min(i, draft.configurations.length - 1)]?.id; renderDialog(); };
  const copy = h('button', { type: 'button', title: tr('Copiar configuração'), disabled: !c, attrs: { 'aria-label': tr('Copiar configuração'), 'data-action': 'copy' } }, icon('copy'));
  copy.onclick = () => { commitForm(); if (!c) return; const dup = { ...structuredClone(c), id: uid(), name: uniqueName(c.name), temporary: undefined }; draft.configurations.push(dup); current = dup.id; renderDialog(); };
  const side = h('div', { className: 'pt-config-side' }, h('div', { className: 'pt-config-tools' }, add, remove, copy), list);
  const form = h('form', { className: 'pt-config-form', id: 'run-config-form' });
  form.onsubmit = e => e.preventDefault();
  if (c) {
   const name = h('input', { id: 'run-config-name', value: c.name, spellcheck: false });
   const keep = h('input', { id: 'run-config-store', type: 'checkbox', checked: !c.temporary });
   const scope = h('div', { className: 'pt-scope', attrs: { role: 'radiogroup', 'aria-label': tr('Escopo do teste') } });
   for (const [value, label] of Object.entries(scopeLabels[c.framework]) as [RunScope, string][]) {
    const radio = h('input', { type: 'radio', name: 'run-config-scope', value, checked: c.scope === value || (c.framework === 'pest' && c.scope === 'class' && value === 'file') });
    radio.onchange = () => { commitForm(); renderDialog(); };
    scope.append(h('label', {}, radio, ' ' + tr(label)));
   }
   const framework = h('select', { id: 'run-config-framework' }, h('option', { value: 'phpunit', textContent: 'PHPUnit' }), h('option', { value: 'pest', textContent: 'Pest' }));
   framework.value = c.framework; framework.onchange = () => { commitForm(); renderDialog(); };
   const path = h('input', { id: 'run-config-path', value: c.path, spellcheck: false, placeholder: c.scope === 'directory' ? 'tests/Unit' : 'tests/Unit/ExemploTest.php' });
   const className = h('input', { id: 'run-config-class', value: c.className ?? '', spellcheck: false, placeholder: 'Tests\\Unit\\ExemploTest' });
   const method = h('input', { id: 'run-config-method', value: c.method ?? '', spellcheck: false, placeholder: c.framework === 'pest' ? 'it soma números' : 'testSoma' });
   const useConfig = h('input', { id: 'run-config-use-file', type: 'checkbox', checked: !!c.configFile });
   const configFile = h('input', { id: 'run-config-file', value: c.configFile ?? '', disabled: !c.configFile, spellcheck: false, placeholder: 'phpunit.xml' });
   useConfig.onchange = () => { configFile.disabled = !useConfig.checked; if (useConfig.checked) configFile.focus(); };
   const runnerOptions = h('input', { id: 'run-config-options', value: c.options ?? '', spellcheck: false, placeholder: '--stop-on-failure --group rápido' });
   const coverage = h('select', { id: 'run-config-coverage' }, h('option', { value: '', textContent: tr('Automático') }), h('option', { value: 'xdebug', textContent: 'Xdebug' }), h('option', { value: 'pcov', textContent: 'PCOV' }));
   coverage.value = c.coverage ?? '';
   const scopeNow = c.framework === 'pest' && c.scope === 'class' ? 'file' : c.scope;
   form.append(...([
    h('div', { className: 'pt-config-head' }, field(tr('Nome:'), name, 'run-config-name'), h('label', { className: 'pt-check' }, keep, ' ' + tr('Salvar como arquivo do projeto'))),
    h('h3', { textContent: tr('Test Runner') }),
    field(tr('Framework:'), framework, 'run-config-framework'),
    h('div', { className: 'pt-field' }, h('span', { textContent: tr('Escopo do teste:') }), scope),
    // Ordem observada na referência (escopo Classe): Classe e depois Arquivo.
    c.framework === 'phpunit' && (scopeNow === 'class' || scopeNow === 'method') ? field(tr('Classe:'), className, 'run-config-class') : null,
    scopeNow === 'config' ? null : field(scopeNow === 'directory' ? tr('Diretório:') : tr('Arquivo:'), path, 'run-config-path'),
    scopeNow === 'method' ? field(c.framework === 'pest' ? tr('Teste:') : tr('Método:'), method, 'run-config-method') : null,
    h('div', { className: 'pt-field' }, h('label', { className: 'pt-check' }, useConfig, ' ' + tr('Usar arquivo de configuração alternativo:')), configFile),
    field(tr('Opções do runner:'), runnerOptions, 'run-config-options'),
    field(tr('Mecanismo de cobertura preferido:'), coverage, 'run-config-coverage'),
    h('p', { id: 'run-config-coverage-warning', className: 'pt-config-warning', hidden: true }),
    h('h3', { textContent: tr('Linha de comando') }),
    h('div', { className: 'pt-field' }, h('span', { textContent: tr('Interpretador:') }), h('span', { id: 'run-config-interpreter', className: 'pt-muted', textContent: environment || tr('Verificando…') })),
   ] as (HTMLElement | null)[]).filter((x): x is HTMLElement => !!x));
   const warn = () => { const w = dialog.querySelector<HTMLElement>('#run-config-coverage-warning'); if (!w) return; const missing = coverage.value === 'xdebug' && env && !env.xdebug ? 'Xdebug' : coverage.value === 'pcov' && env && !env.pcov ? 'PCOV' : ''; w.hidden = !missing; w.textContent = missing ? `⚠ ${tr('A extensão')} '${missing}' ${tr('não está instalada')}` : ''; };
   coverage.onchange = warn; warnCoverage = warn; warn();
   name.oninput = () => { const row = list.querySelector<HTMLElement>(`[data-config="${c.id}"]`); if (row) row.lastChild!.textContent = name.value; };
  } else form.append(h('p', { className: 'pt-muted', textContent: draft.configurations.length ? tr('Selecione uma configuração.') : tr('Nenhuma configuração. Use + para adicionar uma configuração PHPUnit ou Pest.') }));
  const problem = h('p', { id: 'run-config-error', className: 'pt-config-error', attrs: { role: 'alert' } });
  const runNow = h('button', { type: 'button', id: 'run-config-execute', disabled: !c }, icon('run'), tr('Executar'));
  const cancel = h('button', { type: 'button', textContent: tr('Cancelar') });
  const apply = h('button', { type: 'button', id: 'run-config-apply', textContent: tr('Aplicar') });
  const ok = h('button', { type: 'button', id: 'run-config-ok', className: 'pt-default', textContent: 'OK' });
  cancel.onclick = () => dialog.close();
  apply.onclick = () => void commit(false);
  ok.onclick = () => void commit(true);
  runNow.onclick = async () => { const id = current; if (await commit(true)) { const c = store.configurations.find(x => x.id === id); if (c) { store.selected = c.id; changed(); options.run(c); } } };
  dialog.replaceChildren(h('header', { className: 'pt-dialog-title', textContent: tr('Configurações de execução/depuração') }), h('div', { className: 'pt-config-body' }, side, form), problem, h('footer', { className: 'pt-dialog-actions' }, runNow, h('span', { className: 'pt-spacer' }), cancel, apply, ok));
 }
 const uniqueName = (name: string) => { const names = new Set(draft.configurations.map(c => c.name)); if (!names.has(name)) return name; let n = 2; while (names.has(`${name} (${n})`)) n++; return `${name} (${n})`; };
 /** Copia os campos do formulário para o rascunho (sem validar). */
 function commitForm() {
  const c = draft.configurations.find(x => x.id === current); if (!c) return;
  const q = <T extends HTMLElement>(id: string) => dialog.querySelector<T>('#' + id);
  const value = (id: string) => q<HTMLInputElement>(id)?.value.trim();
  c.name = q<HTMLInputElement>('run-config-name')?.value ?? c.name;
  const framework = q<HTMLSelectElement>('run-config-framework')?.value as TestFramework | undefined;
  if (framework && framework !== c.framework) { c.framework = framework; if (!scopeLabels[framework][c.scope]) c.scope = framework === 'pest' ? 'file' : 'class'; delete c.filter; }
  const scope = dialog.querySelector<HTMLInputElement>('input[name=run-config-scope]:checked')?.value as RunScope | undefined;
  if (scope && scope !== c.scope) { c.scope = scope; delete c.filter; }
  const path = value('run-config-path'); if (path !== undefined) c.path = path;
  const cls = value('run-config-class'); if (cls !== undefined) { if (cls !== (c.className ?? '')) delete c.filter; c.className = cls || undefined; }
  const method = value('run-config-method'); if (method !== undefined) { if (method !== (c.method ?? '')) delete c.filter; c.method = method || undefined; }
  if (q<HTMLInputElement>('run-config-use-file')) c.configFile = q<HTMLInputElement>('run-config-use-file')!.checked ? value('run-config-file') || undefined : undefined;
  const opts = q<HTMLInputElement>('run-config-options'); if (opts) c.options = opts.value.trim() || undefined;
  const cov = q<HTMLSelectElement>('run-config-coverage'); if (cov) c.coverage = (cov.value || undefined) as RunConfiguration['coverage'];
  const keep = q<HTMLInputElement>('run-config-store'); if (keep) { if (keep.checked) delete c.temporary; else c.temporary = true; }
 }
 async function commit(close: boolean) {
  commitForm();
  const names = draft.configurations.map(c => c.name);
  for (const c of draft.configurations) {
   const problem = validate(c, names);
   if (problem) { current = c.id; renderDialog(); const box = dialog.querySelector('#run-config-error')!; box.replaceChildren(h('strong', { textContent: tr('Erro:') }), ` ${tr(problem)}`); return false; }
  }
  if (draft.selected && !draft.configurations.some(c => c.id === draft.selected)) draft.selected = undefined;
  store = draft; draft = structuredClone(store);
  const saved = await save();
  if (!saved) { dialog.querySelector('#run-config-error')!.textContent = error; return false; }
  if (close) dialog.close(); else renderDialog();
  return true;
 }

 return {
  load, edit, runSelected, popup: () => openMenu(true), selected, onChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
  all: () => store.configurations,
  get error() { return error; }, get loaded() { return loaded; },
  /** Configuração temporária criada por uma ação do editor; vira a selecionada. */
  temporary(config: Omit<RunConfiguration, 'id'>) { const c = addTemporary(store, config, uid); changed(); return c; },
  select(id: string | undefined) { store.selected = id; changed(); },
  refresh: paint,
 };
}
