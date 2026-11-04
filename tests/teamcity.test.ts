import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunTree, counts, failureLine, formatDuration, leaves, parseLocation, parseMessage, total } from '../src/shared/language/teamcity';

const fixture = (name: string) => readFileSync(join(process.env.PHP_TESTS_FIXTURES!, name), 'utf8');
const build = (text: string) => { const tree = new RunTree('Test Results', '/projeto'); for (const line of text.split('\n')) tree.line(line); tree.finish(false); return tree; };

test('mensagens TeamCity: escapes e linhas comuns', () => {
 assert.deepEqual(parseMessage("##teamcity[testFailed name='a |'b|'' details='x|ny|[1|]' flowId='9']"), { name: 'testFailed', attrs: { name: "a 'b'", details: 'x\ny[1]', flowId: '9' } });
 assert.equal(parseMessage('PHPUnit 11.5'), null);
 assert.deepEqual(parseLocation('php_qn:///projeto/tests/Unit/ATest.php::\\Tests\\Unit\\ATest::testX', '/projeto'), { file: 'tests/Unit/ATest.php', fqn: 'Tests\\Unit\\ATest::testX' });
 assert.deepEqual(parseLocation('pest_qn://tests/Unit/ATest.php::it works', '/projeto'), { file: 'tests/Unit/ATest.php', fqn: 'it works' });
 assert.deepEqual(parseLocation('php_qn:///fora/ATest.php::\\A', '/projeto'), { file: undefined, fqn: 'A' }, 'caminho fora do projeto não vira navegação');
});

test('PHPUnit 11: árvore, data sets, comparação, saída e totais', () => {
 const tree = build(fixture('phpunit-11.teamcity.txt'));
 assert.equal(tree.root.children[0].name, 'CLI Arguments', 'suíte do runner aparece como na referência');
 const [calc, comparison] = tree.root.children[0].children;
 assert.equal(calc.name, 'Tests\\Unit\\CalculatorTest');
 assert.equal(calc.status, 'failed');
 const sums = calc.children.find(c => c.name === 'testSums')!;
 assert.equal(sums.kind, 'suite');
 assert.deepEqual(sums.children.map(c => [c.name, c.status]), [['testSums with data set "zero"', 'passed'], ['testSums with data set "positivos"', 'passed']]);
 const failed = calc.children.find(c => c.name === 'testFailsOnPurpose')!;
 assert.equal(failed.message, 'Failed asserting that 4 is identical to 5.');
 assert.equal(failed.file, 'tests/Unit/CalculatorTest.php');
 assert.equal(failureLine(failed), 26);
 const text = comparison.children.find(c => c.name === 'testComparesText')!;
 assert.deepEqual(text.comparison, { expected: "'linha 1\nlinha 2'", actual: "'linha 1\nlinha dois'" });
 assert.ok(text.output.includes('saída do teste'), 'saída fica no teste');
 assert.equal(calc.children.find(c => c.name === 'testSkipped')!.status, 'ignored');
 assert.equal(tree.count, 9);
 assert.deepEqual(counts(tree.root), { total: 9, passed: 5, failed: 3, ignored: 1, terminated: 0, running: 0 });
 assert.equal(tree.root.status, 'failed');
 assert.ok(total(tree.root) >= 0);
});

test('Pest 3: suíte de data set abreviada recebe o nome do teste', () => {
 const tree = build(fixture('pest-3.teamcity.txt'));
 const all = leaves(tree.root);
 const calc = tree.root.children[0].children.find(c => c.name === 'Tests\\Unit\\CalculatorTest')!;
 assert.ok(calc.children.some(c => c.kind === 'suite' && c.name === '`datasets` → it sums'));
 assert.ok(all.some(l => l.name === "name with 'quotes' and (parens)" && l.status === 'passed'));
 const failed = all.find(l => l.name === 'it fails on purpose')!;
 assert.equal(failed.file, 'tests/Unit/CalculatorTest.php');
 assert.equal(failureLine(failed), 14);
 assert.ok(all.find(l => l.name === 'it compares lists')!.comparison);
});

test('execução interrompida nunca vira aprovada', () => {
 const tree = new RunTree('x', '/p');
 tree.line("##teamcity[testStarted name='a']");
 tree.finish(true);
 assert.equal(leaves(tree.root)[0].status, 'terminated');
 assert.equal(tree.root.status, 'terminated');
 assert.equal(formatDuration(850), '850 ms');
 assert.equal(formatDuration(1250), '1 s 250 ms');
 assert.equal(formatDuration(125000), '2 m 5 s');
});
