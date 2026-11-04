# PHPUnit / Pest plugin

Standalone plugin for PHP IDE 0.2.11+. The IDE does not compile this tool into its application binary. Install from the Marketplace or `https://github.com/phpforge-dev/plugin-php-tests` using **Plugins → Install from Git**. Review and grant the permissions before activation.

## Package

- `main.js`: sandboxed language contributions (where applicable).
- `workbench.js` / `workbench.css`: separately consented workbench integration.
- `native/`: Rust service source; JSON-lines protocol version 1 over stdio.
- `bin/<architecture>-<os>/`: prebuilt service with SHA-256 recorded in `plugin.json`.

Installation never runs npm, Cargo or project build scripts. The host checks platform/checksum, starts the installed executable on demand, and owns its lifetime. Disabling/removing the plugin closes its UI, listeners and native process. PHP editing remains usable without it.

## Trust and permissions

`native.tool` executes native code with your account privileges; it is not an OS sandbox. `workbench` runs UI code in the IDE window with access to displayed data. These capabilities are separate from ordinary isolated language plugins. Install only trusted packages. `project.read` permits reading project files. The default installation must not automatically grant native/UI permissions.

No passwords or private credentials belong in this repository, fixtures or logs. Do not send runtime values or tool output to an agent automatically.

## Development

Use Node only to build browser assets and Rust to build the tool. There is no Node application backend.

```sh
npm ci --ignore-scripts
npm run build
npm test            # TypeScript (esbuild + node:test) and Rust tests
cargo build --release --manifest-path native/Cargo.toml
node scripts/record-binary.mjs
```

The workflow tests and publishes prebuilt macOS arm64, Windows x64 and Linux x64 executables. A build succeeding is not a claim of full native UI validation on that OS. Unsupported platforms show a setup error; there is no fallback to a hidden built-in service.

## Features

- **Run configurations**: selector in the IDE's Run widget (temporary configurations from editor actions, saved ones in `.php-ide/run-configurations.json`), edit dialog with test scope, alternative configuration file, runner options and preferred coverage engine.
- **Gutter**: ▶ per test/class (PHPUnit) or test/describe (Pest) with the last result (passed, failed, ignored) and a menu: Run, Run with Coverage, Modify Run Configuration.
- **Run window**: tabs per configuration, live tree from `--teamcity` messages, console per selection, Esperado × Obtido diff for comparison failures, filters, sorting and failed-test navigation.
- **Rerun Failed Tests** (exact identities for PHPUnit, whole test for Pest data sets) and **auto-test** (3 s after a PHP file changes).
- **Coverage** with Xdebug or PCOV: Clover report, gutter marks and a Coverage window with class/method/line percentages.
- **Pest**: completion and go to declaration of datasets in `->with('…')`; `expect()` member completion with the expectation type and higher order members.

The native service methods are `testRun`, `testCancel`, `testEnvironment`, `testConfigRead` and `testConfigWrite`.

## Validation scope

Native unit tests are migrated from the independent PHP IDE implementation. Use only disposable fixture projects/containers. Integration with the IDE must be checked through real Tauri IPC, including consent, disable/remove, stale events and provider absence. No PhpStorm compatibility is claimed.

License: MIT. Originally extracted from phpforge-dev/php-ide; see LICENSE.
