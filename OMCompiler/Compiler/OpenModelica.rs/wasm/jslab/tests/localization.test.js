/**
 * @file OpenModelicaJSLAB localization.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../metadata/library-catalog.json');
const schemas = require('../metadata/component-schema.json');
const labels = require('../metadata/class-labels.json');
const strings = require('../config/lang.json');
const descriptions = require('../metadata/description-labels.json');
const {
  translatedTypeLabel,
  translatedClassDescription,
  translatedPropertyDescription,
  isBundledLibraryType
} = require('../js/localization');
test('Every library folder and property type has a localized catalog label', function() {
  const types = new Set(Object.values(catalog.classes).filter(item => item.restriction == 'package').map(item => item.type));
  for(const schema of Object.values(schemas)) {
    for(const property of schema.properties) {
      types.add(property.type.replace(/^\./, ''));
    }
  }
  for(const type of types) {
    const id = labels[type] || labels[type.split('.').pop()];
    assert.ok(id, 'Missing library label: ' + type);
    for(const language of ['en', 'rs', 'rsc']) {
      assert.ok(strings[id][language].trim(), type + ': ' + language);
      assert.equal(translatedTypeLabel(type, language, true), strings[id][language]);
    }
  }
});
test('Localized library labels preserve imported class names and descriptions', function() {
  assert.equal(translatedTypeLabel('Modelica', 'rs'), 'Standardna biblioteka');
  assert.equal(translatedTypeLabel('Modelica.Electrical.Machines.BasicMachines.Transformers.Dy', 'rsc'), 'Веза троугао–звезда (Dy)');
  assert.equal(translatedTypeLabel('Medium.AbsolutePressure', 'rsc', true), 'Апсолутни притисак');
  assert.equal(translatedTypeLabel('Medium.AbsolutePressure', 'rs'), 'AbsolutePressure');
  assert.equal(translatedTypeLabel('External.RealOutput', 'rs'), 'RealOutput');
  assert.equal(translatedTypeLabel('External.Ground', 'rsc'), 'Ground');
  assert.equal(translatedTypeLabel('Modelica.External.Ground', 'rsc'), 'Ground');
  assert.equal(translatedTypeLabel('Modelica.External.Gain42', 'rs'), 'Gain42');
  assert.equal(isBundledLibraryType('Modelica.Blocks.Math.Gain'), true);
  assert.equal(isBundledLibraryType('Modelica.External.Ground'), false);
  assert.equal(translatedClassDescription('External.Ground', 'External description', 'rsc'), 'External description');
  assert.equal(translatedTypeLabel('Complex', 'rsc'), 'Комплексни број');
  assert.equal(translatedTypeLabel('Modelica.ComplexBlocks.ComplexMath.Conj', 'rsc'), 'Конјуговани комплексни сигнал');
  assert.equal(translatedTypeLabel('Modelica.Media.IdealGases.SingleGases.CO2', 'rsc'), 'Угљен-диоксид (CO2)');
  assert.equal(translatedPropertyDescription({
    description: 'Number of turns'
  }, 'rsc'), 'Број навојака');
});
test('Every nonempty library-folder tooltip has source-matched translations', function() {
  for(const item of Object.values(catalog.classes)) {
    if(item.restriction != 'package' || !item.description) {
      continue;
    }
    const id = descriptions[item.type];
    assert.ok(id, 'Missing folder description: ' + item.type);
    assert.equal(strings[id].en, item.description);
    for(const language of ['en', 'rs', 'rsc']) {
      assert.ok(strings[id][language].trim());
      assert.equal(translatedClassDescription(item.type, item.description, language), strings[id][language]);
    }
  }
  assert.ok(translatedClassDescription('Modelica.Media.Water.IF97_Utilities', '', 'rsc').includes('IAPWS/IF97'));
});
