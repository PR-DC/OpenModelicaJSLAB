/**
 * @file OpenModelicaJSLAB parser strict.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('The source parser works in strict browser modules and keeps serializable component backlinks', function() {
  const exports = {};
  const source = fs.readFileSync(path.resolve(__dirname, '../vendor/moijs/moparser.js'), 'utf8');
  const context = {
    exports,
    module: {
      exports
    },
    require,
    console
  };
  vm.runInNewContext('"use strict";\n' + source, context);
  const ast = exports.parser.parse('model StrictBrowser\n parameter Real gain=2;\n Real x(start=1, fixed=true);\nequation\n der(x)=-gain*x;\nend StrictBrowser;');
  const model = ast.classDefinitionList[0];
  for(const clause of model.componentClauseList) {
    for(const component of clause.componentList) {
      assert.equal(component.componentClause, clause);
      assert.equal(Object.getOwnPropertyDescriptor(component, 'componentClause').enumerable, false);
    }
  }
  assert.doesNotThrow(() => JSON.stringify(ast));
});
