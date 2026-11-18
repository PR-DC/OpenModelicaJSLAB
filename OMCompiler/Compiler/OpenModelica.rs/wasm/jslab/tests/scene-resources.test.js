/**
 * @file Lazy CAD resource discovery tests
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
test('Resource discovery decodes compiler XML names without importing the animation core', async function() {
  const {
    PRDC_OMJSL_SCENE: Scene
  } = await import('../js/scene.js');
  assert.deepEqual(Scene.resourceNames('<visualization/>'), []);
  assert.deepEqual(Scene.resourceNames('<type>box</type><type>sphere</type><type>spring</type>'), []);
  assert.deepEqual(Scene.resourceNames('<type>modelica://External/A&amp;B.obj</type><type>file:///C:/test&#32;part.stl</type>' + '<type>modelica://External/A&amp;B.obj</type><type>1</type>'), ['modelica://External/A&B.obj', 'file:///C:/test part.stl', '1']);
  // Node has no browser file/XHR loader. This proves the empty/primitive path
  // returns before reading the manifest or loading a WASM module.
  assert.deepEqual(await Scene.collectResources('<visualization><shape><type>box</type></shape></visualization>', () => {
    throw new Error('No CAD resource should be read.');
  }), {});
});
