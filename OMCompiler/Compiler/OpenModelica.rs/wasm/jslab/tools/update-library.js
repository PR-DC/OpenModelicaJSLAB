/**
 * @file OpenModelicaJSLAB update library integration
 * @author Milos Petrasinovic <mpetrasinovic@pr-dc.com>
 * PR-DC, Republic of Serbia
 * info@pr-dc.com
 */

const fs = require('fs');
const path = require('path');
const updates = require('./library-updates');
/**
 * Class for update library in the compiler library.
 */
class PRDC_OMJSL_UPDATE_LIBRARY {

  /**
   * Reads an absolute directory from a named command-line option.
   * @param {*} name Catalog, class or resource name.
   */
  static argument(name) {
    const value = process.argv.find(value => value.startsWith('--' + name + '='));
    return value && path.resolve(value.slice(name.length + 3));
  }

}
const library = PRDC_OMJSL_UPDATE_LIBRARY.argument('library') || path.resolve(__dirname, '..');
if(process.argv.includes('--initialize')) {
  const bundle = PRDC_OMJSL_UPDATE_LIBRARY.argument('bundle');
  if(!bundle) {
    throw new Error('Provide --bundle=<installed compiler bundle>.');
  }
  if(fs.existsSync(path.join(library, fs.existsSync(path.join(library, 'metadata')) ? 'metadata/metadata-version.json' : 'metadata-version.json'))) {
    throw new Error('The compiler library already has versioned metadata.');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
  fs.writeFileSync(path.join(library, 'metadata-version.json'), JSON.stringify(updates.versionRecord(updates.metadata(library), updates.sourceIdentity(manifest)), null, 2) + '\n');
  console.log('Initialized library metadata provenance.');
  process.exit(0);
}
const incoming = PRDC_OMJSL_UPDATE_LIBRARY.argument('incoming');
if(!incoming) {
  throw new Error('Provide --incoming=<export directory>.');
}
const update = updates.planLibraryUpdate(library, incoming);
fs.writeFileSync(path.join(incoming, 'update-plan.json'), JSON.stringify(update.report, null, 2) + '\n');
if(process.argv.includes('--draft')) {
  const filename = path.join(incoming, 'translation-patch.json');
  if(fs.existsSync(filename)) {
    throw new Error('A translation patch already exists; it has been preserved.');
  }
  fs.writeFileSync(filename, JSON.stringify(updates.translationDraft(update), null, 2) + '\n');
}
const result = process.argv.includes('--apply') ? updates.applyLibraryUpdate(library, incoming) : {
  report: update.report
};
console.log(JSON.stringify({
  ready: result.report.ready,
  addedClasses: result.report.addedClasses.length,
  changedProperties: result.report.changedProperties.length,
  pendingTranslations: result.report.missingTranslations.length,
  pendingIconReviews: result.report.iconReview.length,
  backup: result.backup || null
}, null, 2));
if(process.argv.includes('--check') && !result.report.ready) {
  process.exitCode = 1;
}
