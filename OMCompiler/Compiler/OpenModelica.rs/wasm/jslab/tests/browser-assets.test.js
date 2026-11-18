/**
 * @file OpenModelicaJSLAB browser assets.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {
  PRDC_OMJSL_BROWSER_METADATA
} = require('../js/assets-web');
const platform = require('../js/host-web');
/**
 * Class for browser assets tests in the compiler library.
 */
class PRDC_OMJSL_TESTS_BROWSER_ASSETS_TEST {

  /**
   * Provides verified catalog responses and cache records for browser loading tests.
   */
  static fixture() {
    const values = {
      'class-labels.json': {
        Gain: 'Појачање'
      },
      'library-catalog.json': {
        classes: {}
      }
    };
    const cacheValues = new Map(),
      requests = [];
    const bytes = name => Buffer.from(JSON.stringify(values[name]));
    const hash = value => crypto.createHash('sha256').update(value).digest('hex');
    const manifest = version => ({
      integration: {
        version: 1,
        content_sha256: version.repeat(64),
        web: {
          metadata: Object.fromEntries(Object.keys(values).map(name => [name, {
            file: 'metadata/' + name + '.gz',
            sha256: hash(bytes(name))
          }]))
        }
      }
    });
    const cache = {
      async match(key) {
        return cacheValues.get(key)?.clone();
      },
      async put(key, response) {
        cacheValues.set(key, response.clone());
      },
      async delete(key) {
        return cacheValues.delete(key);
      }
    };
    const options = {
      cacheStorage: {
        async open() {
          return cache;
        }
      },
      async fetch(url) {
        requests.push(url);
        const name = new URL(url).pathname.split('/').pop().slice(0, -3);
        assert.equal(new URL(url).searchParams.get('content'), hash(bytes(name)));
        return new Response(zlib.gzipSync(bytes(name)));
      }
    };
    return {
      values,
      cacheValues,
      requests,
      manifest,
      options
    };
  }

}
test('Browser catalogs are lazy, deduplicate downloads and survive page and compiler-version changes', async function() {
  const f = PRDC_OMJSL_TESTS_BROWSER_ASSETS_TEST.fixture();
  const store = new PRDC_OMJSL_BROWSER_METADATA('https://example.test/solver-a/js/', f.manifest('a'), f.options);
  assert.equal(f.requests.length, 0);
  assert.throws(() => store.read('class-labels.json'), /not loaded/);
  await Promise.all([store.load('class-labels.json'), store.load('class-labels.json'), store.load('library-catalog.json')]);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(store.read('class-labels.json'), f.values['class-labels.json']);
  const next = new PRDC_OMJSL_BROWSER_METADATA('https://example.test/solver-b/js/', f.manifest('b'), f.options);
  await next.loadAll(Object.keys(f.values));
  assert.equal(f.requests.length, 2, 'Identical catalogs reuse their content cache after a compiler update');
  f.values['class-labels.json'] = {
    Gain: 'New reviewed label'
  };
  const updated = new PRDC_OMJSL_BROWSER_METADATA('https://example.test/solver-b/js/', f.manifest('c'), f.options);
  await updated.loadAll(Object.keys(f.values));
  assert.equal(f.requests.length, 3, 'Only changed catalogs are downloaded');
  assert.equal(store.read('class-labels.json').Gain, 'Појачање');
  assert.equal(updated.read('class-labels.json').Gain, 'New reviewed label');
});
test('Corrupt browser metadata is rejected and can be retried without retaining failed requests', async function() {
  const f = PRDC_OMJSL_TESTS_BROWSER_ASSETS_TEST.fixture();
  let corrupt = true;
  const store = new PRDC_OMJSL_BROWSER_METADATA('https://example.test/js/', f.manifest('a'), {
    ...f.options,
    async fetch(url) {
      return corrupt ? new Response('{}') : f.options.fetch(url);
    }
  });
  await assert.rejects(store.load('class-labels.json'), /version mismatch/);
  assert.equal(f.cacheValues.size, 0);
  corrupt = false;
  await store.load('class-labels.json');
  assert.equal(store.read('class-labels.json').Gain, 'Појачање');
  const key = Array.from(f.cacheValues.keys())[0];
  f.cacheValues.set(key, new Response('corrupt persisted data'));
  const recovered = new PRDC_OMJSL_BROWSER_METADATA('https://example.test/js/', f.manifest('a'), f.options);
  await recovered.load('class-labels.json');
  assert.equal(recovered.read('class-labels.json').Gain, 'Појачање');
  await assert.rejects(store.load('../outside.json'), /Unknown compiler library metadata/);
});
test('Browser host operations preserve binary libraries and version worker URLs', function() {
  platform.setWorkerRoot('https://example.test/solver/js/', 'abc');
  assert.equal(platform.workerURL(), 'https://example.test/solver/js/worker.js?version=abc');
  assert.deepEqual(Array.from(platform.decodeLibraryFile(Buffer.from([0, 1, 127, 128, 254, 255]).toString('base64'))), [0, 1, 127, 128, 254, 255]);
});
