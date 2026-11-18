/**
 * @file OpenModelicaJSLAB icon localization.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectIconTexts,
  renderAnnotation
} = require('../js/annotations');
const {
  translatedIconText,
  iconTextPlaceholders
} = require('../js/localization');
const labels = require('../metadata/icon-text-labels.json');
const lang = require('../config/lang.json');
test('Every bundled drawing label is translated or explicitly reviewed as technical notation', function() {
  const texts = collectIconTexts(require('../metadata/library-graphics.json'), require('../metadata/custom-icons.json'));
  assert.equal(texts.size, 479);
  assert.equal(Array.from(texts.keys()).filter(text => labels[text]).length, 110);
  for(const text of texts.keys()) {
    assert.equal(Object.hasOwn(labels, text), true, text);
    if(labels[text] === null) {
      continue;
    }
    const entry = lang[labels[text]];
    assert.equal(entry.en, text);
    for(const language of ['en', 'rs', 'rsc']) {
      assert.equal(iconTextPlaceholders(entry[language]), iconTextPlaceholders(text));
    }
  }
});
test('Icon localization preserves symbols, units and every imported class drawing', function() {
  assert.equal(translatedIconText('Modelica.Electrical.Digital.Delay.InertialDelay', 'Delay', 'rs'), 'Kašnjenje');
  assert.equal(translatedIconText('Modelica.Electrical.Digital.Delay.InertialDelay', 'Delay', 'rsc'), 'Кашњење');
  assert.equal(translatedIconText('Modelica.Blocks.Math.Gain', 'k=%k', 'rsc'), 'k=%k');
  assert.equal(translatedIconText('Modelica.Blocks.Math.Gain', 'kg/s', 'rsc'), 'kg/s');
  assert.equal(translatedIconText('Vendor.Delay', 'Delay', 'rsc'), 'Delay');
  assert.equal(translatedIconText('Modelica.VendorDelay', 'Delay', 'rsc'), 'Delay');
});
test('Parameter markers are translated before substituting user values', function() {
  const nodes = [];
  const document = {
    createElementNS(_namespace, tag) {
      const node = {
        tag,
        ownerDocument: document,
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        appendChild() {}
      };
      nodes.push(node);
      return node;
    }
  };
  const type = 'Modelica.Blocks.Nonlinear.VariableDelay';
  const metadata = {
    type,
    icons: [
      {
        annotation: '{-100,-100,100,100,true,-,-,,{Text(true,{0,0},0,{0,0,0},{0,0,0},LinePattern.Solid,FillPattern.None,0.25,{{-100,-20},{100,20}},"delayMax=%delayMax",0,{-1,-1,-1},"",{},TextAlignment.Center)}}'
      }
    ]
  };
  renderAnnotation(document.createElementNS('', 'svg'), metadata, {
    type,
    name: 'delay',
    language: 'rsc',
    modifiers: [{
      name: 'delayMax',
      value: '7'
    }]
  }, 20, 20);
  assert.ok(nodes.some(node => node.tag == 'tspan' && node.textContent == 'макс. кашњење=7'));
});
test('Context-specific icon phrases use natural word order without changing other blocks', function() {
  const type = 'Modelica.Electrical.Digital.Delay.InertialDelaySensitiveVector';
  assert.equal(translatedIconText(type, 'signal ', 'rsc'), 'осетљиво ');
  assert.equal(translatedIconText(type, 'sensitive', 'rsc'), 'на сигнал');
  assert.equal(translatedIconText('Modelica.Electrical.Digital.Delay.InertialDelaySensitive', 'sensitive', 'rsc'), 'осетљиво');
  const overrides = require('../metadata/icon-text-overrides.json');
  const texts = collectIconTexts(require('../metadata/library-graphics.json'));
  for(const [key, id] of Object.entries(overrides)) {
    const [owner, text] = key.split('\u0000');
    assert.ok(texts.get(text).has(owner));
    assert.equal(lang[id].en, text);
  }
});
