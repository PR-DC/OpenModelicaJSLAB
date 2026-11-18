/**
 * @file OpenModelicaJSLAB editing.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parser,
  sourceNodeText
} = require('../js/parser');
const {
  insertModelComponent,
  isModelicaIdentifier,
  parameterValuePatches
} = require('../js/editing');
test('Visual insertion preserves comments, strings, nested classes and initial equation sections', function() {
  const source = 'model Plant "equation is a word in this description"\n' + '  // equation must not be treated as a section here\n' + '  model Nested\n Real x;\n equation\n x=1;\n end Nested;\n' + '  parameter Real gain=2 annotation(Dialog(tab="equation"));\n' + 'initial equation\n gain=2;\n' + 'equation\nend Plant;';
  const edit = insertModelComponent(source, {
    name: 'Plant',
    parameters: [{
      name: 'gain'
    }]
  }, 'Modelica.Blocks.Math.Gain', [12, -4]);
  assert.equal(edit.name, 'gain1');
  assert.ok(edit.source.includes('Modelica.Blocks.Math.Gain gain1 annotation(Placement(transformation(origin={12,-4}'));
  assert.ok(edit.source.indexOf('Modelica.Blocks.Math.Gain') > edit.source.indexOf('end Nested;'));
  assert.ok(edit.source.indexOf('Modelica.Blocks.Math.Gain') < edit.source.indexOf('initial equation'));
  assert.ok(edit.source.includes('initial equation\n gain=2;'));
  const root = parser.parse(edit.source).classDefinitionList[0];
  assert.ok(root.componentClauseList.some(clause => clause.componentList.some(item => item.ident == 'gain1')));
});
test('World declarations keep inner scope and standalone block names avoid keywords and collisions', function() {
  const model = {
    name: 'Plant',
    components: [{
      name: 'external1'
    }],
    parameters: [{
      name: 'external2'
    }]
  };
  const source = 'model Plant\nequation\nend Plant;';
  const external = insertModelComponent(source, model, 'External');
  assert.equal(external.name, 'external3');
  parser.parse(external.source);
  const world = insertModelComponent(source, model, 'Modelica.Mechanics.MultiBody.World');
  assert.ok(world.source.includes('inner Modelica.Mechanics.MultiBody.World world'));
  parser.parse(world.source);
});
test('Declarations precede root annotations and algorithms and preserve CRLF source', function() {
  for(const ending of ['annotation(Diagram());\r\nend Plant;', 'initial algorithm\r\nend Plant;', 'algorithm\r\nend Plant;']) {
    const source = 'model Plant\r\n  type Value = Real;\r\n' + ending;
    const edit = insertModelComponent(source, {
      name: 'Plant'
    }, 'Modelica.Blocks.Sources.Constant');
    assert.ok(edit.source.indexOf('Sources.Constant') < edit.source.indexOf(ending));
    assert.ok(edit.source.includes('type Value = Real;\r\n'));
    parser.parse(edit.source);
  }
});
test('Every concrete library block can be inserted as a valid model declaration', function() {
  const classes = Object.values(require('../metadata/library-catalog.json').classes).filter(item => !item.partial && ['model', 'block'].includes(item.restriction));
  assert.equal(classes.length, 1794);
  for(const item of classes) {
    const edit = insertModelComponent('model Plant\nequation\nend Plant;', {
      name: 'Plant'
    }, item.type);
    assert.ok(edit, 'Cannot insert ' + item.type);
    const root = parser.parse(edit.source).classDefinitionList[0];
    assert.equal(root.componentClauseList.length, 1, item.type);
    assert.equal(Array.from(root.componentClauseList[0].typeSpecifier.identList).join('.'), item.type);
    assert.equal(root.componentClauseList[0].componentList[0].ident, edit.name);
  }
});
test('Identifier validation rejects language keywords while allowing their use inside names', function() {
  for(const name of ['external', 'parameter', 'model', 'equation', 'constant', 'initial']) {
    assert.equal(isModelicaIdentifier(name), false, name);
  }
  for(const name of ['external1', 'parameterData', 'myModel', '_private', 'Model']) {
    assert.equal(isModelicaIdentifier(name), true, name);
  }
});
test('Parameter value patches retain string comments and add bindings before existing annotations', function() {
  for(const declaration of [
    'parameter String value="before; {x}" "description";',
    'parameter String value "description";',
    'parameter String value annotation(Dialog(tab="General"));',
    'parameter String value;'
  ]) {
    var source = declaration;
    for(const patch of parameterValuePatches({
      name: 'value',
      declaration: declaration,
      source_start: 0
    }, '"after; {y}"')) {
      source = source.slice(0, patch.start) + patch.value + source.slice(patch.end);
    }
    var wrapped = 'model M\n' + source + '\nend M;';
    var item = parser.parse(wrapped).classDefinitionList[0].componentClauseList[0].componentList[0];
    assert.equal(sourceNodeText(item.modification.expression, wrapped), '"after; {y}"');
    if(declaration.includes('"description"')) {
      assert.equal(item.stringComment[0], '"description"');
    }
    if(declaration.includes('annotation')) {
      assert.ok(source.includes('annotation(Dialog(tab="General"))'));
    }
  }
});
