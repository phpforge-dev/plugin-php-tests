import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coverageTree, label, lineStates, parseClover, percent } from '../src/shared/language/coverage';

const xml = readFileSync(join(process.env.PHP_TESTS_FIXTURES!, 'phpunit-11.clover.xml'), 'utf8');

test('Clover: arquivos do projeto, linhas e classes', () => {
 const files = parseClover(xml, '/projeto');
 assert.deepEqual(files.map(f => f.path), ['src/Calculator.php', 'src/Formatter.php']);
 const formatter = files[1];
 assert.deepEqual([...lineStates(formatter)], [[10, { covered: true, count: 1 }], [15, { covered: false, count: 0 }], [16, { covered: false, count: 0 }]]);
 assert.equal(parseClover(xml, '/outro').length, 0, 'fora da raiz é ignorado');
});

test('árvore com percentuais de classe, método e linha', () => {
 const tree = coverageTree(parseClover(xml, '/projeto'));
 const src = tree.children[0];
 assert.equal(src.name, 'src');
 const formatter = src.children.find(c => c.name === 'Formatter.php')!;
 assert.deepEqual([formatter.classes, formatter.methods, formatter.lines], [{ covered: 1, total: 1 }, { covered: 1, total: 2 }, { covered: 1, total: 3 }]);
 assert.equal(label(formatter.lines), '33% (1/3)');
 assert.equal(percent(src.methods), 75);
 assert.equal(label({ covered: 0, total: 0 }), '–');
});
