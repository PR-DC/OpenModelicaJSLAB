/**
 * @file Exports lightweight Modelica component metadata from the pinned compiler
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const {
  app,
  BrowserWindow,
  ipcMain
} = require('electron');
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const {
  parseAnnotation
} = require('../js/annotations');
const {
  recordExport
} = require('./library-updates');
/**
 * Class for export metadata in the compiler library.
 */
class PRDC_OMJSL_TOOLS_EXPORT_METADATA {

  /**
   * Bundle only raster resources referenced by exported block icons.
   * @param {*} graphics Graphics.
   */
  static async exportIconAssets(graphics) {
    var needed = new Set();
    Object.values(graphics).forEach(function(metadata) {
      metadata.icons.forEach(function(icon) {
        var annotation = parseAnnotation(icon.annotation);
        (Array.isArray(annotation) ? annotation.flat() : []).forEach(function(shape) {
          if(shape && shape.kind == 'Bitmap' && shape.values[4]) {
            needed.add(shape.values[4]);
          }
        });
      });
    });
    var manifest = JSON.parse(fs.readFileSync(path.join(bundle_root, 'manifest.json'), 'utf8'));
    var archive = path.join(bundle_root, 'packages', manifest.standard_library.archive);
    var assets = {};
    await new Promise(function(resolve, reject) {
      yauzl.open(archive, {
        lazyEntries: true
      }, function(error, zip) {
        if(error) {
          return reject(error);
        }
        zip.on('error', reject);
        zip.on('end', resolve);
        zip.on('entry', function(entry) {
          var uri = 'modelica://' + entry.fileName.split('/').slice(1).join('/');
          if(!needed.has(uri)) {
            return zip.readEntry();
          }
          zip.openReadStream(entry, function(error, stream) {
            if(error) {
              return reject(error);
            }
            var chunks = [];
            stream.on('error', reject);
            stream.on('data', function(chunk) {
              chunks.push(chunk);
            });
            stream.on('end', function() {
              var mime = {
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.svg': 'image/svg+xml',
                '.bmp': 'image/bmp',
                '.webp': 'image/webp'
              }[path.extname(entry.fileName).toLowerCase()];
              if(!mime) {
                return reject(new Error('Unsupported icon resource: ' + uri));
              }
              assets[uri] = 'data:' + mime + ';base64,' + Buffer.concat(chunks).toString('base64');
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      });
    });
    if(Object.keys(assets).length != needed.size) {
      throw new Error('Some icon resources are missing from the pinned library.');
    }
    return assets;
  }

}
const bundle_argument = process.argv.find(function(value) {
  return value.startsWith('--bundle=');
});
if(!bundle_argument) {
  throw new Error('Provide --bundle=<installed compiler bundle>.');
}
const bundle_root = path.resolve(bundle_argument.slice(9));
const output_argument = process.argv.find(function(value) {
  return value.startsWith('--output=');
});
const output_root = output_argument ? path.resolve(output_argument.slice(9)) : path.resolve(__dirname, '../.updates/incoming');
const sdk_root = path.resolve(__dirname, '../metadata');
if(output_root == sdk_root || output_root.startsWith(sdk_root + path.sep)) {
  throw new Error('Export to a staging directory, then use update-library.js.');
}
fs.mkdirSync(output_root, {
  recursive: true
});
app.disableHardwareAcceleration();
app.whenReady().then(function() {
  var inventory = process.argv.includes('--inventory');
  var graphics = process.argv.includes('--graphics');
  var schemas = process.argv.includes('--schemas');
  var all = process.argv.includes('--all') || !inventory && !graphics && !schemas;
  var win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  ipcMain.once('JSLAB_MODELICA_SCHEMA_EXPORT', async function(_event, response) {
    try {
      if(response && response.success) {
        var files = {};
        if(response.catalog) {
          files['library-catalog.json'] = response.catalog;
        }
        if(response.schemas) {
          files['component-schema.json'] = response.schemas;
        }
        if(response.records) {
          files['record-schema.json'] = response.records;
        }
        if(response.graphics) {
          files['library-graphics.json'] = response.graphics;
          files['library-assets.json'] = await PRDC_OMJSL_TOOLS_EXPORT_METADATA.exportIconAssets(response.graphics);
        }
        for(const [filename, value] of Object.entries(files)) {
          fs.writeFileSync(path.join(output_root, filename), JSON.stringify(value, null, 2) + '\n');
          console.log('Exported ' + filename + '.');
        }
        recordExport(output_root, Object.keys(files), JSON.parse(fs.readFileSync(path.join(bundle_root, 'manifest.json'), 'utf8')));
        console.log('Staged library metadata: ' + output_root);
      } else {
        console.error(response && response.error || 'Modelica schema export failed.');
        process.exitCode = 1;
      }
    } catch(error) {
      console.error(error.stack || error);
      process.exitCode = 1;
    }
    win.destroy();
    app.quit();
  });
  ipcMain.on('JSLAB_MODELICA_EXPORT_PROGRESS', function(_event, value) {
    console.log(value);
  });
  win.loadFile(path.join(__dirname, 'export-metadata.html'), {
    query: {
      bundle: bundle_root,
      all: all ? '1' : '0',
      inventory: inventory || graphics || schemas || all ? '1' : '0',
      graphics: graphics ? '1' : '0',
      schemas: schemas ? '1' : '0'
    }
  });
});
