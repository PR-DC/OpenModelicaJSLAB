/**
 * @file OpenModelicaJSLAB pack library.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  packLibrary
} = require('../dev/pack-library');
test('Compiler library packaging preserves readable catalogs and removes retired owned files', function() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openmodelica-library-'));
  const source = path.join(root, 'source');
  const bundle = path.join(root, 'bundle');
  fs.mkdirSync(path.join(source, 'vendor'), {
    recursive: true
  });
  fs.mkdirSync(path.join(source, 'metadata'));
  fs.mkdirSync(path.join(source, 'config'));
  fs.mkdirSync(bundle);
  const catalog = {
    greeting: {
      en: 'Hello',
      rs: 'Zdravo',
      rsc: 'Здраво'
    }
  };
  fs.writeFileSync(path.join(source, 'config/lang.json'), JSON.stringify(catalog, null, 2));
  fs.writeFileSync(path.join(source, 'vendor/parser.js'), 'exports.parse = String;\n');
  fs.writeFileSync(path.join(source, 'vendor/LICENSE'), 'Test license\n');
  fs.writeFileSync(path.join(source, 'README.md'), 'Compiler library\n');
  fs.writeFileSync(path.join(bundle, 'manifest.json'), JSON.stringify({
    name: 'OpenModelicaJSLAB',
    files: {}
  }));
  try {
    const result = packLibrary(bundle, source);
    assert.equal(result.files, 3);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(bundle, 'config/lang.json'))), catalog);
    assert.equal(fs.existsSync(path.join(bundle, 'config/lang.json.br')), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json')));
    for(const [name, hash] of Object.entries(manifest.files)) {
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(bundle, name))).digest('hex'), hash);
    }
    assert.equal(fs.readFileSync(path.join(bundle, 'vendor/LICENSE'), 'utf8'), 'Test license\n');
    packLibrary(bundle, source);
    assert.equal(JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'))).integration.content_sha256, manifest.integration.content_sha256);
    catalog.greeting.rs = 'Dobar dan';
    fs.writeFileSync(path.join(source, 'config/lang.json'), JSON.stringify(catalog));
    packLibrary(bundle, source);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(bundle, 'config/lang.json'))), catalog);
    assert.throws(() => packLibrary(root, path.join(root, 'js')));
    fs.unlinkSync(path.join(source, 'vendor/parser.js'));
    packLibrary(bundle, source);
    assert.equal(fs.existsSync(path.join(bundle, 'vendor/parser.js')), false);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'))).files, 'vendor/parser.js'), false);
  } finally {
    const expected = path.resolve(os.tmpdir()) + path.sep;
    if(!root.startsWith(expected) || !path.basename(root).startsWith('openmodelica-library-')) {
      throw new Error('Unexpected library test directory.');
    }
    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  }
});
