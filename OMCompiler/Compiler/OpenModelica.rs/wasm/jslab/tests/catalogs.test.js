/**
 * @file OpenModelicaJSLAB catalogs.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const lang = require('../config/lang.json');
const path = require('node:path');
const updates = require('../tools/library-updates');
test('compiler library translations and label references are self-contained', function() {
  assert.deepEqual(Object.keys(lang), Object.keys(lang).map((_id, index) => 'omjsl-' + (index + 1)));
  for(const [id, entry] of Object.entries(lang)) {
    for(const language of ['en', 'rs', 'rsc']) {
      assert.equal(typeof entry[language], 'string', id + ': ' + language);
      assert.ok(entry[language].trim(), id + ': ' + language);
    }
  }
  for(const name of ['class-labels', 'description-labels', 'property-labels', 'choice-labels', 'value-labels', 'icon-text-labels', 'icon-text-overrides']) {
    for(const [key, id] of Object.entries(require('../metadata/' + name + '.json'))) {
      if(id === null) {
        continue;
      }
      assert.ok(lang[id], name + ': ' + key + ' depends on an application translation');
    }
  }
});
test('Pinned metadata still matches its recorded version', function() {
  const sdk = path.resolve(__dirname, '..');
  const version = require('../metadata/metadata-version.json');
  const actual = updates.versionRecord(updates.metadata(sdk), version.source);
  assert.equal(actual.sourceFingerprint, version.sourceFingerprint);
  assert.equal(actual.metadataFingerprint, version.metadataFingerprint);
  assert.deepEqual(actual.metadataHashes, version.metadataHashes);
  assert.deepEqual(actual.counts, version.counts);
});
