/**
 * @file OpenModelicaJSLAB values.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  safeWorkspaceValue,
  workspaceValueExpression,
  modelicaLiteral,
  resolvePropertyValue,
  localizedValueError
} = require('../js/values');
/**
 * Class for values tests in the compiler library.
 */
class PRDC_OMJSL_VALUES_TEST {

  /**
   * Provides record field definitions for the workspace value conversion tests.
   * @param {*} type Declared compiler type.
   */
  static async schema(type) {
    return type == 'External.Settings' ? settings : type == 'External.Inner' ? {
      properties: [{
        name: 'x',
        type: 'Real'
      }]
    } : null;
  }

}
const settings = {
  properties: [
    {
      name: 'rate',
      type: 'Real'
    },
    {
      name: 'bias',
      type: 'Real'
    },
    {
      name: 'enabled',
      type: 'Boolean'
    },
    {
      name: 'mode',
      type: 'External.Mode',
      choices: ['Slow', 'Fast']
    },
    {
      name: 'total',
      type: 'Real',
      final: true
    },
    {
      name: 'nested',
      type: 'External.Inner'
    }
  ]
};
test('Workspace transport copies plain records and typed arrays without invoking accessors', function() {
  const crossRealm = vm.runInNewContext('({a: 2, b: new Float64Array([3,4])})');
  assert.equal(JSON.stringify(safeWorkspaceValue(crossRealm)), '{"a":2,"b":[3,4]}');
  const shared = {
    x: 1
  };
  assert.equal(workspaceValueExpression([shared, shared]), '[{"x":1},{"x":1}]');
  const prototypeField = JSON.parse('{"__proto__":{"x":2}}');
  const restored = vm.runInNewContext('(' + workspaceValueExpression(prototypeField) + ')');
  assert.equal(Object.hasOwn(restored, '__proto__'), true);
  assert.equal(restored.__proto__.x, 2);
  const circular = {};
  circular.a = circular;
  assert.throws(() => safeWorkspaceValue(circular), error => error.value_code == 'cycle' && error.value_path == 'value.a');
  let calls = 0;
  assert.throws(() => safeWorkspaceValue({
    get field() {
      calls++;
      return 1;
    }
  }), error => error.value_code == 'accessor');
  assert.equal(calls, 0);
  const typed = new Float64Array([2, 3]);
  Object.defineProperty(typed, 'length', {
    get() {
      calls++;
      return 99;
    }
  });
  Object.defineProperty(typed, Symbol.iterator, {
    get() {
      calls++;
      throw new Error('Must not invoke iterators');
    }
  });
  assert.equal(JSON.stringify(safeWorkspaceValue(typed)), '[2,3]');
  assert.equal(calls, 0);
  for(const unsupported of [null, undefined, Infinity, NaN, 1n, () => 1, new Date(), new Map(), new DataView(new ArrayBuffer(8)), new class RuntimeObject {}(), [, 1]]) {
    assert.throws(() => safeWorkspaceValue(unsupported));
  }
});
test('Scalar literals escape strings and keep array structure rather than object source', function() {
  assert.equal(modelicaLiteral([1, new Float64Array([2, 3]), false]), '{1, {2, 3}, false}');
  assert.equal(modelicaLiteral('a"\\\nb\r\t'), '"a\\"\\\\\\nb\\r\\t"');
  assert.throws(() => modelicaLiteral({
    rate: 9
  }), error => error.value_code == 'record');
  assert.equal(workspaceValueExpression({
    description: 'a"\nb',
    data: [2, true]
  }), '{"description":"a\\"\\nb","data":[2,true]}');
});
test('Record objects become typed modifiers, preserving field defaults and typed choices', async function() {
  const result = await resolvePropertyValue({
    type: 'External.Settings'
  }, {
    rate: 9,
    mode: 'Fast',
    enabled: true,
    nested: {
      x: 4
    }
  }, PRDC_OMJSL_VALUES_TEST.schema, {
    modifier: true,
    path: 'probe.settings'
  });
  assert.deepEqual(result, {
    value: '(rate = 9, mode = External.Mode.Fast, enabled = true, nested(x = 4))',
    nested: true
  });
  assert.deepEqual(await resolvePropertyValue({
    type: 'External.Settings'
  }, {}, PRDC_OMJSL_VALUES_TEST.schema, {
    modifier: true
  }), {
    value: '()',
    nested: true
  });
  const literal = await resolvePropertyValue({
    type: 'External.Settings'
  }, {
    rate: 7,
    nested: {
      x: 4
    }
  }, PRDC_OMJSL_VALUES_TEST.schema);
  assert.deepEqual(literal, {
    value: 'External.Settings(rate = 7, nested = External.Inner(x = 4))',
    nested: false
  });
});
test('Arrays of records produce a typed constructor for every element and accept enum ordinals', async function() {
  assert.deepEqual(await resolvePropertyValue({
    type: 'External.Settings',
    dimensions: ['2']
  }, [{
    rate: 3,
    mode: 2
  }, {
    rate: 5,
    mode: 'Slow'
  }], PRDC_OMJSL_VALUES_TEST.schema, {
    modifier: true
  }), {
    value: '{External.Settings(rate = 3, mode = External.Mode.Fast), External.Settings(rate = 5, mode = External.Mode.Slow)}',
    nested: false
  });
});
test('Record validation rejects unknown, final and non-record fields with localized paths', async function() {
  for(const [value, code, field] of [[{
    bogus: 2
  }, 'field', 'bogus'], [{
    total: 9
  }, 'final', 'total'], [{
    mode: 'Missing'
  }, 'choice', 'mode']]) {
    await assert.rejects(resolvePropertyValue({
      type: 'External.Settings'
    }, value, PRDC_OMJSL_VALUES_TEST.schema, {
      path: 'probe.settings'
    }), error => {
      assert.equal(error.value_code, code);
      assert.ok(localizedValueError(error, 'rs').includes('probe.settings.' + field));
      assert.notEqual(localizedValueError(error, 'en'), localizedValueError(error, 'rs'));
      assert.notEqual(localizedValueError(error, 'rs'), localizedValueError(error, 'rsc'));
      return true;
    });
  }
  await assert.rejects(resolvePropertyValue({
    type: 'Real'
  }, {
    rate: 9
  }, PRDC_OMJSL_VALUES_TEST.schema), error => error.value_code == 'record');
  await assert.rejects(resolvePropertyValue({
    type: 'External.Settings',
    dimensions: ['2']
  }, {
    rate: 9
  }, PRDC_OMJSL_VALUES_TEST.schema), error => error.value_code == 'record');
  await assert.rejects(resolvePropertyValue({
    type: 'External.Settings'
  }, JSON.parse('{"__proto__":1}'), PRDC_OMJSL_VALUES_TEST.schema), error => error.value_code == 'field');
});
