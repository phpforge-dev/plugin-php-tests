// Ícones próprios (SVG 16×16 desenhado aqui), no espírito dos ícones de execução de testes da
// referência: triângulo de executar, estados aprovado/falhou/ignorado e ações da janela Run.
const svg = (body: string, cls = '') => `<svg class="pt-icon ${cls}" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
const play = '<path d="M4.5 3.2v9.6L12.6 8z" fill="var(--pt-run)"/>';
const playAll = '<path d="M2.5 3.5v9L8.5 8z" fill="var(--pt-run)"/><path d="M7.5 3.5v9L13.5 8z" fill="var(--pt-run)"/>';
/** Selos de estado sobre o triângulo (canto inferior direito). */
export const badges = {
 passed: '<circle cx="11.5" cy="11.5" r="3.6" fill="var(--pt-passed)"/><path d="m9.8 11.6 1.2 1.2 2.2-2.4" stroke="#fff" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
 failed: '<circle cx="11.5" cy="11.5" r="3.6" fill="var(--pt-failed)"/><path d="m10.1 10.1 2.8 2.8m0-2.8-2.8 2.8" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>',
 ignored: '<circle cx="11.5" cy="11.5" r="3.6" fill="var(--pt-ignored)"/><path d="M9.9 11.5h3.2" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>',
};
export const runIcon = (all: boolean, state?: keyof typeof badges) => `<svg viewBox="0 0 16 16">${all ? playAll : play}${state ? badges[state] : ''}</svg>`;
export const icons = {
 run: svg(play, 'pt-run'),
 runAll: svg(playAll, 'pt-run'),
 /** Estado no gutter: triângulo com selo (aprovado ✓, falhou ✗, ignorado –). */
 runPassed: svg(play + badges.passed, 'pt-run'),
 runFailed: svg(play + badges.failed, 'pt-run'),
 runIgnored: svg(play + badges.ignored, 'pt-run'),
 passed: svg('<circle cx="8" cy="8" r="6" fill="none" stroke="var(--pt-passed)" stroke-width="1.4"/><path d="m5.3 8.1 1.9 1.9 3.6-3.9" stroke="var(--pt-passed)" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
 failed: svg('<circle cx="8" cy="8" r="6" fill="none" stroke="var(--pt-assert)" stroke-width="1.4"/><path d="m5.8 5.8 4.4 4.4m0-4.4-4.4 4.4" stroke="var(--pt-assert)" stroke-width="1.4" stroke-linecap="round"/>'),
 ignored: svg('<circle cx="8" cy="8" r="6" fill="none" stroke="var(--pt-ignored)" stroke-width="1.4"/><path d="m4 12 8-8" stroke="var(--pt-ignored)" stroke-width="1.4"/>'),
 terminated: svg('<circle cx="8" cy="8" r="6" fill="none" stroke="var(--pt-ignored)" stroke-width="1.4"/><rect x="5.6" y="5.6" width="4.8" height="4.8" rx=".6" fill="var(--pt-ignored)"/>'),
 running: svg('<circle cx="8" cy="8" r="6" fill="none" stroke="var(--pt-track)" stroke-width="1.6"/><path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="var(--pt-running)" stroke-width="1.6" stroke-linecap="round"/>', 'pt-spin'),
 pending: svg('<circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--pt-track)" stroke-width="1.4" stroke-dasharray="2 2"/>'),
 rerun: svg('<path d="M12.6 6.2A5 5 0 1 0 13 9" fill="none" stroke="var(--pt-run)" stroke-width="1.4" stroke-linecap="round"/><path d="M13.3 2.8v3.6H9.7" fill="none" stroke="var(--pt-run)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),
 rerunFailed: svg('<path d="M11.8 5.8A4.6 4.6 0 1 0 12 9" fill="none" stroke="var(--pt-run)" stroke-width="1.4" stroke-linecap="round"/><path d="M12.4 2.6v3.4H9" fill="none" stroke="var(--pt-run)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="11.6" cy="11.6" r="3.4" fill="var(--pt-failed)"/><path d="m10.4 10.4 2.4 2.4m0-2.4-2.4 2.4" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>'),
 autoTest: svg('<path d="M11.8 5.8A4.6 4.6 0 1 0 12 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M12.4 2.6v3.4H9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="11.6" cy="11.6" r="3.4" fill="var(--pt-bg)" stroke="currentColor" stroke-width="1.1"/><path d="M11.6 10.2v1.5l1 .7" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round"/>'),
 stop: svg('<rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="var(--pt-stop)"/>'),
 showPassed: svg('<path d="m3.5 8.3 2.9 2.9 6.1-6.4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
 showIgnored: svg('<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="m4.2 11.8 7.6-7.6" stroke="currentColor" stroke-width="1.3"/>'),
 sortAlpha: svg('<path d="M2.5 11.5 4.6 4.5h.8l2.1 7M3.2 9.3h3.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.5 3.5v9m-2-2 2 2 2-2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),
 sortDuration: svg('<circle cx="6.5" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6.5 5.5V8l1.6 1.2" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M13 3.5v9m-1.6-1.6 1.6 1.6 1.6-1.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),
 expand: svg('<path d="m4.5 3.5 3.5 3.5 3.5-3.5M4.5 9l3.5 3.5L11.5 9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),
 collapse: svg('<path d="m4.5 7 3.5-3.5L11.5 7M4.5 12.5 8 9l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),
 previous: svg('<path d="M8 12.5v-9m-3.5 3.5L8 3.5 11.5 7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),
 next: svg('<path d="M8 3.5v9m-3.5-3.5L8 12.5 11.5 9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),
 coverage: svg('<path d="M4.5 3.2v9.6L12.6 8z" fill="none" stroke="var(--pt-run)" stroke-width="1.2" stroke-linejoin="round"/><path d="M2 13.5h12" stroke="var(--pt-passed)" stroke-width="1.6"/><path d="M10 13.5h4" stroke="var(--pt-failed)" stroke-width="1.6"/>'),
 chevron: svg('<path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>', 'pt-chevron'),
 down: svg('<path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),
 phpunit: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2.5" fill="none" stroke="var(--pt-phpunit)" stroke-width="1.3"/><path d="M5.5 10.5V5.5h2.2a1.5 1.5 0 0 1 0 3H5.5" fill="none" stroke="var(--pt-phpunit)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),
 pest: svg('<path d="M8 2.5 13.5 13H2.5z" fill="none" stroke="var(--pt-pest)" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="9.8" r="1.3" fill="var(--pt-pest)"/>'),
 close: svg('<path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),
 add: svg('<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),
 remove: svg('<path d="M3 8h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),
 copy: svg('<rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3 10.5V4a1 1 0 0 1 1-1h6.5" fill="none" stroke="currentColor" stroke-width="1.2"/>'),
 settings: svg('<circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),
} as const;
export type IconName = keyof typeof icons;
export const icon = (name: IconName) => { const span = document.createElement('span'); span.className = 'pt-icon-box'; span.innerHTML = icons[name]; return span; };
