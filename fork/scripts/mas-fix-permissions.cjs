// Fork-only (sc-3410). electron-builder afterPack hook for the Mac App Store
// build: runs before codesign, so the signature stays valid. Makes everything
// in the app readable by non-root users (like `chmod -R a+rX`), because
// App Store Connect rejects a .pkg with root-only files (error 90255).
// Wired in by fork-mac.yml with --config.afterPack, so upstream's package.json
// stays untouched.
const fs = require('node:fs');
const path = require('node:path');

function fixPermissions(dir, fixed = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue; // chmod would follow it out of the app
    const file = path.join(dir, entry.name);
    const mode = fs.statSync(file).mode & 0o7777;
    // a+r, plus a+x for directories and files already executable by the owner.
    const wanted =
      mode | 0o444 | (entry.isDirectory() || mode & 0o100 ? 0o111 : 0);
    if (wanted !== mode) {
      fs.chmodSync(file, wanted);
      fixed.push(file);
    }
    if (entry.isDirectory()) fixPermissions(file, fixed);
  }
  return fixed;
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'mas') return;
  const app = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const fixed = fixPermissions(app);
  console.info(`mas-fix-permissions: fixed ${fixed.length} entries in ${app}`);
  for (const file of fixed.slice(0, 20)) console.info(`  ${file}`);
};
module.exports.fixPermissions = fixPermissions;
