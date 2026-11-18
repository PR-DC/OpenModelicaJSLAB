/**
 * @file OpenModelicaJSLAB modifiers.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parser
} = require('../js/parser');
const {
  componentModifierPatches,
  componentFieldModifier,
  componentModifiers
} = require('../js/modifiers');
/**
 * Class for modifiers tests in the compiler library.
 */
class PRDC_OMJSL_TESTS_MODIFIERS_TEST {

  /**
   * Parses the component declaration used by the modifier test.
   * @param {*} args Args.
   */
  static component(args) {
    return {
      name: 'b',
      source_start: 0,
      declaration: 'Block b(' + args + ');',
      modifier_start: 'Block b('.length,
      modifier_end: 'Block b('.length + args.length
    };
  }

  /**
   * Applies the generated source patches to the test declaration.
   * @param {*} item Item.
   * @param {*} changes Changes.
   */
  static edit(item, changes) {
    var source = item.declaration;
    for(const patch of componentModifierPatches(item, changes).sort((a, b) => b.start - a.start)) {
      source = source.slice(0, patch.start) + patch.value + source.slice(patch.end);
    }
    parser.parse('model Plant\n' + source + '\nend Plant;');
    return source;
  }

}
test('Record field edits preserve sibling values, expressions and initialization flags', function() {
  const item = PRDC_OMJSL_TESTS_MODIFIERS_TEST.component('data(k=2, bias=4), phi(start=0, fixed=true), label="a,b"');
  const result = PRDC_OMJSL_TESTS_MODIFIERS_TEST.edit(item, [{
    name: 'data.k',
    value: '9'
  }, {
    name: 'phi.start',
    value: '0.5'
  }]);
  assert.ok(result.includes('data(k= 9, bias=4)'));
  assert.ok(result.includes('phi(start= 0.5, fixed=true)'));
  assert.ok(result.includes('label="a,b"'));
  assert.deepEqual(componentFieldModifier(item, 'data.bias'), {
    value: '4',
    assignment: true
  });
});
test('Nested reset removes only the selected field and removes empty modifier groups', function() {
  const item = PRDC_OMJSL_TESTS_MODIFIERS_TEST.component('data(k=2, bias=4), phi(start=0, fixed=true)');
  const result = PRDC_OMJSL_TESTS_MODIFIERS_TEST.edit(item, [{
    name: 'data.k',
    remove: true
  }, {
    name: 'phi.start',
    remove: true
  }]);
  assert.ok(!result.includes('k=2'));
  assert.ok(result.includes('bias=4'));
  assert.ok(result.includes('fixed=true'));
  assert.equal(PRDC_OMJSL_TESTS_MODIFIERS_TEST.edit(PRDC_OMJSL_TESTS_MODIFIERS_TEST.component('data(k=2)'), [{
    name: 'data.k',
    remove: true
  }]), 'Block b();');
});
test('New record fields merge into existing nested arguments and support dotted imported modifiers', function() {
  assert.ok(PRDC_OMJSL_TESTS_MODIFIERS_TEST.edit(PRDC_OMJSL_TESTS_MODIFIERS_TEST.component('data(k=2)'), [{
    name: 'data.bias',
    value: '7'
  }]).includes('data(k=2,bias = 7)'));
  assert.ok(PRDC_OMJSL_TESTS_MODIFIERS_TEST.edit(PRDC_OMJSL_TESTS_MODIFIERS_TEST.component('data.k=2'), [{
    name: 'data.k',
    value: '7'
  }]).includes('data.k= 7'));
  assert.ok(PRDC_OMJSL_TESTS_MODIFIERS_TEST.edit(PRDC_OMJSL_TESTS_MODIFIERS_TEST.component('phi(start=0, fixed=true)'), [{
    name: 'phi',
    value: '(start=2)',
    nested: true
  }]).includes('fixed=true'));
  assert.throws(() => PRDC_OMJSL_TESTS_MODIFIERS_TEST.edit(PRDC_OMJSL_TESTS_MODIFIERS_TEST.component('data=sourceData'), [{
    name: 'data.k',
    value: '7'
  }]), /Reset the record value first/);
});
test('Modifier insertion follows instance array dimensions even when type and instance names match', function() {
  const item = {
    name: 'Block',
    source_start: 0,
    declaration: 'Block Block[2];',
    modifier_start: -1,
    modifier_end: -1
  };
  assert.equal(PRDC_OMJSL_TESTS_MODIFIERS_TEST.edit(item, [{
    name: 'k',
    value: '2'
  }]), 'Block Block[2](k = 2);');
});
test('Initial-value edits and resets preserve explicit bindings, each prefixes and fixed flags', function() {
  const item = PRDC_OMJSL_TESTS_MODIFIERS_TEST.component('each phi(start=0,fixed=true)=2, final k=3');
  assert.deepEqual(componentFieldModifier(item, 'phi.start'), {
    value: '0',
    assignment: true
  });
  assert.deepEqual(componentFieldModifier(PRDC_OMJSL_TESTS_MODIFIERS_TEST.component('data(final k=2)'), 'data.k'), {
    value: '2',
    assignment: true,
    final: true
  });
  assert.deepEqual(componentFieldModifier(PRDC_OMJSL_TESTS_MODIFIERS_TEST.component('final data(k=2)'), 'data.k'), {
    value: '2',
    assignment: true,
    final: true
  });
  assert.ok(PRDC_OMJSL_TESTS_MODIFIERS_TEST.edit(item, [{
    name: 'phi.start',
    value: '0.5'
  }]).includes('each phi(start= 0.5,fixed=true)=2'));
  assert.ok(PRDC_OMJSL_TESTS_MODIFIERS_TEST.edit(item, [{
    name: 'phi',
    value: '(start=2)',
    nested: true
  }]).includes('each phi(start= 2,fixed=true)=2'));
  assert.ok(PRDC_OMJSL_TESTS_MODIFIERS_TEST.edit(item, [{
    name: 'phi.start',
    remove: true
  }]).includes('each phi(fixed=true)=2'));
  assert.equal(PRDC_OMJSL_TESTS_MODIFIERS_TEST.edit(PRDC_OMJSL_TESTS_MODIFIERS_TEST.component('each phi(start=0)=2'), [{
    name: 'phi.start',
    remove: true
  }]), 'Block b(each phi=2);');
  assert.equal(PRDC_OMJSL_TESTS_MODIFIERS_TEST.edit(PRDC_OMJSL_TESTS_MODIFIERS_TEST.component('each phi=2'), [{
    name: 'phi',
    nested: true,
    value: '(start=3)'
  }]), 'Block b(each phi(start=3));');
});
test('Modifier metadata separates each/final prefixes and skips calls in instance array dimensions', function() {
  const source = 'Block Block[size(values,1)](each phi(start=0,fixed=true)=2, final k=3, data(final x=1));';
  const result = componentModifiers(source, 'Block');
  assert.equal(source.slice(result.start, result.end), 'each phi(start=0,fixed=true)=2, final k=3, data(final x=1)');
  assert.deepEqual(result.modifiers.map(item => [item.name, item.value, item.assignment, item.each, item.final]), [['phi', '2', true, true, false], ['k', '3', true, false, true], ['data', '(final x=1)', false, false, false]]);
  for(const item of result.modifiers) {
    assert.equal(source.slice(item.value_start, item.value_end), item.value);
  }
  assert.deepEqual(componentModifiers('Block b[size(values,1)] annotation(Placement());', 'b'), {
    modifiers: [],
    start: -1,
    end: -1
  });
});
