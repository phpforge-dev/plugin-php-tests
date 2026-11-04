// SDK de workbench entregue pelo host em `activate`; os módulos de UI leem daqui.
export type Sdk = {
 monaco: any; tr: (s: string) => string; msg: (s: TemplateStringsArray, ...v: unknown[]) => string; html: (s: string | TemplateStringsArray, ...v: unknown[]) => string;
 keymap: { registerAction(spec: any): () => void; shortcut(id: string): string | undefined; ariaShortcuts(id: string): string | undefined; onChange(fn: () => void): () => void };
 listen(channel: string, fn: (event: { payload: any }) => void): Promise<() => void>;
 own<T extends { dispose(): void } | (() => void)>(item: T): T;
 dockWindow(panel: HTMLElement, button: HTMLElement, hide: () => void): () => void;
 resizeToolWindow(panel: HTMLElement, handle: HTMLElement, key: string, floor?: number): void;
 toolIcon(button: HTMLElement, path: string, label: string): void;
 api: Api; host: Host;
};
export type RunOutput = { command: string; exitCode: number | null; cancelled: boolean; timedOut: boolean; durationMs: number; junit: string | null; clover: string | null; teamcity: string; teamcityTruncated: boolean; output: string; stderr: string };
export type Api = {
 workspace(): Promise<{ root: string; name?: string }>;
 read(path: string): Promise<{ path: string; text: string }>;
 testRun(id: string, framework: string, path: string, filter: string, extra?: unknown): Promise<RunOutput>;
 testCancel(id: string): Promise<void>;
 testEnvironment(): Promise<{ php: string; version: string; xdebug: boolean; pcov: boolean }>;
 testConfigRead(): Promise<unknown>;
 testConfigWrite(value: unknown): Promise<void>;
};
export type Host = { path(): string | undefined; editor: any; open(path: string, line?: number): Promise<void>; status(text: string): void };

export let sdk: Sdk;
let projectRoot = '';
export const setRoot = (root: string) => { projectRoot = root; };
/** Caminho ativo relativo à raiz (o host pode guardar o absoluto depois de "ir para declaração"). */
export function activePath(): string | undefined { const p = sdk.host.path(); return p && projectRoot && p.startsWith(projectRoot + '/') ? p.slice(projectRoot.length + 1) : p; }
export const setSdk = (value: Sdk) => { sdk = value; };
export const tr = (s: string) => sdk.tr(s);

/** Elemento com propriedades e filhos; atributos `data-*`/`aria-*` via `attrs`. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { attrs?: Record<string, string> } = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
 const { attrs, ...rest } = props as any;
 const el = Object.assign(document.createElement(tag), rest);
 for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, v as string);
 for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
 return el;
}
/** Listener de DOM removido quando o plugin é desativado. */
export function on<T extends Event = Event>(target: EventTarget, type: string, fn: (event: T) => void, options?: AddEventListenerOptions) {
 target.addEventListener(type, fn as EventListener, options);
 sdk.own(() => target.removeEventListener(type, fn as EventListener, options));
}
export const disposable = (d: { dispose(): void }) => sdk.own(() => d.dispose());
