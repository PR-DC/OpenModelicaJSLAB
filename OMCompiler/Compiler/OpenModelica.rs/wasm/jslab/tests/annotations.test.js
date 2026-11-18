/**
 * @file OpenModelicaJSLAB annotations.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  renderAnnotation,
  annotationTextSize
} = require('../js/annotations');
test('Automatic text sizing respects complete font metrics, line count and zero-width extents', function() {
  assert.equal(annotationTextSize(120, 100, [1000], 0, 120), 12);
  assert.equal(annotationTextSize(0, 120, [1000], 0, 120), 100);
  assert.equal(annotationTextSize(0, 235, [100, 100], 0, 120), 100);
  assert.equal(annotationTextSize(100, 40, [1000], 24, 120), 24);
});
test('Bitmap annotations render portable SVG and BMP images without accepting non-image resources', function() {
  for(const mime of ['svg+xml', 'bmp', 'png', 'text/html']) {
    const nodes = [];
    const document = {
      createElementNS(_namespace, tag) {
        const node = {
          tag,
          ownerDocument: document,
          attributes: {},
          setAttribute(name, value) {
            this.attributes[name] = String(value);
          },
          appendChild() {}
        };
        nodes.push(node);
        return node;
      }
    };
    const uri = 'modelica://External/Resources/icon';
    const image = 'data:' + (mime == 'text/html' ? mime : 'image/' + mime) + ';base64,AA==';
    const metadata = {
      type: 'External.Block',
      assets: {
        [uri]: image
      },
      icons: [
        {
          type: 'External.Block',
          annotation: '{-100,-100,100,100,true,-,-,,{Bitmap(true,{0,0},0,{{-10,-10},{10,10}},"' + uri + '","")}}'
        }
      ]
    };
    const count = renderAnnotation(document.createElementNS('', 'svg'), metadata, {
      name: 'block',
      modifiers: []
    }, 20, 20);
    const images = nodes.filter(node => node.tag == 'image');
    assert.equal(images.length, mime == 'text/html' ? 0 : 1, mime);
    assert.equal(count, images.length);
    if(images.length) {
      assert.equal(images[0].attributes.href, image);
    }
  }
});
