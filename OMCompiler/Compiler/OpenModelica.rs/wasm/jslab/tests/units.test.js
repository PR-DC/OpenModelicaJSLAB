/**
 * @file OpenModelicaJSLAB units.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  unitOptions,
  convertUnitExpression
} = require('../js/units');
test('Explicit numeric unit attributes use the declared base rather than an assumed SI unit', function() {
  const units = unitOptions('Real', {
    unit: 'mm',
    quantity: 'Length'
  });
  assert.equal(units[0].symbol, 'mm');
  const metres = units.find(unit => unit.symbol == 'm');
  assert.equal(vm.runInNewContext(convertUnitExpression('2', metres, units[0])), 2000);
  assert.equal(convertUnitExpression('2000', units[0], metres), '2');
  assert.equal(vm.runInNewContext(convertUnitExpression('2000', units[0], metres)), 2);
  assert.equal(unitOptions('Vendor.Distance', {
    unit: 'm',
    quantity: 'Length',
    relative_quantity: true
  }).length, 5);
  assert.deepEqual(unitOptions('Real', {
    unit: 'N/m'
  }), [{
    symbol: 'N/m',
    factor: 1,
    offset: 0
  }]);
  assert.deepEqual(unitOptions('Real'), []);
});
test('Declared temperature units preserve absolute offsets and relative quantities', function() {
  const absolute = unitOptions('Real', {
    unit: 'K',
    quantity: 'ThermodynamicTemperature'
  });
  const difference = unitOptions('Real', {
    unit: 'K',
    quantity: 'ThermodynamicTemperature',
    relative_quantity: true
  });
  const celsius = units => units.find(unit => unit.symbol == 'degC');
  assert.equal(vm.runInNewContext(convertUnitExpression('0', celsius(absolute), absolute[0])), 273.15);
  assert.equal(vm.runInNewContext(convertUnitExpression('100', celsius(difference), difference[0])), 100);
  const fahrenheit = unitOptions('Real', {
    unit: 'degF',
    quantity: 'Temperature'
  });
  assert.ok(Math.abs(vm.runInNewContext(convertUnitExpression('0', celsius(fahrenheit), fahrenheit[0])) - 32) < 1e-10);
  assert.equal(unitOptions('Real', {
    unit: 'degRk',
    relative_quantity: true
  })[0].offset, 0);
});
