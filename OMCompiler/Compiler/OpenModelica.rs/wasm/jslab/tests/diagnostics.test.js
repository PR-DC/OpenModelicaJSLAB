/**
 * @file OpenModelicaJSLAB diagnostics.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRDC_OMJSL_DIAGNOSTICS: diagnostics
} = require('../js/diagnostics');
test('Compiler diagnostics preserve filenames, source ranges and multiline equation details', function() {
  const source = 'Checking model\r\n[C:\\models\\Plant.mo:12:3-14:7:writable] Error: Equation mismatch.\r\n' + '  left: a + b\r\n  right: c\r\n\r\n[/workspace/Library.mo:22:1-22:8:readonly] Warning: Custom warning.\r\n' + '  This is user-defined text.\r\nNotification: Check complete.\r\n';
  const items = diagnostics.parse(source);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    severity: 'error',
    file: 'C:\\models\\Plant.mo',
    line: 12,
    column: 3,
    end_line: 14,
    end_column: 7,
    message: 'Equation mismatch.\n  left: a + b\n  right: c'
  });
  assert.equal(items[1].message, 'Custom warning.\n  This is user-defined text.');
  assert.equal(items[2].severity, 'info');
  assert.equal(items[2].line, 0);
});
test('Compiler diagnostic formatting uses library translations and preserves external message text', function() {
  const source = '[Plant.mo:2:3-2:8:writable] Error: Unknown variable x.\n  Equation: x = y;';
  const items = diagnostics.parse(source);
  const expected = {
    en: 'Error (Plant.mo: line 2, column 3): Unknown variable x.\n  Equation: x = y;',
    rs: 'Greška (Plant.mo: red 2, kolona 3): Unknown variable x.\n  Equation: x = y;',
    rsc: 'Грешка (Plant.mo: ред 2, колона 3): Unknown variable x.\n  Equation: x = y;'
  };
  for(const language of Object.keys(expected)) {
    assert.equal(diagnostics.format(items, language), expected[language]);
    assert.equal(diagnostics.error(new Error(source), language), expected[language]);
  }
  assert.equal(diagnostics.error(new Error('Custom failure\n  parameter gain')), 'Custom failure\n  parameter gain');
  assert.deepEqual(diagnostics.parse('No diagnostics.'), []);
});
