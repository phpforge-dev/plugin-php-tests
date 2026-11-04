import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coverageTree, findNode, label, lineStates, parseClover, percent, statistics, uncoveredFrom } from '../src/shared/language/coverage';

const xml = readFileSync(join(process.env.PHP_TESTS_FIXTURES!, 'phpunit-11.clover.xml'), 'utf8');

test('Clover: arquivos do projeto, linhas e classes', () => {
 const files = parseClover(xml, '/projeto');
 assert.deepEqual(files.map(f => f.path), ['src/Calculator.php', 'src/Formatter.php']);
 const formatter = files[1];
 // A declaração do método também tem marca (observado na referência).
 assert.deepEqual([...lineStates(formatter)], [[8, { covered: true, count: 1 }], [10, { covered: true, count: 1 }], [13, { covered: false, count: 0 }], [15, { covered: false, count: 0 }], [16, { covered: false, count: 0 }]]);
 assert.equal(parseClover(xml, '/outro').length, 0, 'fora da raiz é ignorado');
});

test('estatísticas como na referência: % de arquivos e linhas (método + instrução), truncado', () => {
 const tree = coverageTree(parseClover(xml, '/projeto'));
 const src = tree.children[0];
 assert.equal(src.name, 'src');
 const formatter = src.children.find(c => c.name === 'Formatter.php')!;
 assert.deepEqual(formatter.lines, { covered: 2, total: 5 });
 assert.equal(statistics(formatter), '40% lines');
 assert.equal(statistics(src), '100% files, 66% lines');
 assert.equal(statistics(src, { files: 'arquivos', lines: 'linhas' }), '100% arquivos, 66% linhas');
 assert.equal(findNode(tree, 'src/Formatter.php'), formatter);
 assert.equal(label({ covered: 0, total: 0 }), '–');
 assert.equal(percent({ covered: 7, total: 13 }), 53, 'Money no PhpStorm: 7/13 → 53%');
 // Pastas aninhadas não são compactadas (src › Money › Rates).
 const nested = coverageTree([{ path: 'src/Money/Rates/Table.php', lines: [{ line: 9, count: 1 }, { line: 14, count: 0 }], classes: [] }, { path: 'src/Money/Currency.php', lines: [{ line: 8, count: 0 }], classes: [] }]);
 assert.deepEqual(nested.children.map(c => c.name), ['src']);
 assert.deepEqual(nested.children[0].children[0].children.map(c => c.name), ['Rates', 'Currency.php']);
 assert.equal(statistics(nested.children[0]), '50% files, 33% lines');
});

test('próxima/anterior não coberta: início de cada trecho, sem dar a volta', () => {
 const states = new Map([[8, true], [10, true], [12, true], [14, true], [17, false], [19, false], [20, false], [21, false], [22, false]].map(([n, c]) => [n as number, { covered: c as boolean }]));
 assert.equal(uncoveredFrom(states, 14, 1), 17);
 assert.equal(uncoveredFrom(states, 17, 1), 19, 'linha 18 sem marca separa os trechos');
 assert.equal(uncoveredFrom(states, 19, 1), undefined, '20–22 continuam o trecho de 19');
 assert.equal(uncoveredFrom(states, 21, -1), 19);
 assert.equal(uncoveredFrom(states, 17, -1), undefined);
});
