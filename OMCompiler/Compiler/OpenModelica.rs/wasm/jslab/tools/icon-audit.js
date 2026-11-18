/**
 * @file Render compiler library icons and audit their browser output
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const fs = require('fs');
const path = require('path');
const {
  app,
  BrowserWindow
} = require('electron');
if(!process.versions.electron) {
  const {
    spawn,
    spawnSync
  } = require('child_process');
  const os = require('os');
  const temporary = path.resolve(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(temporary, 'openmodelica-icons-'));
  const env = {
    ...process.env
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, '--audit-profile=' + profile, ...process.argv.slice(2)], {
    env,
    stdio: 'inherit',
    windowsHide: true
  });
  const deadline = setTimeout(() => {
    if(child.exitCode !== null) {
      return;
    }
    console.error('Icon audit process timed out.');
    if(process.platform == 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
    } else {
      child.kill('SIGKILL');
    }
  }, 150000);
  function cleanup() {
    if(path.dirname(path.resolve(profile)) !== temporary || !path.basename(profile).startsWith('openmodelica-icons-')) {
      throw new Error('Unexpected icon audit profile path.');
    }
    fs.rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    });
  }
  child.on('error', error => {
    clearTimeout(deadline);
    console.error(error);
    cleanup();
    process.exitCode = 1;
  });
  child.on('exit', code => {
    clearTimeout(deadline);
    cleanup();
    process.exitCode = code === 0 ? 0 : 1;
  });
  return;
}
const bundle_argument = process.argv.find(function(value) {
  return value.startsWith('--bundle=');
});
if(!bundle_argument) {
  throw new Error('Provide --bundle=<installed compiler bundle>.');
}
const bundle_root = path.resolve(bundle_argument.slice(9));
const profile_argument = process.argv.find(value => value.startsWith('--audit-profile='));
if(profile_argument) {
  app.setPath('userData', profile_argument.slice('--audit-profile='.length));
}
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');
const watchdog = setTimeout(() => {
  console.error('Icon audit timed out.');
  app.exit(1);
}, 120000);
app.whenReady().then(async function() {
  var exit_code = 0;
  var custom = process.argv.includes('--custom');
  var all = process.argv.includes('--all');
  var language_argument = process.argv.find(value => value.startsWith('--language='));
  var language = language_argument ? language_argument.slice('--language='.length) : 'en';
  if(!['en', 'rs', 'rsc'].includes(language)) {
    throw new Error('Choose en, rs or rsc.');
  }
  var output_argument = process.argv.find(value => value.startsWith('--output='));
  var output = output_argument ? path.resolve(output_argument.slice(9)) : process.cwd();
  var win = new BrowserWindow({
    show: false,
    useContentSize: true,
    width: 1200,
    height: all ? 1080 : 960,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      offscreen: true
    }
  });
  try {
    await win.loadFile(path.join(__dirname, 'icon-audit.html'), {
      query: {
        bundle: bundle_root,
        custom: custom ? '1' : '0',
        all: all ? '1' : '0',
        annotations: process.argv.includes('--annotations') ? '1' : '0',
        language: language
      }
    });
    fs.mkdirSync(output, {
      recursive: true
    });
    var pages = await win.webContents.executeJavaScript('auditPageCount');
    await win.webContents.executeJavaScript('renderAuditPage(0)');
    await win.webContents.capturePage();
    var manifest = JSON.parse(fs.readFileSync(path.join(bundle_root, 'manifest.json'), 'utf8'));
    var report = {
      renderer: process.argv.includes('--annotations') ? 'annotations' : 'application',
      language: language,
      compilerCommit: manifest.commit,
      sdkHash: manifest.integration && manifest.integration.content_sha256,
      standardLibrary: manifest.standard_library,
      capturedAt: new Date().toISOString(),
      classes: 0,
      emptyInterfaces: 0,
      pages: pages,
      failures: [],
      icons: []
    };
    for(var page = 0; page < pages; page++) {
      var icons = await win.webContents.executeJavaScript('renderAuditPage(' + page + ')');
      // Repaint events can still describe an older queued compositor frame.
      // Match a page-specific raster marker before attributing pixels to icons.
      var image,
        current_frame = false,
        frame_deadline = Date.now() + 5000;
      while(Date.now() < frame_deadline) {
        image = await win.webContents.capturePage();
        var marker = image.toBitmap();
        current_frame = marker[0] == 193 && marker[1] == 37 && marker[2] == page + 1;
        if(current_frame) {
          break;
        }
        win.webContents.invalidate();
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      if(!current_frame) {
        throw new Error('The compositor did not render icon audit page ' + page + '.');
      }
      var filename = all ? 'icons-' + String(page + 1).padStart(3, '0') + '.png' : custom ? 'modelica-custom-icons.png' : 'modelica-icon-audit.png';
      fs.writeFileSync(path.join(output, filename), image.toPNG());
      var pixels = image.toBitmap(),
        size = image.getSize();
      for(const icon of icons) {
        icon.page = filename;
        icon.inkPixels = 0;
        for(var y = Math.max(0, Math.ceil(icon.rect.y)); y < Math.min(size.height, Math.floor(icon.rect.y + icon.rect.height)); y++) {
          for(var x = Math.max(0, Math.ceil(icon.rect.x)); x < Math.min(size.width, Math.floor(icon.rect.x + icon.rect.width)); x++) {
            var offset = (y * size.width + x) * 4;
            if(Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 235) {
              icon.inkPixels++;
            }
          }
        }
        if(icon.expectedEmpty) {
          report.emptyInterfaces++;
        }
        if(icon.error || icon.imageErrors.length || !icon.geometryValid || !icon.expectedEmpty && icon.inkPixels < 4 || icon.textOverflow.length) {
          report.failures.push(icon.type);
        }
        report.icons.push(icon);
      }
      report.classes += icons.length;
    }
    fs.writeFileSync(path.join(output, 'icon-audit.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({
      classes: report.classes,
      pages: pages,
      failures: report.failures.length,
      output: output
    }));
    if(report.failures.length) {
      exit_code = 1;
    }
  } catch(error) {
    console.error(error.stack || error);
    exit_code = 1;
  } finally {
    clearTimeout(watchdog);
    win.destroy();
    app.exit(exit_code);
  }
});
