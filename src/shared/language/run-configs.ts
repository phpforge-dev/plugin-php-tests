// Configurações de execução PHPUnit/Pest. Campos e escopos seguem a documentação pública
// "Run/Debug configuration: PHPUnit" da JetBrains (Test scope, alternative configuration file,
// Test runner options, Preferred Coverage engine). Formato de arquivo próprio do php-ide.
import { pestFilter, phpunitFilter, type TestCase, type TestFramework } from './php-tests';

export type RunScope = 'directory' | 'file' | 'class' | 'method' | 'config';
export type CoverageEngine = 'xdebug' | 'pcov';
export type RunConfiguration = {
 id: string; name: string; framework: TestFramework; scope: RunScope;
 /** Pasta (escopo directory) ou arquivo (file/class/method), relativo à raiz. */
 path: string;
 /** PHPUnit: FQN da classe. */
 className?: string;
 /** PHPUnit: nome do método; Pest: descrição completa (com prefixos de describe). */
 method?: string;
 /** Filtro já calculado pela descoberta (describe do Pest, por exemplo). */
 filter?: string;
 configFile?: string; options?: string; coverage?: CoverageEngine;
 /** Criada por uma ação do editor e ainda não salva (como as temporárias da referência). */
 temporary?: boolean;
};
export type ConfigStore = { version: 1; selected?: string; configurations: RunConfiguration[] };
export type RunPlan = { framework: TestFramework; path: string; filter: string; extra: { configuration?: string; options: string[]; coverage?: CoverageEngine } };

/** Limite de temporárias mantidas na lista (a referência usa 5 por padrão). */
export const TEMPORARY_LIMIT = 5;
export const scopeLabels: Record<TestFramework, Partial<Record<RunScope, string>>> = {
 phpunit: { directory: 'Diretório', class: 'Classe', method: 'Método', config: 'Definido no arquivo de configuração' },
 pest: { directory: 'Diretório', file: 'Arquivo', method: 'Teste', config: 'Definido no arquivo de configuração' },
};

const base = (path: string) => path.split('/').filter(Boolean).pop() ?? path;
const short = (fqn: string) => fqn.split('\\').pop()!;

/** Nome padrão: classe, `Classe::método`, arquivo, pasta ou o próprio framework. */
export function defaultName(c: Omit<RunConfiguration, 'id' | 'name'>): string {
 switch (c.scope) {
  case 'directory': return c.path && c.path !== '.' ? base(c.path) : 'tests';
  case 'file': return base(c.path);
  case 'class': return c.className ? short(c.className) : base(c.path).replace(/\.php$/, '');
  case 'method': return c.framework === 'phpunit' ? `${c.className ? short(c.className) : base(c.path).replace(/\.php$/, '')}::${c.method ?? ''}` : `${base(c.path).replace(/\.php$/, '')}::${c.method ?? ''}`;
  default: return c.framework === 'pest' ? 'Pest' : 'PHPUnit';
 }
}

/** Mensagem de erro como a do diálogo de referência (mostrada sob o formulário), ou null. */
export function validate(c: RunConfiguration, names: string[] = []): string | null {
 if (!c.name.trim()) return 'Informe um nome para a configuração';
 if (names.filter(n => n === c.name).length > 1) return `Já existe uma configuração chamada '${c.name}'`;
 if (c.scope === 'directory' && !c.path.trim()) return 'Diretório não especificado';
 if (['file', 'class', 'method'].includes(c.scope) && !/\.php$/.test(c.path)) return 'Arquivo de teste não especificado';
 if (c.scope === 'class' && !c.className?.trim()) return 'Classe não especificada';
 if (c.scope === 'method' && !c.method?.trim() && !c.filter) return c.framework === 'pest' ? 'Teste não especificado' : 'Método não especificado';
 try { splitOptions(c.options ?? ''); } catch (error) { return String((error as Error).message); }
 return null;
}

/** Divide as opções do runner como um shell faria com aspas simples/duplas, sem expandir nada. */
export function splitOptions(text: string): string[] {
 const out: string[] = []; let word = ''; let quote = ''; let has = false;
 for (const ch of text) {
  if (quote) { if (ch === quote) quote = ''; else word += ch; continue; }
  if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
  if (/\s/.test(ch)) { if (has) out.push(word); word = ''; has = false; continue; }
  word += ch; has = true;
 }
 if (quote) throw Error('Aspas não fechadas nas opções do runner');
 if (has) out.push(word);
 return out;
}

/** Plano validado que o serviço nativo confere de novo antes de executar. */
export function planFor(c: RunConfiguration, coverage?: CoverageEngine): RunPlan {
 let filter = '';
 if (c.scope === 'method') filter = c.filter ?? (c.framework === 'phpunit' ? phpunitFilter(c.method ?? '', c.className) : pestFilter(c.method ?? ''));
 const path = c.scope === 'config' ? '' : c.path;
 return { framework: c.framework, path, filter, extra: { configuration: c.configFile || undefined, options: splitOptions(c.options ?? ''), coverage } };
}

/** Configuração temporária para uma ação do editor (classe, método, describe, teste ou arquivo). */
export function fromTest(framework: TestFramework, path: string, test: TestCase | null): Omit<RunConfiguration, 'id'> {
 let c: Omit<RunConfiguration, 'id' | 'name'>;
 if (!test) c = { framework, scope: framework === 'pest' ? 'file' : 'class', path };
 else if (test.kind === 'class') c = { framework, scope: 'class', path, className: test.name };
 else if (test.kind === 'method') c = { framework, scope: 'method', path, className: test.name.split('::')[0], method: test.label };
 else c = { framework, scope: 'method', path, method: test.kind === 'describe' ? test.label : test.name, filter: test.filter };
 return { ...c, name: defaultName(c), temporary: true };
}

/** Mesma execução (mesmo plano), para reaproveitar a temporária em vez de duplicar. */
export const sameTarget = (a: Omit<RunConfiguration, 'id'>, b: Omit<RunConfiguration, 'id'>) =>
 a.framework === b.framework && a.scope === b.scope && a.path === b.path && (a.className ?? '') === (b.className ?? '') && (a.method ?? '') === (b.method ?? '') && (a.filter ?? '') === (b.filter ?? '');

/** Adiciona/seleciona uma temporária, descartando as mais antigas acima do limite. */
export function addTemporary(store: ConfigStore, config: Omit<RunConfiguration, 'id'>, id: () => string): RunConfiguration {
 const existing = store.configurations.find(c => sameTarget(c, config));
 if (existing) { store.selected = existing.id; return existing; }
 const created = { ...config, id: id() } as RunConfiguration;
 store.configurations.push(created); store.selected = created.id;
 const temporary = store.configurations.filter(c => c.temporary);
 for (const old of temporary.slice(0, Math.max(0, temporary.length - TEMPORARY_LIMIT))) store.configurations.splice(store.configurations.indexOf(old), 1);
 return created;
}

/** O que é gravado no projeto: só as salvas, sem as temporárias. */
export function persisted(store: ConfigStore): ConfigStore {
 const configurations = store.configurations.filter(c => !c.temporary);
 return { version: 1, selected: configurations.some(c => c.id === store.selected) ? store.selected : undefined, configurations };
}

/** Lê o arquivo do projeto tolerando campos desconhecidos e descartando entradas inválidas. */
export function normalize(value: unknown): ConfigStore {
 const raw = (value ?? {}) as { selected?: unknown; configurations?: unknown[] };
 const scopes: RunScope[] = ['directory', 'file', 'class', 'method', 'config'];
 const configurations = (Array.isArray(raw.configurations) ? raw.configurations : []).flatMap(item => {
  const c = item as Partial<RunConfiguration>;
  if (typeof c?.id !== 'string' || typeof c.name !== 'string' || !['pest', 'phpunit'].includes(c.framework as string) || !scopes.includes(c.scope as RunScope) || typeof c.path !== 'string') return [];
  const str = (v: unknown) => typeof v === 'string' && v ? v : undefined;
  return [{ id: c.id, name: c.name, framework: c.framework!, scope: c.scope!, path: c.path, className: str(c.className), method: str(c.method), filter: str(c.filter), configFile: str(c.configFile), options: str(c.options), coverage: c.coverage === 'xdebug' || c.coverage === 'pcov' ? c.coverage : undefined } as RunConfiguration];
 });
 return { version: 1, selected: typeof raw.selected === 'string' ? raw.selected : undefined, configurations };
}

/**
 * Filtro de "Rerun Failed Tests" a partir dos testes com falha da última execução.
 * PHPUnit: identidade exata, inclusive o data set. Pest: o filtro casa com a descrição e não
 * seleciona um data set isolado (observado no Pest 3.8), então o teste inteiro é repetido e
 * `broadened` avisa a interface.
 */
export function failedFilter(framework: TestFramework, failed: { name: string; fqn?: string }[]): { filter: string; broadened: boolean } {
 const esc = (v: string) => v.replace(/[\\^$.*+?()[\]{}|/#]/g, '\\$&');
 if (framework === 'phpunit') {
  const ids = [...new Set(failed.map(f => f.fqn ?? f.name))];
  return { filter: `/(?:${ids.map(esc).join('|')})$/`, broadened: false };
 }
 const names = failed.map(f => f.fqn ?? f.name);
 const plain = [...new Set(names.map(n => n.replace(/ with data set .*$/s, '')))];
 return { filter: plain.length === 1 ? pestFilter(plain[0]) : `(?:${plain.map(pestFilter).join('|')})`, broadened: names.some(n => / with data set /.test(n)) };
}
