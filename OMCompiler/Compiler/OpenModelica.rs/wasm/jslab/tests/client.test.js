/**
 * @file OpenModelicaJSLAB client.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRDC_OMJSL_CLIENT
} = require('../js/client');
/**
 * Class for client tests in the compiler library.
 */
class PRDC_OMJSL_TESTS_CLIENT_TEST {

  /**
   * Provides a controllable worker for compiler request and lifecycle tests.
   * @param {*} context Context.
   */
  static workerFixture(context) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    const workers = [],
      timers = new Set();
    /**
     * Class for client tests in the compiler library.
     */
    class Worker {
      /**
       * * * * Connects the owning service to its dependencies and initial state.
       */
      constructor() {
        this.listeners = {};
        this.terminated = false;
        workers.push(this);
      }
      /**
       * Records the worker event handler requested by the compiler client.
       * @param {*} name Catalog, class or resource name.
       * @param {*} listener Listener.
       */
      addEventListener(name, listener) {
        this.listeners[name] = listener;
      }
      /**
       * Records the submitted compiler request for the owning test.
       * @param {*} message Message.
       */
      postMessage(message) {
        if(message.command == 'bad-data') {
          throw new Error('Data could not be cloned.');
        }
        if(message.command == 'compile' || message.command == 'status') {
          queueMicrotask(() => {
            this.listeners.message({
              data: {
                id: message.id,
                success: true,
                result: {
                  available: true
                }
              }
            });
          });
        }
      }
      /**
       * Records that the compiler client released its worker.
       */
      terminate() {
        this.terminated = true;
      }
    }
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: Worker
    });
    context.mock.method(globalThis, 'setInterval', function(callback) {
      const timer = {
        callback
      };
      timers.add(timer);
      return timer;
    });
    context.mock.method(globalThis, 'clearInterval', timer => timers.delete(timer));
    const client = new PRDC_OMJSL_CLIENT('unused');
    context.after(function() {
      client.close();
      if(original) {
        Object.defineProperty(globalThis, 'Worker', original);
      } else {
        delete globalThis.Worker;
      }
    });
    return {
      client,
      workers,
      timers
    };
  }

}
test('Library folders retain resources and discover standalone or nested entry choices without a worker', function() {
  const entries = names => PRDC_OMJSL_CLIENT.libraryEntries(names.map(path => ({
    path
  })));
  assert.deepEqual(entries(['Resources/body.stl', 'Plant.mo', 'Resources/icon.svg']), {
    entries: ['Plant.mo'],
    preferred: 'Plant.mo'
  });
  assert.deepEqual(entries(['Block.mo', 'package.mo', 'Nested/package.mo']), {
    entries: ['Block.mo', 'Nested/package.mo', 'package.mo'],
    preferred: 'package.mo'
  });
  assert.deepEqual(entries(['Z.mo', 'A.mo', 'Resources/body.obj', 'A.mo']), {
    entries: ['A.mo', 'Z.mo'],
    preferred: ''
  });
  assert.deepEqual(entries(['Nested/package.mo', 'Resources/data.bin']), {
    entries: ['Nested/package.mo'],
    preferred: 'Nested/package.mo'
  });
  assert.deepEqual(entries(['../Bad.mo', '/Bad.mo', 'C:\\Bad.mo', 'a/../Bad.mo', 'Resources/icon.svg']), {
    entries: [],
    preferred: ''
  });
});
test('Reimport replaces covered roots without dropping other imported classes', function() {
  const a = {
      roots: ['A'],
      files: ['old']
    },
    b = {
      roots: ['B'],
      files: ['other']
    };
  const newer = {
    roots: ['A'],
    files: ['new']
  };
  assert.deepEqual(PRDC_OMJSL_CLIENT.updatedLibraries([a, b], newer), [b, newer]);
  const shared = {
    roots: ['A', 'C']
  };
  assert.deepEqual(PRDC_OMJSL_CLIENT.updatedLibraries([shared, b], newer), [shared, b, newer]);
  const child = {
    roots: ['A.Child']
  };
  assert.deepEqual(PRDC_OMJSL_CLIENT.updatedLibraries([child], newer), [newer]);
  assert.deepEqual(a.files, ['old']);
});
test('Compilation responses retain full diagnostics rather than the worker preview', async function(context) {
  const {
    client
  } = PRDC_OMJSL_TESTS_CLIENT_TEST.workerFixture(context);
  const response = {
    success: false,
    stdout: '[Plant.mo:3:1-3:9:writable] Error: Invalid equation.\n  x = missing;',
    diagnostics: [{
      severity: 'error',
      message: 'Invalid equation.'
    }]
  };
  context.mock.method(client, '_loadLibraries', async function() {});
  context.mock.method(client, 'request', async function(command) {
    assert.equal(command, 'compile');
    return response;
  });
  const result = await client.compile({
    action: 'check'
  });
  assert.equal(result.success, false);
  assert.equal(result.stdout, response.stdout);
  assert.equal(result.diagnostics[0].message, 'Invalid equation.\n  x = missing;');
  assert.equal(result.diagnostics[0].file, 'Plant.mo');
});
test('Worker failure stops progress polling and restores project libraries on restart', async function(context) {
  const {
    client,
    workers,
    timers
  } = PRDC_OMJSL_TESTS_CLIENT_TEST.workerFixture(context);
  const restored = [];
  client.setLibraries([{
    id: 'external',
    entry: 'External.mo',
    roots: ['External'],
    files: []
  }]);
  client.libraries_loaded = Promise.resolve();
  client.importLibrary = async request => {
    restored.push(request.id);
    return ['External'];
  };
  const pending = client.request('hold');
  const rejected = assert.rejects(pending, /Worker crashed/);
  assert.equal(timers.size, 1);
  workers[0].listeners.error({
    message: 'Worker crashed'
  });
  await rejected;
  assert.equal(workers[0].terminated, true);
  assert.equal(timers.size, 0);
  assert.equal(client.control, null);
  assert.equal(client.libraries_loaded, null);
  assert.equal((await client.compile({})).available, true);
  assert.deepEqual(restored, ['external']);
  assert.equal(workers.length, 2);
  assert.equal(timers.size, 1);
  client.close();
  assert.equal(timers.size, 0);
});
test('Closing a busy client settles requests and a clone failure does not retain pending data', async function(context) {
  const {
    client,
    workers,
    timers
  } = PRDC_OMJSL_TESTS_CLIENT_TEST.workerFixture(context);
  await assert.rejects(client.request('bad-data'), /could not be cloned/);
  assert.equal(client.pending.size, 0);
  assert.equal((await client.status()).available, true);
  assert.equal(workers.length, 1);
  const pending = client.request('hold');
  const rejected = assert.rejects(pending, /Solver stopped/);
  client.close();
  await rejected;
  assert.equal(client.pending.size, 0);
  assert.equal(workers[0].terminated, true);
  assert.equal(timers.size, 0);
});
test('External namespaces are queried from their imported source even under Modelica', async function() {
  const client = new PRDC_OMJSL_CLIENT('unused');
  client._loadLibraries = async function() {};
  const requests = [];
  client.request = async function(command, data) {
    requests.push({
      command,
      data
    });
    return [{
      type: data.request.parent + '.Block'
    }];
  };
  assert.deepEqual(await client.libraryClasses('Modelica.External', true, true), [{
    type: 'Modelica.External.Block'
  }]);
  assert.deepEqual(requests, [
    {
      command: 'library-classes',
      data: {
        request: {
          parent: 'Modelica.External',
          recursive: true,
          include_root: true
        }
      }
    }
  ]);
});
test('Restoring imported binary files preserves every byte across client restarts', async function() {
  const client = new PRDC_OMJSL_CLIENT('unused');
  const restored = [];
  client.setLibraries([
    {
      id: 'binary',
      entry: 'External.mo',
      files: [{
        path: 'icon.bmp',
        data: Buffer.from([0, 1, 127, 128, 254, 255]).toString('base64')
      }]
    }
  ]);
  client.importLibrary = async request => {
    restored.push(Array.from(request.files[0].data));
    return ['External'];
  };
  await client._loadLibraries();
  await client._loadLibraries();
  assert.deepEqual(restored, [[0, 1, 127, 128, 254, 255]]);
  client.close();
  await client._loadLibraries();
  assert.deepEqual(restored, [[0, 1, 127, 128, 254, 255], [0, 1, 127, 128, 254, 255]]);
});
test('Recursive standard-library browsing includes roots without starting the compiler', async function() {
  const client = new PRDC_OMJSL_CLIENT('unused');
  client._start = function() {
    throw new Error('Unexpected compiler startup');
  };
  const classes = await client.libraryClasses('Modelica.Blocks', true, true);
  assert.ok(classes.some(item => item.type == 'Modelica.Blocks' && item.package));
  assert.ok(classes.some(item => item.type == 'Modelica.Blocks.Math.Gain'));
  assert.ok(classes.every(item => item.type == 'Modelica.Blocks' || item.type.startsWith('Modelica.Blocks.')));
  const children = await client.libraryClasses('Modelica.Blocks');
  assert.ok(!children.some(item => item.type == 'Modelica.Blocks.Math.Gain'));
});
test('Imported search indexes complete trees and standalone roots once per library set', async function() {
  const client = new PRDC_OMJSL_CLIENT('unused');
  const calls = [];
  client._loadLibraries = async function() {};
  client.libraryClasses = async function(root, recursive, includeRoot) {
    calls.push({
      root,
      recursive,
      includeRoot
    });
    return [
      {
        type: root,
        package: false,
        restriction: 'block'
      },
      {
        type: root + '.Nested.Block',
        package: false,
        restriction: 'model'
      }
    ];
  };
  client.setLibraries([{
    roots: ['Standalone']
  }]);
  const first = await client.importedClasses();
  assert.deepEqual(first.map(item => item.type), ['Standalone', 'Standalone.Nested.Block']);
  assert.deepEqual(calls, [{
    root: 'Standalone',
    recursive: true,
    includeRoot: true
  }]);
  assert.equal(await client.importedClasses(), first);
  assert.equal(calls.length, 1);
  client.setLibraries([{
    roots: ['Replacement']
  }]);
  assert.equal((await client.importedClasses())[0].type, 'Replacement');
  assert.equal(calls.length, 2);
});
test('Restoring a project rediscovers legacy empty roots before building its imported index', async function() {
  const client = new PRDC_OMJSL_CLIENT('unused');
  client.setLibraries([{
    id: 'old',
    entry: 'Block.mo',
    roots: [],
    files: []
  }]);
  client.importLibrary = async () => ['Restored'];
  client.libraryClasses = async root => [{
    type: root
  }];
  assert.deepEqual(await client.importedClasses(), [{
    type: 'Restored'
  }]);
  assert.deepEqual(client.libraries[0].roots, ['Restored']);
});
test('Imported graphics resolve SVG and BMP resources relative to their library entry', async function() {
  const client = new PRDC_OMJSL_CLIENT('unused');
  client.setLibraries([
    {
      entry: 'External/package.mo',
      roots: ['External'],
      files: [{
        path: 'External/Resources/icon.svg',
        data: Buffer.from('<svg/>').toString('base64')
      }, {
        path: 'External/Resources/icon.BMP',
        data: Buffer.from('BM').toString('base64')
      }, {
        path: 'Unrelated/icon.svg',
        data: Buffer.from('Ignored').toString('base64')
      }]
    }
  ]);
  client._loadLibraries = async function() {};
  client.request = async function() {
    return {
      type: 'External.Block',
      icons: [],
      ports: []
    };
  };
  const graphic = await client.componentGraphics('External.Block');
  assert.equal(graphic.assets['modelica://External/Resources/icon.svg'], 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'));
  assert.equal(graphic.assets['modelica://External/Resources/icon.BMP'], 'data:image/bmp;base64,' + Buffer.from('BM').toString('base64'));
  assert.equal(Object.keys(graphic.assets).length, 2);
});
test('Standard record fields and scalar aliases can be inspected without loading the solver', async function() {
  const client = new PRDC_OMJSL_CLIENT('unused');
  client._start = function() {
    throw new Error('Unexpected compiler startup');
  };
  const schemas = require('../metadata/component-schema.json');
  for(const schema of Object.values(schemas)) {
    for(const property of schema.properties) {
      await client.recordSchema(property.type);
    }
  }
  const friction = await client.recordSchema('Modelica.Electrical.Machines.Losses.FrictionParameters');
  assert.equal(friction.properties.find(item => item.name == 'PRef').default_value, '0');
  assert.equal(friction.properties.find(item => item.name == 'tauRef').final, true);
  assert.equal(await client.recordSchema('Modelica.Fluid.Interfaces.PartialLumpedVolume.Medium.AbsolutePressure'), null);
  assert.deepEqual((await client.recordSchema('Complex')).properties.map(item => item.name), ['re', 'im']);
});
