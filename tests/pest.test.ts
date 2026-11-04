import test from 'node:test';
import assert from 'node:assert/strict';
import { datasetsIn, expectChain, inferType, membersOf } from '../src/shared/language/pest';
import { phpTokens } from '../src/shared/language/php-source';
import { PhpTestsPlugin } from '../src/shared/language/plugins/php-tests';
import type { ProjectFiles } from '../src/shared/language/plugins/api';

const files = (map: Record<string, string>): ProjectFiles => ({ root: '/p', read: async p => map[p] ?? null, exists: async p => p in map, list: async (dir, accept) => Object.keys(map).filter(p => p.startsWith(dir + '/') && accept(p.split('/').pop()!)), uri: p => `file:///p/${p}` });
const expectation = `<?php\n/**\n * @property OppositeExpectation $not Creates the opposite expectation.\n * @property EachExpectation $each Creates an expectation on each element.\n */\nfinal class Expectation {\n /** Creates a new expectation. */\n public function and(mixed $value): Expectation {}\n public function __get(string $name) {}\n}\n`;
const mixin = `<?php\nfinal class Expectation {\n /**\n * Asserts that two variables have the same type and value.\n */\n public function toBe(mixed $expected, string $message = ''): self {}\n public function toStartWith(string $expected): self {}\n private function helper() {}\n public static function make() {}\n}\n`;
const project = files({
 'composer.json': JSON.stringify({ 'require-dev': { 'pestphp/pest': '^3' }, autoload: { 'psr-4': { 'App\\': 'src/' } } }),
 'vendor/pestphp/pest/src/Expectation.php': expectation, 'vendor/pestphp/pest/src/Mixins/Expectation.php': mixin,
 'tests/Datasets/Numbers.php': "<?php\ndataset('pairs', [[1, 1]]);\ndataset('money', fn () => [1.0]);\n",
 'tests/Pest.php': "<?php\ndataset('emails', ['a@b']);\n",
 'src/Formatter.php': "<?php\nnamespace App;\nfinal class Formatter {\n public string $currency = 'BRL';\n public function money(float $v): string {}\n}\n",
});

test('datasets: declarações literais, compartilhados e locais', () => {
 const found = datasetsIn('tests/Datasets/Numbers.php', "<?php\ndataset('pairs', []);\n$this->dataset('x');\n// dataset('comentário')\n");
 assert.deepEqual(found.map(d => [d.name, d.shared, d.offset, d.end]), [['pairs', true, 14, 21]]);
});

test('completar e ir para dataset em ->with()', async () => {
 const plugin = new PhpTestsPlugin(); await plugin.detect(project);
 const text = "<?php\ndataset('local', [1]);\nit('x', function ($v) {})->with('');\n";
 const offset = text.indexOf("with('") + 6;
 const site = { path: 'tests/Unit/XTest.php', text, literal: { value: '', start: offset - 1, end: offset + 1, quote: "'", closed: true }, callee: '->with', argument: 0, prefix: '' };
 const items = await plugin.completeString(site, project);
 assert.deepEqual(items!.map(i => i.label).sort(), ['emails', 'local', 'money', 'pairs']);
 const go = await plugin.defineString({ ...site, literal: { ...site.literal, value: 'money' } }, project);
 assert.deepEqual(go, [{ uri: 'file:///p/tests/Datasets/Numbers.php', range: { start: { line: 2, character: 8 }, end: { line: 2, character: 15 } } }]);
 assert.equal(await plugin.completeString({ ...site, callee: 'route' }, project), null);
});

test('expect(): cadeia, negação, and() e tipo do valor', () => {
 const chain = (code: string) => expectChain(code, code.length);
 assert.equal(chain("expect('a')->to")?.valueType, 'string');
 assert.equal(chain("expect('a')->to")?.prefix, 'to');
 assert.equal(chain('expect(1)->not->')?.negated, true);
 assert.equal(chain('expect([1])->each->')?.each, true);
 assert.equal(chain("expect(1)->toBe(1)->and('x')->")?.valueType, 'string');
 assert.equal(chain('expect($user)->name->')?.higherOrder, 'name');
 assert.equal(chain('$this->expect(1)->'), null);
 assert.equal(chain('foo()->'), null);
 const code = "<?php\nuse App\\Formatter;\n$f = new Formatter();\nexpect($f)";
 const tokens = phpTokens(code); const i = tokens.findIndex((t, n) => t.value === 'expect' && n > 5);
 assert.equal(inferType(code, tokens, i + 2, tokens.length - 1), 'App\\Formatter');
 const typed = "<?php\nit('x', function (float $value) { expect($value)->";
 assert.equal(chain(typed)?.valueType, 'float');
 assert.deepEqual(membersOf(mixin).map(m => [m.name, m.signature, m.returns]), [['toBe', "toBe(mixed $expected, string $message = '')", 'self'], ['toStartWith', 'toStartWith(string $expected)', 'self']]);
});

test('completar após expect(…)-> com tipos e higher order', async () => {
 const plugin = new PhpTestsPlugin(); await plugin.detect(project);
 const text = "<?php\nuse App\\Formatter;\nit('x', function () {\n $f = new Formatter();\n expect($f)->";
 const result = await plugin.completeCode({ path: 'tests/Unit/XTest.php', text, offset: text.length, blade: false }, project);
 const by = Object.fromEntries(result!.items.map(i => [i.label, i]));
 assert.equal(by.toBe.labelDetails?.description, 'Expectation<App\\Formatter>');
 assert.equal(by.not.labelDetails?.description, 'OppositeExpectation');
 assert.equal(by.money.labelDetails?.description, '→ Expectation<string>');
 assert.equal(by.currency.labelDetails?.description, '→ Expectation<string>');
 assert.equal(by.toBe.insertText, 'toBe(');
 const negated = await plugin.completeCode({ path: 'tests/Unit/XTest.php', text: "<?php\nexpect(1)->not->", offset: 22, blade: false }, project);
 assert.ok(!negated!.items.some(i => i.label === 'not'));
 const hover = await plugin.hover({ path: 'tests/Unit/XTest.php', text, offset: text.lastIndexOf('expect') + 2, blade: false });
 assert.match(hover!.contents, /Expectation<App\\Formatter>/);
});
