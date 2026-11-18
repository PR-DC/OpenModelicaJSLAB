/**
 * @file OpenModelicaJSLAB expressions.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  parser,
  sourceNodeText
} = require('../js/parser');
const {
  modelicaValueToJSLAB,
  normalizeWorkspaceExpression,
  isLiteralModelicaValue
} = require('../js/expressions');
/**
 * Class for expressions tests in the compiler library.
 */
class PRDC_OMJSL_TESTS_EXPRESSIONS_TEST {

  /**
   * Evaluates the generated literal expression in an isolated test context.
   * @param {*} source Original compiler source text.
   * @param {*} context Context.
   * @param {*} options Host services and operation options.
   */
  static evaluate(source, context = {}, options) {
    const expression = modelicaValueToJSLAB(source, false, options);
    assert.ok(expression, source);
    return vm.runInNewContext('(' + expression + ')', context);
  }

}
test('The parser retains declaration dimensions and every component-reference subscript', function() {
  const ast = parser.parse('model M parameter Real x[2,3]=a[1,2]; end M;');
  const declaration = ast.classDefinitionList[0].componentClauseList[0].componentList[0];
  assert.equal(declaration.arraySubscripts.length, 2);
  assert.equal(declaration.arraySubscripts[0].value.value, '2');
  const reference = declaration.modification.expression.value;
  assert.equal(reference.arraySubscriptsList[0].length, 2);
  assert.equal(reference.arraySubscriptsList[0][1].value.value, '2');
  assert.equal(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('a[1,2]', {
    a: [[2, 7], [3, 9]]
  }), 7);
});
test('Strings retain braces, semicolons, Unicode and angle-call text through conversion', function() {
  const text = 'line {x}; [a,b]; from_deg(30); deg2rad(45); Modelica.Constants.pi; Ђорђе';
  assert.equal(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate(JSON.stringify(text)), text);
  assert.equal(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('"line\\nquote\\\"\\tend"'), 'line\nquote"\tend');
  assert.equal(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('"alert\\a"'), 'alert\x07');
  assert.equal(modelicaValueToJSLAB('0'), '0');
  assert.equal(modelicaValueToJSLAB(false), 'false');
});
test('String values and concatenated comments retain independent AST source ranges', function() {
  const source = 'model M\r\n parameter String label="value; {x}" "first" + " second";\r\nend M;';
  const declaration = parser.parse(source).classDefinitionList[0].componentClauseList[0].componentList[0];
  assert.equal(sourceNodeText(declaration.modification.expression, source), '"value; {x}"');
  assert.equal(sourceNodeText(declaration.stringComment, source), '"first" + " second"');
});
test('Nested arrays and matrix rows keep strings and scalar grouping intact', function() {
  assert.equal(JSON.stringify(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('{1,{2,3},"{literal}"}')), '[1,[2,3],"{literal}"]');
  assert.equal(JSON.stringify(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('[1,2;3,4]')), '[[1,2],[3,4]]');
  assert.equal(JSON.stringify(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('[1,2]')), '[[1,2]]');
  assert.equal(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('(2+3)*4'), 20);
  assert.equal(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('-2^2'), -4);
  assert.equal(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('00012.5'), 12.5);
});
test('Array expressions use workspace array operations instead of JavaScript string concatenation', function() {
  assert.equal(modelicaValueToJSLAB('{1,2}+{3,4}'), 'plus([1, 2], [3, 4])');
  assert.equal(modelicaValueToJSLAB('a-b', false, {
    dimensions: ['2'],
    references: {
      a: ['2'],
      b: ['2']
    }
  }), 'minus(a, b)');
  assert.equal(modelicaValueToJSLAB('{1,2}.*{3,4}'), 'dotMultiply([1, 2], [3, 4])');
  assert.equal(modelicaValueToJSLAB('fill(3,2,4)'), 'createFilledArray(2, 4, 3)');
  assert.equal(modelicaValueToJSLAB('{1,2}*{3,4}'), '');
  assert.equal(modelicaValueToJSLAB('from_deg({30,60})'), '');
});
test('Binding cleanup distinguishes literal data from references to the user workspace', function() {
  for(const source of ['0', 'false', '"gain"', '{1,2}', '[1,2;3,4]', '-2', '2+3']) {
    assert.equal(isLiteralModelicaValue(source), true, source);
  }
  for(const source of ['gain', '{gain,2}', 'Vendor.Settings(rate=3)', 'sin(gain)', 'Modelica.Constants.pi']) {
    assert.equal(isLiteralModelicaValue(source), false, source);
  }
});
test('Scalar powers, conditionals and Boolean operators use JavaScript semantics', function() {
  assert.equal(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('if x>2 then x^2 elseif not enabled then 9 else 4', {
    x: 3,
    enabled: true
  }), 9);
  assert.equal(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('if x>2 then x^2 elseif not enabled then 9 else 4', {
    x: 1,
    enabled: false
  }), 9);
  assert.equal(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('not enabled or x<>3', {
    x: 3,
    enabled: true
  }), false);
  assert.equal(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('Modelica.Constants.pi/2', {
    pi: Math.PI
  }), Math.PI / 2);
  assert.equal(modelicaValueToJSLAB('Modelica.SIunits.Conversions.from_deg(30)'), '((30) * pi / 180)');
  assert.equal(modelicaValueToJSLAB('(start={1,2}, fixed=true)', true), '[1, 2]');
  assert.equal(vm.runInNewContext(modelicaValueToJSLAB('(2*pi)', true), {
    pi: Math.PI
  }), 2 * Math.PI);
});
test('Typed record and enumeration expressions become plain data', function() {
  const definition = {
    type: 'Vendor.Settings',
    schema: {
      properties: [
        {
          name: 'rate',
          type: 'Real'
        },
        {
          name: 'mode',
          type: 'Vendor.Mode',
          choices: ['Slow', 'Fast']
        }
      ]
    }
  };
  assert.equal(JSON.stringify(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('Vendor.Settings(rate=3,mode=Vendor.Mode.Fast)', {}, definition)), '{"rate":3,"mode":"Fast"}');
  assert.equal(JSON.stringify(PRDC_OMJSL_TESTS_EXPRESSIONS_TEST.evaluate('{Vendor.Settings(rate=3),Vendor.Settings(rate=4)}', {}, definition)), '[{"rate":3},{"rate":4}]');
  assert.equal(modelicaValueToJSLAB('Vendor.Mode.Fast', false, {
    type: 'Vendor.Mode',
    choices: ['Slow', 'Fast']
  }), '"Fast"');
  assert.equal(modelicaValueToJSLAB('Modelica.Unknown.call(3)'), '');
});
test('Legacy saved JavaScript normalization changes calls but preserves text and comments', function() {
  const source = '{label:"from_deg(30); {x}", value:from_deg(30), text:`deg2rad(9)`, nested:deg2rad(from_deg(60))} // deg2rad(2)';
  const normalized = normalizeWorkspaceExpression(source);
  const result = vm.runInNewContext('(' + normalized + '\n)', {
    pi: Math.PI
  });
  assert.equal(result.label, 'from_deg(30); {x}');
  assert.equal(result.text, 'deg2rad(9)');
  assert.ok(Math.abs(result.value - Math.PI / 6) < 1e-15);
  assert.ok(normalized.endsWith('// deg2rad(2)'));
  assert.equal(normalizeWorkspaceExpression('/* from_deg(2) */ vendor.from_deg(3)'), '/* from_deg(2) */ vendor.from_deg(3)');
  assert.equal(normalizeWorkspaceExpression('(/from_deg(30)/).source'), '(/from_deg(30)/).source');
  assert.equal(normalizeWorkspaceExpression('2 / from_deg(30)'), '2 / ((30) * pi / 180)');
  assert.equal(normalizeWorkspaceExpression(normalized), normalized);
});
