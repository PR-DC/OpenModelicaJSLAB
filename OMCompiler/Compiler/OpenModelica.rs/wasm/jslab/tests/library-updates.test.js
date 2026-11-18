/**
 * @file OpenModelicaJSLAB library updates.test integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  spawnSync
} = require('node:child_process');
const updates = require('../tools/library-updates');
/**
 * Class for library updates tests in the compiler library.
 */
class PRDC_OMJSL_TESTS_LIBRARY_UPDATES_TEST {

  /**
   * Creates isolated current and incoming catalogs for update and rollback tests.
   * @param {*} callback Callback.
   */
  static fixture(callback) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openmodelica-update-'));
    const sdk = path.join(root, 'metadata'),
      incoming = path.join(root, 'incoming');
    fs.mkdirSync(sdk);
    fs.mkdirSync(incoming);
    const write = (directory, name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2));
    const read = (directory, name) => JSON.parse(fs.readFileSync(path.join(directory, name)));
    const type = 'Modelica.Test.A';
    const before = {
      'library-catalog.json': {
        classes: {
          [type]: {
            type,
            restriction: 'block',
            partial: false,
            description: 'Original block'
          }
        }
      },
      'component-schema.json': {
        [type]: {
          properties: [{
            name: 'k',
            type: 'Real',
            description: 'Gain factor',
            default_value: '1'
          }]
        }
      },
      'record-schema.json': {},
      'library-graphics.json': {
        [type]: {
          icons: [{
            annotation: 'Original icon'
          }]
        }
      },
      'library-assets.json': {}
    };
    for(const [name, value] of Object.entries(before)) {
      write(sdk, name, value);
    }
    const lang = {
      1: {
        en: 'A',
        rs: 'Blok A',
        rsc: 'Блок A'
      },
      2: {
        en: 'Original block',
        rs: 'Izvorni blok',
        rsc: 'Изворни блок'
      },
      3: {
        en: 'Gain factor',
        rs: 'Pojačanje',
        rsc: 'Појачање'
      }
    };
    write(sdk, 'lang.json', lang);
    write(sdk, 'class-labels.json', {
      [type]: 1
    });
    write(sdk, 'description-labels.json', {
      [type]: 2
    });
    write(sdk, 'property-labels.json', {
      'Gain factor': 3
    });
    write(sdk, 'choice-labels.json', {});
    write(sdk, 'icon-text-labels.json', {});
    write(sdk, 'icon-text-overrides.json', {});
    write(sdk, 'custom-icons.json', {});
    const manifest = {
      commit: 'a'.repeat(40),
      bridge_abi: 1,
      standard_library: {
        archive: 'library-v1.zip'
      },
      files: {
        'js/worker.js': 'worker-v1',
        'omc/compiler.wasm': 'compiler-v1',
        'packages/library-v1.zip': 'archive-v1'
      }
    };
    function stage(data, source = updates.sourceIdentity(manifest)) {
      for(const [name, value] of Object.entries(data)) {
        write(incoming, name, value);
      }
      write(incoming, 'metadata-version.json', updates.versionRecord(data, source));
    }
    try {
      callback({
        root,
        sdk,
        incoming,
        before,
        lang,
        type,
        manifest,
        write,
        read,
        stage
      });
    } finally {
      if(!root.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('openmodelica-update-')) {
        throw new Error('Unexpected update test directory.');
      }
      fs.rmSync(root, {
        recursive: true,
        force: true
      });
    }
  }

}
test('Abstract classes require translated labels, descriptions and offline graphics during updates', function() {
  PRDC_OMJSL_TESTS_LIBRARY_UPDATES_TEST.fixture(function(f) {
    const type = 'Modelica.Test.Base';
    const after = structuredClone(f.before);
    after['library-catalog.json'].classes[type] = {
      type,
      restriction: 'block',
      partial: true,
      description: 'Base class'
    };
    f.stage(after);
    let report = updates.planLibraryUpdate(f.sdk, f.incoming).report;
    assert.ok(report.missingMetadata.some(item => item.type == type && item.kind == 'graphics'));
    assert.ok(!report.missingMetadata.some(item => item.type == type && item.kind == 'schema'));
    after['library-graphics.json'][type] = {
      type,
      icons: [],
      ports: []
    };
    f.stage(after);
    report = updates.planLibraryUpdate(f.sdk, f.incoming).report;
    assert.ok(report.missingTranslations.some(item => item.kind == 'classLabels' && item.key == type));
    assert.ok(report.missingTranslations.some(item => item.kind == 'descriptionLabels' && item.key == type));
    f.write(f.incoming, 'translation-patch.json', {
      classLabels: {
        [type]: 4
      },
      descriptionLabels: {
        [type]: 5
      },
      lang: {
        4: {
          en: 'Base',
          rs: 'Osnova',
          rsc: 'Основа'
        },
        5: {
          en: 'Base class',
          rs: 'Osnovna klasa',
          rsc: 'Основна класа'
        }
      }
    });
    assert.equal(updates.applyLibraryUpdate(f.sdk, f.incoming).report.ready, true);
    assert.equal(f.read(f.sdk, 'class-labels.json')[type], 4);
    const labels = f.read(f.sdk, 'class-labels.json');
    const descriptions = f.read(f.sdk, 'description-labels.json');
    delete labels[type];
    delete descriptions[type];
    f.write(f.sdk, 'class-labels.json', labels);
    f.write(f.sdk, 'description-labels.json', descriptions);
    fs.unlinkSync(path.join(f.incoming, 'translation-patch.json'));
    report = updates.planLibraryUpdate(f.sdk, f.incoming).report;
    assert.ok(!report.addedClasses.includes(type));
    assert.ok(report.missingTranslations.some(item => item.kind == 'classLabels' && item.key == type));
    assert.ok(report.missingTranslations.some(item => item.kind == 'descriptionLabels' && item.key == type));
  });
});
test('The CI check rejects incomplete reviews without changing the active compiler library', function() {
  PRDC_OMJSL_TESTS_LIBRARY_UPDATES_TEST.fixture(function(f) {
    const run = () => spawnSync(process.execPath, [path.resolve(__dirname, '../tools/update-library.js'), '--library=' + f.sdk, '--incoming=' + f.incoming, '--check'], {
      encoding: 'utf8'
    });
    f.stage(f.before);
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ready, true);
    const after = structuredClone(f.before);
    after['component-schema.json'][f.type].properties[0].description = 'New description needing review';
    f.stage(after);
    result = run();
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).ready, false);
    assert.equal(JSON.parse(result.stdout).pendingTranslations, 1);
    assert.deepEqual(f.read(f.sdk, 'component-schema.json'), f.before['component-schema.json']);
    assert.deepEqual(f.read(f.sdk, 'lang.json'), f.lang);
    assert.equal(fs.existsSync(path.join(f.root, '.updates')), false);
  });
});
test('A version update preserves translations and IDs while reviewing only changed definitions', function() {
  PRDC_OMJSL_TESTS_LIBRARY_UPDATES_TEST.fixture(function(f) {
    const after = structuredClone(f.before);
    after['component-schema.json'][f.type].properties[0].default_value = '2';
    f.stage(after);
    assert.equal(updates.planLibraryUpdate(f.sdk, f.incoming).report.ready, true);
    after['component-schema.json'][f.type].properties[0].description = 'Improved gain factor';
    after['library-catalog.json'].classes[f.type].description = 'Clarified block';
    f.stage(after);
    const pending = updates.planLibraryUpdate(f.sdk, f.incoming);
    assert.equal(pending.report.missingTranslations.length, 2);
    assert.equal(pending.report.ready, false);
    assert.throws(() => updates.applyLibraryUpdate(f.sdk, f.incoming));
    assert.deepEqual(f.read(f.sdk, 'lang.json'), f.lang);
    const patch = updates.translationDraft(pending);
    for(const entry of Object.values(patch.lang)) {
      entry.rs = 'Proveren prevod';
      entry.rsc = 'Проверен превод';
    }
    f.write(f.incoming, 'translation-patch.json', patch);
    const applied = updates.applyLibraryUpdate(f.sdk, f.incoming);
    const updated = f.read(f.sdk, 'lang.json');
    for(const [id, value] of Object.entries(f.lang)) {
      assert.deepEqual(updated[id], value);
    }
    assert.equal(Object.keys(updated).length, Object.keys(f.lang).length + 2);
    assert.deepEqual(f.read(f.sdk, 'component-schema.json'), after['component-schema.json']);
    assert.deepEqual(f.read(applied.backup, 'lang.json'), f.lang);
    assert.equal(f.read(f.sdk, 'metadata-version.json').metadataFingerprint, pending.version.metadataFingerprint);
  });
});
test('Reapplying an installed version preserves provenance and does not create another backup', function() {
  PRDC_OMJSL_TESTS_LIBRARY_UPDATES_TEST.fixture(function(f) {
    f.stage(f.before);
    updates.applyLibraryUpdate(f.sdk, f.incoming);
    const version = fs.readFileSync(path.join(f.sdk, 'metadata-version.json'), 'utf8');
    const backupRoot = path.join(f.root, '.updates/backups');
    const backups = fs.readdirSync(backupRoot);
    const result = updates.applyLibraryUpdate(f.sdk, f.incoming);
    assert.equal(result.unchanged, true);
    assert.equal(result.backup, null);
    assert.equal(fs.readFileSync(path.join(f.sdk, 'metadata-version.json'), 'utf8'), version);
    assert.deepEqual(fs.readdirSync(backupRoot), backups);
  });
});
test('Existing translations cannot be overwritten and incoming metadata cannot be mixed silently', function() {
  PRDC_OMJSL_TESTS_LIBRARY_UPDATES_TEST.fixture(function(f) {
    f.stage(f.before);
    f.write(f.incoming, 'translation-patch.json', {
      lang: {
        1: {
          en: 'Different',
          rs: 'Drugo',
          rsc: 'Друго'
        }
      }
    });
    assert.throws(() => updates.planLibraryUpdate(f.sdk, f.incoming), /preserve existing translation/);
    fs.unlinkSync(path.join(f.incoming, 'translation-patch.json'));
    const altered = structuredClone(f.before['library-catalog.json']);
    altered.classes[f.type].description = 'Unexpected change';
    f.write(f.incoming, 'library-catalog.json', altered);
    assert.throws(() => updates.planLibraryUpdate(f.sdk, f.incoming), /provenance/);
    updates.recordExport(f.incoming, updates.metadataFiles, f.manifest);
    assert.ok(fs.existsSync(path.join(f.incoming, 'metadata-version.json')));
    const other = structuredClone(f.manifest);
    other.commit = 'b'.repeat(40);
    updates.recordExport(f.incoming, ['library-catalog.json'], other);
    assert.equal(fs.existsSync(path.join(f.incoming, 'metadata-version.json')), false);
    updates.recordExport(f.incoming, updates.metadataFiles.slice(1), other);
    assert.equal(f.read(f.incoming, 'metadata-version.json').source.compilerCommit, other.commit);
  });
});
test('An incompatible compiler bridge cannot silently replace library metadata', function() {
  PRDC_OMJSL_TESTS_LIBRARY_UPDATES_TEST.fixture(function(f) {
    const source = updates.sourceIdentity(f.manifest);
    source.bridgeABI = 2;
    f.stage(f.before, source);
    assert.throws(() => updates.applyLibraryUpdate(f.sdk, f.incoming), /Unsupported compiler bridge ABI/);
    assert.deepEqual(f.read(f.sdk, 'lang.json'), f.lang);
    assert.equal(fs.existsSync(path.join(f.root, '.updates')), false);
  });
});
test('New icon text requires review and preserves parameter markers and retired translations', function() {
  PRDC_OMJSL_TESTS_LIBRARY_UPDATES_TEST.fixture(function(f) {
    const after = structuredClone(f.before);
    function drawing(text) {
      return [
        {
          annotation: '{-100,-100,100,100,true,-,-,,{Text(true,{0,0},0,{0,0,0},{0,0,0},LinePattern.Solid,FillPattern.None,0.25,{{-100,-20},{100,20}},' + JSON.stringify(text) + ',0,{-1,-1,-1},"",{},TextAlignment.Center)}}'
        }
      ];
    }
    after['library-graphics.json'][f.type].icons = drawing('New label %k');
    f.stage(after);
    const pending = updates.planLibraryUpdate(f.sdk, f.incoming);
    assert.deepEqual(pending.report.missingTranslations, [{
      kind: 'iconTextLabels',
      key: 'New label %k',
      source: 'New label %k'
    }]);
    const patch = updates.translationDraft(pending);
    const id = patch.iconTextLabels['New label %k'];
    patch.lang[id].rs = 'Nova oznaka';
    patch.lang[id].rsc = 'Нова ознака %k';
    f.write(f.incoming, 'translation-patch.json', patch);
    assert.equal(updates.planLibraryUpdate(f.sdk, f.incoming).report.ready, false);
    patch.lang[id].rs = 'Nova oznaka %k';
    f.write(f.incoming, 'translation-patch.json', patch);
    const first = updates.applyLibraryUpdate(f.sdk, f.incoming);
    assert.deepEqual(f.read(first.backup, 'icon-text-labels.json'), {});
    assert.equal(f.read(f.sdk, 'icon-text-labels.json')['New label %k'], id);
    after['library-graphics.json'][f.type].icons = drawing('R=0');
    f.stage(after);
    f.write(f.incoming, 'translation-patch.json', {
      iconTextLabels: {
        'R=0': null
      }
    });
    assert.equal(updates.planLibraryUpdate(f.sdk, f.incoming).report.ready, true);
    updates.applyLibraryUpdate(f.sdk, f.incoming);
    assert.deepEqual(f.read(f.sdk, 'metadata-version.json').retiredIconTexts, ['New label %k']);
    assert.equal(f.read(f.sdk, 'icon-text-labels.json')['New label %k'], id);
    assert.equal(f.read(f.sdk, 'icon-text-labels.json')['R=0'], null);
    assert.equal(f.read(f.sdk, 'lang.json')[id].rs, 'Nova oznaka %k');
  });
});
test('A newly introduced property type requires a label without retranslating existing types', function() {
  PRDC_OMJSL_TESTS_LIBRARY_UPDATES_TEST.fixture(function(f) {
    const after = structuredClone(f.before);
    after['component-schema.json'][f.type].properties[0].type = 'Medium.AbsolutePressure';
    f.stage(after);
    const plan = updates.planLibraryUpdate(f.sdk, f.incoming);
    assert.equal(plan.report.ready, false);
    assert.deepEqual(plan.report.missingTranslations, [{
      kind: 'classLabels',
      key: 'Medium.AbsolutePressure',
      source: 'AbsolutePressure'
    }]);
    const patch = updates.translationDraft(plan);
    for(const entry of Object.values(patch.lang)) {
      entry.rs = 'Apsolutni pritisak';
      entry.rsc = 'Апсолутни притисак';
    }
    f.write(f.incoming, 'translation-patch.json', patch);
    assert.equal(updates.planLibraryUpdate(f.sdk, f.incoming).report.ready, true);
    updates.applyLibraryUpdate(f.sdk, f.incoming);
    assert.ok(f.read(f.sdk, 'class-labels.json')['Medium.AbsolutePressure']);
  });
});
test('Changed drawings with class-specific phrasing require a fresh review and preserve translation IDs', function() {
  PRDC_OMJSL_TESTS_LIBRARY_UPDATES_TEST.fixture(function(f) {
    const after = structuredClone(f.before);
    after['library-graphics.json'][f.type].icons = [
      {
        annotation: '{-100,-100,100,100,true,-,-,,{Text(true,{0,0},0,{0,0,0},{0,0,0},LinePattern.Solid,FillPattern.None,0.25,{{-100,-20},{100,20}},"Phrase",0,{-1,-1,-1},"",{},TextAlignment.Center)}}'
      }
    ];
    f.stage(after);
    const patch = updates.translationDraft(updates.planLibraryUpdate(f.sdk, f.incoming));
    const id = patch.iconTextLabels.Phrase;
    patch.lang[id].rs = 'Fraza';
    patch.lang[id].rsc = 'Фраза';
    patch.iconTextOverrides[f.type + '\u0000Phrase'] = id;
    f.write(f.incoming, 'translation-patch.json', patch);
    let plan = updates.planLibraryUpdate(f.sdk, f.incoming);
    assert.deepEqual(plan.report.iconReview, [f.type]);
    patch.reviewedGraphics[f.type] = plan.report.graphicsReviews[0].after;
    f.write(f.incoming, 'translation-patch.json', patch);
    updates.applyLibraryUpdate(f.sdk, f.incoming);
    after['library-graphics.json'][f.type].icons[0].annotation = after['library-graphics.json'][f.type].icons[0].annotation.replace('-100,-20', '-80,-20');
    f.stage(after);
    plan = updates.planLibraryUpdate(f.sdk, f.incoming);
    assert.equal(plan.report.ready, false);
    assert.deepEqual(plan.report.missingTranslations, []);
    patch.reviewedGraphics[f.type] = plan.report.graphicsReviews[0].after;
    f.write(f.incoming, 'translation-patch.json', patch);
    updates.applyLibraryUpdate(f.sdk, f.incoming);
    assert.equal(f.read(f.sdk, 'icon-text-overrides.json')[f.type + '\u0000Phrase'], id);
    assert.equal(f.read(f.sdk, 'lang.json')[id].rsc, 'Фраза');
  });
});
test('Record-field changes use the same incremental translation review as block properties', function() {
  PRDC_OMJSL_TESTS_LIBRARY_UPDATES_TEST.fixture(function(f) {
    f.before['record-schema.json'] = {
      'Modelica.Test.Data': {
        properties: [{
          name: 'k',
          type: 'Real',
          description: 'Gain factor',
          default_value: '1'
        }]
      }
    };
    f.write(f.sdk, 'record-schema.json', f.before['record-schema.json']);
    const after = structuredClone(f.before);
    after['record-schema.json']['Modelica.Test.Data'].properties[0].description = 'Improved record gain';
    f.stage(after);
    const plan = updates.planLibraryUpdate(f.sdk, f.incoming);
    assert.equal(plan.report.ready, false);
    assert.equal(plan.report.changedProperties.length, 1);
    assert.equal(plan.report.changedProperties[0].type, 'Modelica.Test.Data');
    assert.deepEqual(plan.report.missingTranslations, [{
      kind: 'propertyLabels',
      key: 'Improved record gain',
      source: 'Improved record gain'
    }]);
  });
});
test('Renamed classes and modified custom icons require explicit review while old work stays available', function() {
  PRDC_OMJSL_TESTS_LIBRARY_UPDATES_TEST.fixture(function(f) {
    const after = structuredClone(f.before),
      nextType = 'Modelica.Test.Renamed';
    for(const name of ['library-catalog.json', 'component-schema.json', 'library-graphics.json']) {
      const map = name == 'library-catalog.json' ? after[name].classes : after[name];
      map[nextType] = map[f.type];
      delete map[f.type];
    }
    after['library-catalog.json'].classes[nextType].type = nextType;
    f.write(f.sdk, 'custom-icons.json', {
      [f.type]: {
        kind: 'custom',
        annotation: 'Original custom drawing'
      }
    });
    f.stage(after);
    let plan = updates.planLibraryUpdate(f.sdk, f.incoming);
    assert.deepEqual(plan.report.renameCandidates, [{
      before: f.type,
      after: nextType
    }]);
    assert.deepEqual(plan.report.iconReview, [f.type]);
    f.write(f.incoming, 'translation-patch.json', {
      classLabels: {
        [nextType]: 1
      },
      descriptionLabels: {
        [nextType]: 2
      },
      customIcons: {
        [f.type]: null,
        [nextType]: {
          kind: 'custom',
          annotation: 'Original custom drawing'
        }
      }
    });
    const result = updates.applyLibraryUpdate(f.sdk, f.incoming);
    assert.deepEqual(f.read(f.sdk, 'lang.json'), f.lang);
    assert.equal(f.read(f.sdk, 'class-labels.json')[f.type], 1);
    assert.equal(f.read(f.sdk, 'class-labels.json')[nextType], 1);
    assert.ok(f.read(result.backup, 'custom-icons.json')[f.type]);
    assert.ok(f.read(f.sdk, 'custom-icons.json')[nextType]);
  });
});
test('An interrupted write restores the old catalogs and translations', function() {
  PRDC_OMJSL_TESTS_LIBRARY_UPDATES_TEST.fixture(function(f) {
    const after = structuredClone(f.before);
    after['component-schema.json'][f.type].properties[0].default_value = '4';
    f.stage(after);
    const originalRename = fs.renameSync;
    fs.renameSync = function(source, destination) {
      if(destination == path.join(f.sdk, 'class-labels.json')) {
        throw new Error('Injected write failure');
      }
      return originalRename(source, destination);
    };
    try {
      assert.throws(() => updates.applyLibraryUpdate(f.sdk, f.incoming), /Injected write failure/);
    } finally {
      fs.renameSync = originalRename;
    }
    assert.deepEqual(f.read(f.sdk, 'lang.json'), f.lang);
    for(const [name, value] of Object.entries(f.before)) {
      assert.deepEqual(f.read(f.sdk, name), value);
    }
    assert.equal(fs.readdirSync(f.sdk).some(name => name.includes('.updating-')), false);
  });
});
