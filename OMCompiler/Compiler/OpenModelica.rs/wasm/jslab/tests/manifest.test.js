/**
 * @file OpenModelicaJSLAB manifest.test integration
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
  spawnSync
} = require('node:child_process');
test('Build manifests include the reviewed library, verify its hash and fingerprint the compiler library', function() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openmodelica-manifest-'));
  const bundle = path.join(root, 'bundle');
  const source = path.resolve(__dirname, '../../../../../..');
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  fs.mkdirSync(path.join(bundle, 'packages'), {
    recursive: true
  });
  fs.mkdirSync(path.join(bundle, 'js'));
  const library = {
    archive: 'test.zip',
    root: 'TestLibrary'
  };
  fs.writeFileSync(path.join(bundle, 'packages', library.archive), 'Pinned library');
  fs.writeFileSync(path.join(bundle, 'js', 'client.js'), 'Client');
  const metadata = path.join(root, 'metadata-version.json');
  fs.writeFileSync(metadata, JSON.stringify({
    source: {
      standardLibrary: library,
      standardLibraryHash: hash('Pinned library')
    }
  }));
  const run = () => spawnSync('python', [path.join(__dirname, '../make-manifest.py'), bundle, source, metadata], {
    encoding: 'utf8'
  });
  try {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json')));
    assert.deepEqual(manifest.standard_library, library);
    assert.equal(manifest.files['packages/test.zip'], hash('Pinned library'));
    assert.equal(manifest.integration.content_sha256, hash(JSON.stringify({
      'js/client.js': hash('Client')
    })));
    fs.writeFileSync(path.join(bundle, 'packages', library.archive), 'Wrong library');
    const invalid = run();
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /does not match the reviewed compiler library metadata/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'))), manifest);
  } finally {
    if(!root.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('openmodelica-manifest-')) {
      throw new Error('Unexpected manifest test directory.');
    }
    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  }
});
