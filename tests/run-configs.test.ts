import test from 'node:test';
import assert from 'node:assert/strict';
import { addTemporary, defaultName, failedFilter, fromTest, normalize, persisted, planFor, splitOptions, validate, TEMPORARY_LIMIT, type ConfigStore } from '../src/shared/language/run-configs';

test('nomes padrão por escopo', () => {
 assert.equal(defaultName({ framework: 'phpunit', scope: 'method', path: 'tests/Unit/CalculatorTest.php', className: 'Tests\\Unit\\CalculatorTest', method: 'testSums' }), 'CalculatorTest::testSums');
 assert.equal(defaultName({ framework: 'phpunit', scope: 'class', path: 'tests/Unit/CalculatorTest.php', className: 'Tests\\Unit\\CalculatorTest' }), 'CalculatorTest');
 assert.equal(defaultName({ framework: 'pest', scope: 'file', path: 'tests/Unit/CalculatorTest.php' }), 'CalculatorTest.php');
 assert.equal(defaultName({ framework: 'pest', scope: 'directory', path: 'tests/Unit' }), 'Unit');
 assert.equal(defaultName({ framework: 'pest', scope: 'config', path: '' }), 'Pest');
});

test('validação mostra o erro do formulário', () => {
 const base = { id: '1', name: 'X', framework: 'phpunit' as const, scope: 'method' as const, path: 'tests/ATest.php', className: 'ATest' };
 assert.equal(validate(base), 'Método não especificado');
 assert.equal(validate({ ...base, method: 'testA' }), null);
 assert.equal(validate({ ...base, method: 'testA', name: ' ' }), 'Informe um nome para a configuração');
 assert.equal(validate({ ...base, method: 'testA' }, ['X', 'X']), "Já existe uma configuração chamada 'X'");
 assert.equal(validate({ ...base, scope: 'directory', path: '' }), 'Diretório não especificado');
 assert.equal(validate({ ...base, method: 'testA', options: '--group "a' }), 'Aspas não fechadas nas opções do runner');
});

test('opções do runner sem shell e plano por escopo', () => {
 assert.deepEqual(splitOptions(`--group fast --filter-ish "a b" '' x`), ['--group', 'fast', '--filter-ish', 'a b', '', 'x']);
 const plan = planFor({ id: '1', name: 'm', framework: 'phpunit', scope: 'method', path: 'tests/ATest.php', className: 'T\\ATest', method: 'testA', options: '--stop-on-failure', configFile: 'phpunit.ci.xml' }, 'pcov');
 assert.deepEqual(plan, { framework: 'phpunit', path: 'tests/ATest.php', filter: '/T\\\\ATest::testA( with data set .*)?$/', extra: { configuration: 'phpunit.ci.xml', options: ['--stop-on-failure'], coverage: 'pcov' } });
 assert.equal(planFor({ id: '1', name: 'c', framework: 'pest', scope: 'config', path: 'ignored' }).path, '');
});

test('temporárias: reaproveita o mesmo alvo, limite e só as salvas vão para o arquivo', () => {
 const store: ConfigStore = { version: 1, configurations: [{ id: 'saved', name: 'Unit', framework: 'pest', scope: 'directory', path: 'tests/Unit' }] };
 let n = 0; const id = () => `t${++n}`;
 const first = addTemporary(store, fromTest('pest', 'tests/ATest.php', { kind: 'pest', name: 'it a', label: 'it a', line: 1, filter: 'it a' }), id);
 assert.equal(first.name, 'ATest::it a');
 assert.equal(addTemporary(store, fromTest('pest', 'tests/ATest.php', { kind: 'pest', name: 'it a', label: 'it a', line: 1, filter: 'it a' }), id), first);
 for (let i = 0; i < 7; i++) addTemporary(store, fromTest('pest', `tests/X${i}Test.php`, null), id);
 assert.equal(store.configurations.filter(c => c.temporary).length, TEMPORARY_LIMIT);
 assert.ok(!store.configurations.includes(first), 'a mais antiga sai');
 store.selected = 'saved';
 assert.deepEqual(persisted(store), { version: 1, selected: 'saved', configurations: [store.configurations[0]] });
 assert.deepEqual(normalize({ configurations: [{ id: 1 }, { id: 'a', name: 'A', framework: 'x', scope: 'file', path: '' }, ...persisted(store).configurations] }).configurations.length, 1);
});

test('Rerun Failed: PHPUnit exato com data set; Pest amplia data sets e avisa', () => {
 assert.deepEqual(failedFilter('phpunit', [{ name: 'testFailsOnPurpose', fqn: 'Tests\\Unit\\CalculatorTest::testFailsOnPurpose' }, { name: 'x', fqn: 'Tests\\Unit\\CalculatorTest::testSums with data set "zero"' }]), { filter: '/(?:Tests\\\\Unit\\\\CalculatorTest::testFailsOnPurpose|Tests\\\\Unit\\\\CalculatorTest::testSums with data set "zero")$/', broadened: false });
 assert.deepEqual(failedFilter('pest', [{ name: 'it a', fqn: 'it a' }]), { filter: 'it a', broadened: false });
 assert.deepEqual(failedFilter('pest', [{ name: 'x', fqn: '`d` → it sums with data set "(0, 0, 0)"' }, { name: 'it b (1)', fqn: 'it b (1)' }]), { filter: '(?:`d` → it sums|it b \\(1\\))', broadened: true });
 // Um data set isolado (menu da árvore Run): exato no PHPUnit; no Pest o teste inteiro, com aviso.
 assert.deepEqual(failedFilter('phpunit', [{ name: 'testSums with data set "zero"', fqn: 'Tests\\Unit\\CalculatorTest::testSums with data set "zero"' }]), { filter: '/(?:Tests\\\\Unit\\\\CalculatorTest::testSums with data set "zero")$/', broadened: false });
 assert.deepEqual(failedFilter('pest', [{ name: 'it counts executions with data set "(\'usd\')"', fqn: 'it counts executions with data set "(\'usd\')"' }]), { filter: 'it counts executions', broadened: true });
});
