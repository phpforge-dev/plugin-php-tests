import test from 'node:test';
import assert from 'node:assert/strict';
import { classMembers, customExpectations, functionsIn, testCaseClasses, typeOf, usesRules } from '../src/shared/language/pest-context';
import { phpTokens } from '../src/shared/language/php-source';
import { PhpTestsPlugin } from '../src/shared/language/plugins/php-tests';
import type { ProjectFiles } from '../src/shared/language/plugins/api';

const files = (map: Record<string, string>): ProjectFiles => ({ root: '/p', read: async p => map[p] ?? null, exists: async p => p in map, list: async (dir, accept) => Object.keys(map).filter(p => p.startsWith(dir + '/') && accept(p.split('/').pop()!)), uri: p => `file:///p/${p}` });
const pestPhp = `<?php

use App\\Formatter;

uses(Tests\\TestCase::class)->in('Feature');
pest()->extend(Tests\\UnitCase::class)->use(Tests\\Helpers::class)->in('Unit');

expect()->extend('toBeOne', function () {
    return $this->toBe(1);
});

expect()->extend('toBeCurrency', fn (string $code) => $this->toBeInstanceOf(App\\Money\\Currency::class));

function formatter(): Formatter
{
    return new Formatter();
}
`;
const project = files({
 'composer.json': JSON.stringify({ 'require-dev': { 'pestphp/pest': '^3' }, autoload: { 'psr-4': { 'App\\': 'src/' } }, 'autoload-dev': { 'psr-4': { 'Tests\\': 'tests/' } } }),
 'vendor/pestphp/pest/src/Expectation.php': '<?php\nfinal class Expectation {\n public function and(mixed $value): Expectation {}\n}\n',
 'vendor/pestphp/pest/src/Mixins/Expectation.php': '<?php\nfinal class Expectation {\n public function toBe(mixed $expected): self {}\n}\n',
 'tests/Pest.php': pestPhp,
 'tests/TestCase.php': "<?php\nnamespace Tests;\nuse App\\Money\\Currency;\nuse PHPUnit\\Framework\\TestCase as BaseTestCase;\nabstract class TestCase extends BaseTestCase\n{\n    public function currency(string $code = 'BRL'): Currency\n    {\n        return new Currency($code);\n    }\n    protected function secret(): int {}\n    private function hidden(): int {}\n}\n",
 'tests/UnitCase.php': '<?php\nnamespace Tests;\nabstract class UnitCase extends TestCase {\n public static function make(): static {}\n}\n',
 'tests/Helpers.php': '<?php\nnamespace Tests;\ntrait Helpers {\n public function helper(): \\App\\Formatter {}\n}\n',
 'src/Formatter.php': "<?php\nnamespace App;\nfinal class Formatter {\n public function money(float $v): string {}\n public function percent(float $v): string {}\n}\n",
 'src/Money/Currency.php': "<?php\nnamespace App\\Money;\nfinal class Currency {\n public function __construct(public readonly string $code = 'BRL') {}\n public function code(): string {}\n public function self(): self {}\n}\n",
 'src/Money/Rates/Table.php': '<?php\nnamespace App\\Money\\Rates;\nuse App\\Money\\Currency;\nfinal class Table {\n public function rate(Currency $from, Currency $to): float {}\n}\n',
});

test('uses()->in() e pest()->extend()->use()->in() relativos a tests/', () => {
 const rules = usesRules('tests/Pest.php', pestPhp);
 assert.deepEqual(rules.map(r => [r.classes, r.dirs]), [[['Tests\\TestCase'], ['tests/Feature']], [['Tests\\UnitCase', 'Tests\\Helpers'], ['tests/Unit']]]);
 const sources = [{ path: 'tests/Pest.php', text: pestPhp }];
 assert.deepEqual(testCaseClasses('tests/Feature/HelpersTest.php', '<?php', sources), ['Tests\\TestCase']);
 assert.deepEqual(testCaseClasses('tests/Unit/XTest.php', '<?php', sources), ['Tests\\UnitCase', 'Tests\\Helpers']);
 assert.deepEqual(testCaseClasses('tests/Other/XTest.php', "<?php\nuses(Tests\\Helpers::class);\n", sources), ['Tests\\Helpers'], 'uses() sem in() vale para o arquivo');
});

test('expect()->extend e funções globais de tests/Pest.php', () => {
 assert.deepEqual(customExpectations('tests/Pest.php', pestPhp).map(e => [e.name, e.params]), [['toBeOne', ''], ['toBeCurrency', 'string $code']]);
 assert.deepEqual(functionsIn('tests/Pest.php', pestPhp).map(f => [f.name, f.returns]), [['formatter', 'App\\Formatter']]);
});

test('membros da classe com pais, traits e promoção no construtor', async () => {
 const unit = await classMembers('Tests\\UnitCase', project);
 assert.deepEqual(unit.map(m => [m.name, m.visibility, m.returns]).sort(), [['currency', 'public', 'App\\Money\\Currency'], ['make', 'public', 'Tests\\UnitCase'], ['secret', 'protected', 'int']]);
 const currency = await classMembers('App\\Money\\Currency', project);
 assert.deepEqual(currency.map(m => [m.kind, m.name, m.returns]), [['method', 'code', 'string'], ['method', 'self', 'App\\Money\\Currency'], ['property', 'code', 'string']]);
});

test('tipo de chamadas: função global, $this, new (…)->método, variável e cadeia', async () => {
 const sources = [{ path: 'tests/Pest.php', text: pestPhp }];
 const of = async (path: string, code: string) => { const text = `<?php\nuse App\\Money\\Rates\\Table;\nit('x', function () {\n $brl = $this->currency();\n ${code}`; const tokens = phpTokens(text); const at = tokens.findIndex((t, i) => i > 0 && t.value === 'MARK'); return typeOf({ path, text, files: project, sources }, tokens, at + 2, tokens.length - 2); };
 assert.equal(await of('tests/Feature/HelpersTest.php', 'MARK(formatter());'), 'App\\Formatter');
 assert.equal(await of('tests/Feature/HelpersTest.php', 'MARK($this->currency());'), 'App\\Money\\Currency');
 assert.equal(await of('tests/Feature/HelpersTest.php', 'MARK($this->currency()->code());'), 'string');
 assert.equal(await of('tests/Feature/HelpersTest.php', 'MARK($this->currency()->self()->code);'), 'string');
 assert.equal(await of('tests/Feature/HelpersTest.php', 'MARK((new Table())->rate($a, $b));'), 'float');
 assert.equal(await of('tests/Feature/HelpersTest.php', 'MARK($brl);'), 'App\\Money\\Currency');
 assert.equal(await of('tests/Unit/XTest.php', 'MARK($this->helper());'), 'App\\Formatter', 'trait de pest()->use()');
 assert.equal(await of('tests/Feature/HelpersTest.php', 'MARK(unknown());'), 'mixed');
});

test('completar: retorno de chamada, expectativas customizadas e $this->', async () => {
 const plugin = new PhpTestsPlugin(); await plugin.detect(project);
 const path = 'tests/Feature/HelpersTest.php';
 const at = async (text: string) => plugin.completeCode({ path, text, offset: text.length, blade: false }, project);
 const ret = await at("<?php\nit('x', function () {\n expect(formatter())->");
 const by = Object.fromEntries(ret!.items.map(i => [i.label, i]));
 assert.equal(by.toBe.labelDetails?.description, 'Expectation<App\\Formatter>');
 assert.equal(by.money.labelDetails?.description, '→ Expectation<string>');
 assert.equal(by.toBeCurrency.labelDetails?.detail, '(string $code)');
 assert.equal(by.toBeOne.insertText, 'toBeOne(');
 const self = await at("<?php\nit('x', function () {\n expect($this->currency())->");
 assert.ok(self!.items.some(i => i.label === 'code' && i.kind === 2), 'higher order: método code() do Currency');
 const members = await at("<?php\nit('x', function () {\n $this->cur");
 assert.deepEqual(members!.items.map(i => [i.label, i.labelDetails?.detail, i.labelDetails?.description]), [['currency', "(string $code = 'BRL')", 'App\\Money\\Currency'], ['secret', '()', 'int']]);
 assert.equal(members!.from, "<?php\nit('x', function () {\n $this->".length);
 const hover = await plugin.hover({ path, text: "<?php\nit('x', function () {\n expect($this->currency())->toBe(1);", offset: 31, blade: false }, project);
 assert.match(hover!.contents, /Expectation<App\\Money\\Currency>/);
 const text = "<?php\nit('x', function () {\n expect(1)->toBeOne();";
 const go = await plugin.defineCode({ path, text, offset: text.indexOf('toBeOne') + 3, blade: false }, project);
 assert.deepEqual(go, [{ uri: 'file:///p/tests/Pest.php', range: { start: { line: 7, character: 17 }, end: { line: 7, character: 26 } } }]);
});
