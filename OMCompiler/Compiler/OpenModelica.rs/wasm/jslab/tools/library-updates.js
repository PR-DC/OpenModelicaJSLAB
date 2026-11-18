/**
 * @file OpenModelicaJSLAB library updates integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  collectIconTexts
} = require('../js/annotations');
const {
  iconTextPlaceholders
} = require('../js/localization');
/**
 * Class for library updates in the compiler library.
 */
class PRDC_OMJSL_LIBRARY_UPDATES {

  /**
   * Calculates a stable fingerprint for a serialized catalog or review record.
   * @param {*} value Value to inspect or convert.
   */
  static digest(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  /**
   * Reads a review file or a catalog from the installed library layout.
   * @param {*} directory Owning library or review directory.
   * @param {*} name Catalog, class or resource name.
   */
  static read(directory, name) {
    if(name == 'lang.json' && fs.existsSync(path.join(directory, 'config', name))) {
      return JSON.parse(fs.readFileSync(path.join(directory, 'config', name), 'utf8'));
    }
    return JSON.parse(fs.readFileSync(fs.existsSync(path.join(directory, name)) ? path.join(directory, name) : path.join(directory, 'metadata', name), 'utf8'));
  }

  /**
   * Writes the reviewed catalog into its owning library directory.
   * @param {*} directory Owning library or review directory.
   * @param {*} name Catalog, class or resource name.
   * @param {*} value Value to inspect or convert.
   */
  static write(directory, name, value) {
    if(name == 'lang.json' && fs.existsSync(path.join(directory, 'config'))) {
      return fs.writeFileSync(path.join(directory, 'config', name), JSON.stringify(value, null, 2) + '\n');
    }
    return fs.writeFileSync(path.join(directory, name == 'lang.json' || !fs.existsSync(path.join(directory, 'metadata')) ? name : 'metadata/' + name), JSON.stringify(value, null, 2) + '\n');
  }

  /**
   * Reads the catalogs used to fingerprint a reviewed library version.
   * @param {*} directory Owning library or review directory.
   */
  static metadata(directory) {
    return Object.fromEntries(metadataFiles.map(name => [name, PRDC_OMJSL_LIBRARY_UPDATES.read(directory, name)]));
  }

  /**
   * Records compiler and standard-library fingerprints from the installed manifest.
   * @param {*} manifest Installed compiler content manifest.
   */
  static sourceIdentity(manifest) {
    return {
      compilerCommit: manifest.commit,
      bridgeABI: manifest.bridge_abi,
      compilerFiles: Object.fromEntries(Object.entries(manifest.files || {}).filter(([name]) => name == 'js/worker.js' || name.startsWith('omc/') && name.endsWith('.wasm'))),
      standardLibrary: manifest.standard_library,
      standardLibraryHash: manifest.files && manifest.files['packages/' + (manifest.standard_library || {}).archive]
    };
  }

  /**
   * Builds the provenance record for the reviewed catalogs and their source version.
   * @param {*} data Data.
   * @param {*} source Original compiler source text.
   * @param {*} previous Previous.
   */
  static versionRecord(data, source, previous = null) {
    const classes = Object.values(data['library-catalog.json'].classes);
    const concrete = classes.filter(item => !item.partial && ['model', 'block'].includes(item.restriction));
    const hashes = Object.fromEntries(metadataFiles.map(name => [name, PRDC_OMJSL_LIBRARY_UPDATES.digest(data[name])]));
    return {
      formatVersion: 1,
      source,
      sourceFingerprint: PRDC_OMJSL_LIBRARY_UPDATES.digest(source),
      metadataHashes: hashes,
      metadataFingerprint: PRDC_OMJSL_LIBRARY_UPDATES.digest(hashes),
      previousFingerprint: previous && previous.metadataFingerprint || null,
      counts: {
        classes: classes.length,
        concrete: concrete.length
      }
    };
  }

  /**
   * Writes the incoming catalog fingerprints used to validate a staged update.
   * @param {*} directory Owning library or review directory.
   * @param {*} names Names.
   * @param {*} manifest Installed compiler content manifest.
   */
  static recordExport(directory, names, manifest) {
    const source = PRDC_OMJSL_LIBRARY_UPDATES.sourceIdentity(manifest),
      fingerprint = PRDC_OMJSL_LIBRARY_UPDATES.digest(source);
    const statePath = path.join(directory, 'export-state.json');
    const state = fs.existsSync(statePath) ? PRDC_OMJSL_LIBRARY_UPDATES.read(directory, 'export-state.json') : {};
    for(const name of names) {
      state[name] = {
        sourceFingerprint: fingerprint,
        hash: PRDC_OMJSL_LIBRARY_UPDATES.digest(PRDC_OMJSL_LIBRARY_UPDATES.read(directory, name))
      };
    }
    PRDC_OMJSL_LIBRARY_UPDATES.write(directory, 'export-state.json', state);
    if(metadataFiles.every(name => state[name] && state[name].sourceFingerprint == fingerprint && fs.existsSync(path.join(directory, name)) && PRDC_OMJSL_LIBRARY_UPDATES.digest(PRDC_OMJSL_LIBRARY_UPDATES.read(directory, name)) == state[name].hash)) {
      PRDC_OMJSL_LIBRARY_UPDATES.write(directory, 'metadata-version.json', PRDC_OMJSL_LIBRARY_UPDATES.versionRecord(PRDC_OMJSL_LIBRARY_UPDATES.metadata(directory), source));
    } else if(fs.existsSync(path.join(directory, 'metadata-version.json'))) {
      fs.unlinkSync(path.join(directory, 'metadata-version.json'));
    }
  }

  /**
   * Compares incoming definitions, translations and graphics without changing active catalogs.
   * @param {*} currentDirectory CurrentDirectory.
   * @param {*} incomingDirectory IncomingDirectory.
   */
  static planLibraryUpdate(currentDirectory, incomingDirectory) {
    const before = PRDC_OMJSL_LIBRARY_UPDATES.metadata(currentDirectory),
      after = PRDC_OMJSL_LIBRARY_UPDATES.metadata(incomingDirectory);
    const version = PRDC_OMJSL_LIBRARY_UPDATES.read(incomingDirectory, 'metadata-version.json');
    if(version.formatVersion != 1) {
      throw new Error('Unsupported library metadata format.');
    }
    if(!version.source || version.source.bridgeABI != 1) {
      throw new Error('Unsupported compiler bridge ABI. Update the compiler library bridge before importing this library version.');
    }
    const actual = PRDC_OMJSL_LIBRARY_UPDATES.versionRecord(after, version.source);
    if(actual.metadataFingerprint != version.metadataFingerprint || actual.sourceFingerprint != version.sourceFingerprint || PRDC_OMJSL_LIBRARY_UPDATES.digest(actual.metadataHashes) != PRDC_OMJSL_LIBRARY_UPDATES.digest(version.metadataHashes) || PRDC_OMJSL_LIBRARY_UPDATES.digest(actual.counts) != PRDC_OMJSL_LIBRARY_UPDATES.digest(version.counts)) {
      throw new Error('Incoming metadata does not match its export provenance.');
    }
    const patch = fs.existsSync(path.join(incomingDirectory, 'translation-patch.json')) ? PRDC_OMJSL_LIBRARY_UPDATES.read(incomingDirectory, 'translation-patch.json') : {};
    const translations = {};
    for(const [key, filename] of Object.entries(translationFiles)) {
      translations[key] = Object.assign({}, PRDC_OMJSL_LIBRARY_UPDATES.read(currentDirectory, filename), patch[key] || {});
    }
    for(const [id, value] of Object.entries(PRDC_OMJSL_LIBRARY_UPDATES.read(currentDirectory, 'lang.json'))) {
      if(PRDC_OMJSL_LIBRARY_UPDATES.digest(value) != PRDC_OMJSL_LIBRARY_UPDATES.digest(translations.lang[id])) {
        throw new Error('An update must preserve existing translation ID ' + id + '.');
      }
    }
    for(const [type, value] of Object.entries(patch.customIcons || {})) {
      if(value === null) {
        delete translations.customIcons[type];
      }
    }
    const oldClasses = before['library-catalog.json'].classes,
      newClasses = after['library-catalog.json'].classes;
    const schemas = data => Object.fromEntries(Object.entries(Object.assign({}, data['component-schema.json'], data['record-schema.json'])).filter(([, schema]) => schema));
    const oldSchemas = schemas(before),
      newSchemas = schemas(after);
    const report = {
      formatVersion: 1,
      from: PRDC_OMJSL_LIBRARY_UPDATES.digest(before),
      to: version.metadataFingerprint,
      addedClasses: [],
      removedClasses: [],
      changedClassDescriptions: [],
      changedProperties: [],
      removedProperties: [],
      changedGraphics: [],
      renameCandidates: [],
      missingTranslations: [],
      missingMetadata: [],
      iconReview: [],
      graphicsReviews: []
    };
    const localized = (id, source) => translations.lang[id] && ['en', 'rs', 'rsc'].every(language => typeof translations.lang[id][language] == 'string' && translations.lang[id][language].trim()) && (source === undefined || translations.lang[id].en == source);
    const missing = (kind, key, source) => report.missingTranslations.push({
      kind,
      key,
      source
    });
    const iconTexts = collectIconTexts(after['library-graphics.json'], translations.customIcons);
    for(const text of iconTexts.keys()) {
      const id = translations.iconTextLabels[text];
      if(!Object.hasOwn(translations.iconTextLabels, text) || id !== null && (!localized(id, text) || ['en', 'rs', 'rsc'].some(language => iconTextPlaceholders(translations.lang[id][language]) != iconTextPlaceholders(text)))) {
        missing('iconTextLabels', text, text);
      }
    }
    const iconOverrideTypes = new Set();
    for(const [key, id] of Object.entries(translations.iconTextOverrides)) {
      const separator = key.indexOf('\u0000'),
        type = key.slice(0, separator),
        text = key.slice(separator + 1);
      if(separator < 1) {
        throw new Error('Invalid icon text override key.');
      }
      if(!iconTexts.get(text)?.has(type)) {
        if(Object.hasOwn(patch.iconTextOverrides || {}, key)) {
          report.missingMetadata.push({
            type,
            kind: 'icon-text-override',
            source: text
          });
        }
        continue;
      }
      if(id !== null) {
        iconOverrideTypes.add(type);
        if(!localized(id, text) || ['en', 'rs', 'rsc'].some(language => iconTextPlaceholders(translations.lang[id][language]) != iconTextPlaceholders(text))) {
          missing('iconTextOverrides', key, text);
        }
      }
    }
    for(const [type, item] of Object.entries(newClasses)) {
      const old = oldClasses[type];
      if(!old) {
        report.addedClasses.push(type);
        if(!localized(translations.classLabels[type])) {
          missing('classLabels', type, type.split('.').pop());
        }
      }
      if(!old || item.description != old.description) {
        if(old) {
          report.changedClassDescriptions.push({
            type,
            before: old.description,
            after: item.description
          });
        }
        if(item.description && !localized(translations.descriptionLabels[type], item.description)) {
          missing('descriptionLabels', type, item.description);
        }
      }
      if(item.partial && ['model', 'block'].includes(item.restriction) && old) {
        if(!localized(translations.classLabels[type])) {
          missing('classLabels', type, type.split('.').pop());
        }
        if(item.description && item.description == old.description && !localized(translations.descriptionLabels[type], item.description)) {
          missing('descriptionLabels', type, item.description);
        }
      }
      if(['model', 'block'].includes(item.restriction)) {
        if(!item.partial && !after['component-schema.json'][type]) {
          report.missingMetadata.push({
            type,
            kind: 'schema'
          });
        }
        if(!after['library-graphics.json'][type]) {
          report.missingMetadata.push({
            type,
            kind: 'graphics'
          });
        }
      }
    }
    for(const type of Object.keys(oldClasses)) {
      if(!newClasses[type]) {
        report.removedClasses.push(type);
      }
    }
    for(const [type, schema] of Object.entries(oldSchemas)) {
      const names = new Set(((newSchemas[type] || {}).properties || []).map(property => property.name));
      for(const property of schema.properties || []) {
        if(!names.has(property.name)) {
          report.removedProperties.push({
            type,
            name: property.name
          });
        }
      }
    }
    const pendingDescriptions = new Set();
    const oldTypes = new Set(Object.values(oldSchemas).flatMap(schema => (schema.properties || []).map(property => String(property.type || '').replace(/^\./, ''))));
    const pendingTypes = new Set();
    for(const [type, schema] of Object.entries(newSchemas)) {
      const prior = new Map(((oldSchemas[type] || {}).properties || []).map(property => [property.name, property]));
      for(const property of schema.properties || []) {
        const propertyType = String(property.type || '').replace(/^\./, '');
        if(propertyType && !oldTypes.has(propertyType) && !pendingTypes.has(propertyType) && !localized(translations.classLabels[propertyType] || translations.classLabels[propertyType.split('.').pop()])) {
          missing('classLabels', propertyType, propertyType.split('.').pop());
          pendingTypes.add(propertyType);
        }
        const old = prior.get(property.name);
        if(!old || PRDC_OMJSL_LIBRARY_UPDATES.digest(old) != PRDC_OMJSL_LIBRARY_UPDATES.digest(property)) {
          report.changedProperties.push({
            type,
            name: property.name,
            before: old || null,
            after: property
          });
        }
        if((!old || old.description != property.description) && property.description && !localized(translations.propertyLabels[property.description], property.description) && !pendingDescriptions.has(property.description)) {
          missing('propertyLabels', property.description, property.description);
          pendingDescriptions.add(property.description);
        }
        const priorChoices = new Set(old && old.choices || []);
        for(const choice of property.choices || []) {
          if(priorChoices.has(choice) && old.type == property.type) {
            continue;
          }
          const key = property.type.replace(/^\./, '') + '.' + choice;
          if(!localized(translations.choiceLabels[key]) && !report.missingTranslations.some(item => item.kind == 'choiceLabels' && item.key == key)) {
            missing('choiceLabels', key, choice);
          }
        }
      }
    }
    for(const [type, graphic] of Object.entries(after['library-graphics.json'])) {
      if(PRDC_OMJSL_LIBRARY_UPDATES.digest(before['library-graphics.json'][type] || null) != PRDC_OMJSL_LIBRARY_UPDATES.digest(graphic)) {
        report.changedGraphics.push(type);
        if((PRDC_OMJSL_LIBRARY_UPDATES.read(currentDirectory, 'custom-icons.json')[type] || builtInIcons.has(type) || iconOverrideTypes.has(type)) && !Object.hasOwn(patch.customIcons || {}, type) && (patch.reviewedGraphics || {})[type] != PRDC_OMJSL_LIBRARY_UPDATES.digest(graphic)) {
          report.iconReview.push(type);
          report.graphicsReviews.push({
            type,
            before: PRDC_OMJSL_LIBRARY_UPDATES.digest(before['library-graphics.json'][type] || null),
            after: PRDC_OMJSL_LIBRARY_UPDATES.digest(graphic)
          });
        }
      }
    }
    for(const type of report.removedClasses) {
      if(translations.customIcons[type] || builtInIcons.has(type)) {
        report.iconReview.push(type);
      }
      const old = oldClasses[type];
      if(old.description) {
        for(const added of report.addedClasses) {
          if(newClasses[added].description == old.description && newClasses[added].restriction == old.restriction) {
            report.renameCandidates.push({
              before: type,
              after: added
            });
          }
        }
      }
    }
    report.ready = !report.missingTranslations.length && !report.missingMetadata.length && !report.iconReview.length;
    report.preservedTranslationIDs = Object.keys(PRDC_OMJSL_LIBRARY_UPDATES.read(currentDirectory, 'lang.json')).length;
    return {
      report,
      metadata: after,
      translations,
      version
    };
  }

  /**
   * Applies a fully reviewed update and restores the backup if a write fails.
   * @param {*} currentDirectory CurrentDirectory.
   * @param {*} incomingDirectory IncomingDirectory.
   */
  static applyLibraryUpdate(currentDirectory, incomingDirectory) {
    currentDirectory = path.resolve(currentDirectory);
    incomingDirectory = path.resolve(incomingDirectory);
    if(currentDirectory == incomingDirectory || incomingDirectory.startsWith(currentDirectory + path.sep)) {
      throw new Error('Export incoming metadata outside the compiler library source directory.');
    }
    const update = PRDC_OMJSL_LIBRARY_UPDATES.planLibraryUpdate(currentDirectory, incomingDirectory);
    if(!update.report.ready) {
      throw new Error('The library update has unreviewed changes. Generate and complete its translation patch first.');
    }
    const changes = Object.assign({}, update.metadata);
    for(const [key, filename] of Object.entries(translationFiles)) {
      changes[filename] = update.translations[key];
    }
    const oldVersion = fs.existsSync(path.join(currentDirectory, 'metadata-version.json')) ? PRDC_OMJSL_LIBRARY_UPDATES.read(currentDirectory, 'metadata-version.json') : null;
    if(oldVersion && oldVersion.metadataFingerprint == update.version.metadataFingerprint && oldVersion.sourceFingerprint == update.version.sourceFingerprint && Object.entries(changes).every(([name, value]) => fs.existsSync(path.join(currentDirectory, name)) && PRDC_OMJSL_LIBRARY_UPDATES.digest(PRDC_OMJSL_LIBRARY_UPDATES.read(currentDirectory, name)) == PRDC_OMJSL_LIBRARY_UPDATES.digest(value))) {
      return {
        report: update.report,
        backup: null,
        unchanged: true
      };
    }
    changes['metadata-version.json'] = PRDC_OMJSL_LIBRARY_UPDATES.versionRecord(update.metadata, update.version.source, oldVersion);
    const activeDescriptions = new Set(Object.values(Object.assign({}, update.metadata['component-schema.json'], update.metadata['record-schema.json'])).filter(Boolean).flatMap(schema => (schema.properties || []).map(property => property.description)));
    changes['metadata-version.json'].retiredPropertyDescriptions = Object.keys(update.translations.propertyLabels).filter(source => !activeDescriptions.has(source));
    const activeIconTexts = collectIconTexts(update.metadata['library-graphics.json'], update.translations.customIcons);
    changes['metadata-version.json'].retiredIconTexts = Object.keys(update.translations.iconTextLabels).filter(source => !activeIconTexts.has(source));
    const backupParent = path.resolve(currentDirectory, '../.updates/backups');
    fs.mkdirSync(backupParent, {
      recursive: true
    });
    const backup = fs.mkdtempSync(path.join(backupParent, update.report.from.slice(0, 12) + '-'));
    const original = {};
    for(const name of Object.keys(changes)) {
      original[name] = fs.existsSync(path.join(currentDirectory, name)) ? fs.readFileSync(path.join(currentDirectory, name)) : null;
      if(original[name]) {
        fs.writeFileSync(path.join(backup, name), original[name]);
      }
    }
    PRDC_OMJSL_LIBRARY_UPDATES.write(backup, 'update-plan.json', update.report);
    const written = [];
    const temporary = [];
    try {
      for(const [name, value] of Object.entries(changes)) {
        const staged = name + '.updating-' + process.pid;
        PRDC_OMJSL_LIBRARY_UPDATES.write(currentDirectory, staged, value);
        temporary.push(staged);
        fs.renameSync(path.join(currentDirectory, staged), path.join(currentDirectory, name));
        written.push(name);
      }
    } catch(error) {
      const failed = [];
      for(const name of written.reverse()) {
        try {
          if(original[name]) {
            fs.writeFileSync(path.join(currentDirectory, name), original[name]);
          } else {
            fs.unlinkSync(path.join(currentDirectory, name));
          }
        } catch(restoreError) {
          failed.push(name);
        }
      }
      throw new Error('Library update failed; backup: ' + backup + '. ' + error.message + (failed.length ? ' Could not restore: ' + failed.join(', ') : ''));
    } finally {
      for(const name of temporary) {
        if(fs.existsSync(path.join(currentDirectory, name))) {
          fs.unlinkSync(path.join(currentDirectory, name));
        }
      }
    }
    return {
      report: update.report,
      backup
    };
  }

  /**
   * Allocates ordered omjsl identifiers for new text while preserving existing translations.
   * @param {*} update Update.
   */
  static translationDraft(update) {
    let nextID = Math.max(0, ...Object.keys(update.translations.lang).map(id => Number(id.replace(/^omjsl-/, ''))));
    const patch = {
      lang: {},
      classLabels: {},
      descriptionLabels: {},
      propertyLabels: {},
      choiceLabels: {},
      iconTextLabels: {},
      iconTextOverrides: {},
      customIcons: {},
      reviewedGraphics: {}
    };
    const ids = new Map();
    for(const item of update.report.missingTranslations) {
      const key = item.kind + '\u0000' + item.key;
      let id = ids.get(key);
      if(!id) {
        id = 'omjsl-' + ++nextID;
        ids.set(key, id);
        patch.lang[id] = {
          en: item.source,
          rs: '',
          rsc: ''
        };
      }
      patch[item.kind][item.key] = id;
    }
    return patch;
  }

}
const builtInIcons = new Set(require('../js/icons').iconTypes);
const metadataFiles = ['library-catalog.json', 'component-schema.json', 'record-schema.json', 'library-graphics.json', 'library-assets.json'];
const translationFiles = {
  lang: 'lang.json',
  classLabels: 'class-labels.json',
  descriptionLabels: 'description-labels.json',
  propertyLabels: 'property-labels.json',
  choiceLabels: 'choice-labels.json',
  iconTextLabels: 'icon-text-labels.json',
  iconTextOverrides: 'icon-text-overrides.json',
  customIcons: 'custom-icons.json'
};
exports.metadataFiles = metadataFiles;
exports.metadata = PRDC_OMJSL_LIBRARY_UPDATES.metadata;
exports.sourceIdentity = PRDC_OMJSL_LIBRARY_UPDATES.sourceIdentity;
exports.versionRecord = PRDC_OMJSL_LIBRARY_UPDATES.versionRecord;
exports.recordExport = PRDC_OMJSL_LIBRARY_UPDATES.recordExport;
exports.planLibraryUpdate = PRDC_OMJSL_LIBRARY_UPDATES.planLibraryUpdate;
exports.applyLibraryUpdate = PRDC_OMJSL_LIBRARY_UPDATES.applyLibraryUpdate;
exports.translationDraft = PRDC_OMJSL_LIBRARY_UPDATES.translationDraft;
