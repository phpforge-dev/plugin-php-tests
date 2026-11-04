import { isTestFile, type TestFramework } from '../shared/language/php-tests';
import { fromTest, type RunConfiguration } from '../shared/language/run-configs';
import { parseClover } from '../shared/language/coverage';
import { activePath, setRoot, setSdk, sdk, tr, type Sdk } from './sdk';
import { mountConfigs } from './configs';
import { mountRunWindow } from './run-window';
import { mountGutter, type GutterAction } from './gutter';
import { mountCoverage } from './coverage';
import type { TestCase } from '../shared/language/php-tests';

/** Pedido legado do comando `php-ide.runTests` (CodeLens de versões anteriores). */
type TestRunRequest = { framework: TestFramework; path: string; filter: string; label: string };

/**
 * Integração de workbench do PHPUnit/Pest: seletor de configurações no widget Run, ícones de
 * executar/estado no gutter, janela Run com árvore e console, Rerun Failed, auto-test e cobertura.
 */
export function activate(value: Sdk) {
 setSdk(value);
 let framework: TestFramework | null = null;
 let environment: Promise<{ php: string; version: string; xdebug: boolean; pcov: boolean }> | undefined;
 async function detect() {
  const json = await sdk.api.read('composer.json').then(f => JSON.parse(f.text)).catch(() => ({}));
  const has = (pkg: string) => !!(json.require?.[pkg] ?? json['require-dev']?.[pkg]);
  framework = has('pestphp/pest') ? 'pest' : has('phpunit/phpunit') ? 'phpunit' : null;
  if (!framework) framework = await sdk.api.read('vendor/bin/pest').then(() => 'pest' as const, () => sdk.api.read('vendor/bin/phpunit').then(() => 'phpunit' as const, () => null));
  configs.refresh(); gutter.refresh();
 }

 const coverageWindow = mountCoverage({ clear: () => gutter.coverage(null) });
 const runWindow = mountRunWindow({
  results: (session, final) => { if (final) gutter.results(session.tree.root); },
  coverage: (xml, session) => { const files = parseClover(xml, session.tree.projectRoot); gutter.coverage(files); coverageWindow.show(files, session.config.name); },
  engine: async config => {
   environment ??= sdk.api.testEnvironment();
   let env: Awaited<typeof environment>;
   try { env = await environment; } catch (error) { environment = undefined; return `${tr('Não foi possível verificar o PHP para cobertura:')} ${String((error as Error)?.message ?? error)}`; }
   const wanted = config.coverage;
   if (wanted === 'xdebug' && env.xdebug) return 'xdebug';
   if (wanted === 'pcov' && env.pcov) return 'pcov';
   if (!wanted && env.pcov) return 'pcov';
   if (!wanted && env.xdebug) return 'xdebug';
   const missing = wanted === 'pcov' ? 'PCOV' : wanted === 'xdebug' ? 'Xdebug' : tr('Xdebug ou PCOV');
   return `${tr('Cobertura indisponível: o PHP')} ${env.version} (${env.php}) ${tr('não tem')} ${missing}. ${tr('Instale/ative a extensão ou escolha outro mecanismo em Editar configurações.')}`;
  },
 });
 const run = (config: RunConfiguration, coverage?: boolean) => void runWindow.start(config, { coverage });
 const configs = mountConfigs({
  framework: () => framework, run,
  currentFile: () => {
   const path = activePath();
   if (!framework || !path || !isTestFile(path)) return null;
   return () => run({ ...fromTest(framework!, path, null), id: 'current-file', temporary: true }, false);
  },
 });
 /** Ação do gutter/teclado sobre um teste: cria (ou reaproveita) a temporária e executa. */
 function act(action: GutterAction, path: string, test: TestCase | null) {
  if (!framework) { sdk.host.status(tr('PHPUnit/Pest não detectado no composer.json do projeto.')); return; }
  const config = configs.temporary(fromTest(framework, path, test));
  if (action === 'edit') configs.edit(config.id);
  else run(config, action === 'coverage');
 }
 const gutter = mountGutter({ framework: () => framework, act });

 // Atalhos (perfil JetBrains macOS da ajuda pública: ⌃R, ⌃⇧R, ⌘R, ⌘F2).
 const category = 'Executar';
 const action = (id: string, label: string, aliases: string, defaults: Record<string, string | undefined>, run: () => void, enabled: () => boolean, context?: string) =>
  sdk.keymap.registerAction({ id, label, category, aliases, context, defaults: Object.fromEntries(Object.entries(defaults).filter(([, v]) => v)), enabled, run });
 action('tests.runSelected', 'Executar a configuração selecionada', 'run phpunit pest test executar', { mac: 'Ctrl+R', other: 'Shift+F10' }, () => configs.runSelected(), () => !!configs.selected() || !!(framework && isTestFile(activePath() ?? '')));
 action('tests.runContext', 'Executar o teste sob o cursor', 'run context test method executar contexto', { mac: 'Ctrl+Shift+R', other: 'Ctrl+Shift+F10' }, () => { const here = gutter.atCaret(); if (here) act('run', here.path, here.test); }, () => !!gutter.file(), 'editor');
 action('tests.rerun', 'Executar novamente', 'rerun tests', { mac: 'Meta+R', other: 'Ctrl+F5' }, () => runWindow.rerun(), () => !!runWindow.active());
 action('tests.rerunFailed', 'Executar novamente os testes com falha', 'rerun failed tests', {}, () => runWindow.rerunFailed(), () => !!runWindow.active() && !runWindow.running());
 action('tests.stop', 'Interromper os testes', 'stop tests', { mac: 'Meta+F2', other: 'Ctrl+F2' }, () => runWindow.stop(), () => runWindow.running());
 action('tests.runWithCoverage', 'Executar com cobertura', 'coverage pcov xdebug', {}, () => { const c = configs.selected(); if (c) run(c, true); else { const here = gutter.atCaret(); if (here) act('coverage', here.path, null); } }, () => !!configs.selected() || !!gutter.file());
 action('tests.runPopup', 'Executar…', 'run popup configurations executar', { mac: 'Ctrl+Alt+R', other: 'Alt+Shift+F10' }, () => configs.popup(), () => true);
 action('tests.editConfigurations', 'Editar configurações de execução…', 'edit run configurations', {}, () => configs.edit(), () => true);
 sdk.own(sdk.keymap.onChange(() => configs.refresh()));
 // "Arquivo atual" acompanha o arquivo aberto.
 const { editor } = sdk.host;
 const changed = editor.onDidChangeModel(() => configs.refresh()); sdk.own(() => changed.dispose());

 void sdk.api.workspace().then(w => { setRoot(w.root); gutter.refresh(); configs.refresh(); }).catch(() => {});
 void configs.load(); void detect();
 return {
  /** Pedido do CodeLens de versões antigas do plugin (compatibilidade com o comando registrado no host). */
  run(request: TestRunRequest) {
   if (!request?.path) return;
   framework ??= request.framework;
   const test: TestCase | null = request.filter ? { kind: request.framework === 'pest' ? 'pest' : 'method', name: request.label, label: request.label, line: 0, filter: request.filter } : null;
   const config = configs.temporary({ ...fromTest(request.framework, request.path, test), ...(request.filter ? { filter: request.filter } : {}) });
   run(config);
  },
  reset() { runWindow.reset(); coverageWindow.reset(); gutter.coverage(null); void configs.load(); void detect(); },
 };
}
