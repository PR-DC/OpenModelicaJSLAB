/**
 * @file OpenModelicaJSLAB resource cache.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createHash,
  webcrypto
} = require('node:crypto');
/**
 * Class for resource cache tests in the compiler library.
 */
class PRDC_OMJSL_RESOURCE_CACHE_TEST {

  /**
   * Calculates the expected content fingerprint for a test resource.
   * @param {*} bytes Bytes.
   */
  static digest(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
  }

  /**
   * Loads the resource cache implementation in the isolated test context.
   */
  static load() {
    return import('../js/resource-cache.js');
  }

  /**
   * Provides an in-memory CacheStorage implementation for resource reuse tests.
   */
  static storage() {
    const entries = new Map();
    const cache = {
      async match(key) {
        return entries.get(key)?.clone();
      },
      async put(key, response) {
        entries.set(key, response.clone());
      },
      async delete(key) {
        return entries.delete(key);
      }
    };
    return {
      entries,
      options: {
        crypto: webcrypto,
        cacheStorage: {
          async open() {
            return cache;
          }
        }
      }
    };
  }

}
test('Solver binaries reuse verified content after reloads and compiler-folder changes', async function() {
  const {
    readVerifiedResource
  } = await PRDC_OMJSL_RESOURCE_CACHE_TEST.load();
  const f = PRDC_OMJSL_RESOURCE_CACHE_TEST.storage(),
    bytes = new Uint8Array([0, 97, 115, 109, 0, 255]);
  const hash = PRDC_OMJSL_RESOURCE_CACHE_TEST.digest(bytes),
    requests = [],
    hits = [];
  const download = async url => {
    requests.push(url);
    return bytes;
  };
  assert.deepEqual(await readVerifiedResource('https://jslab.test/lib/version-a/core.wasm', hash, download, f.options), bytes);
  assert.equal(new URL(requests[0]).searchParams.get('content'), hash);
  assert.deepEqual(await readVerifiedResource('https://jslab.test/lib/version-b/core.wasm', hash, download, {
    ...f.options,
    onCacheHit: value => hits.push(value.length)
  }), bytes);
  assert.equal(requests.length, 1);
  assert.deepEqual(hits, [bytes.length]);
  assert.equal(f.entries.size, 1);
  const changed = new Uint8Array([0, 97, 115, 109, 1]);
  await readVerifiedResource('https://jslab.test/lib/version-b/core.wasm', PRDC_OMJSL_RESOURCE_CACHE_TEST.digest(changed), async url => {
    requests.push(url);
    return changed;
  }, f.options);
  assert.equal(requests.length, 2);
  assert.equal(f.entries.size, 2);
});
test('Corrupt solver downloads are rejected and corrupt persisted entries are replaced', async function() {
  const {
    readVerifiedResource
  } = await PRDC_OMJSL_RESOURCE_CACHE_TEST.load();
  const f = PRDC_OMJSL_RESOURCE_CACHE_TEST.storage(),
    bytes = new Uint8Array([1, 2, 3]),
    hash = PRDC_OMJSL_RESOURCE_CACHE_TEST.digest(bytes);
  const url = 'https://jslab.test/core.wasm';
  await assert.rejects(readVerifiedResource(url, hash, async () => new Uint8Array([9]), f.options), /fingerprint/);
  assert.equal(f.entries.size, 0);
  await readVerifiedResource(url, hash, async () => bytes, f.options);
  f.entries.set(Array.from(f.entries.keys())[0], new Response(new Uint8Array([9])));
  let requests = 0;
  assert.deepEqual(await readVerifiedResource(url, hash, async () => {
    requests++;
    return bytes;
  }, f.options), bytes);
  assert.equal(requests, 1);
  await assert.rejects(readVerifiedResource(url, '', async () => bytes, f.options), /fingerprint/);
});
test('Desktop files stay local and denied CacheStorage still uses a versioned verified download', async function() {
  const {
    readVerifiedResource
  } = await PRDC_OMJSL_RESOURCE_CACHE_TEST.load();
  const bytes = new Uint8Array([1, 2, 3]),
    hash = PRDC_OMJSL_RESOURCE_CACHE_TEST.digest(bytes),
    requests = [];
  const options = {
    crypto: webcrypto,
    cacheStorage: {
      async open() {
        throw new Error('Storage denied');
      }
    }
  };
  const download = async url => {
    requests.push(url);
    return bytes;
  };
  await readVerifiedResource('file:///C:/JSLAB/lib/core.wasm', hash, download, options);
  assert.equal(requests[0], 'file:///C:/JSLAB/lib/core.wasm');
  await readVerifiedResource('https://jslab.test/core.wasm', hash, download, options);
  assert.equal(new URL(requests[1]).searchParams.get('content'), hash);
});
