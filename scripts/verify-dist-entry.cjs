const fs = require('node:fs');
const path = require('node:path');

const distDir = path.join(__dirname, '..', 'dist');
const indexPath = path.join(distDir, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');

const assetRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((value) => value.includes('assets/'));

if (assetRefs.length === 0) {
  throw new Error('DIST_ENTRY_HAS_NO_ASSET_REFERENCES');
}

for (const ref of assetRefs) {
  if (!ref.startsWith('./assets/')) {
    throw new Error(`DIST_ENTRY_ASSET_MUST_BE_RELATIVE: ${ref}`);
  }

  const assetPath = path.join(distDir, ref.replace(/^\.\//, ''));
  if (!fs.existsSync(assetPath)) {
    throw new Error(`DIST_ENTRY_ASSET_MISSING: ${assetPath}`);
  }
}

console.log(`Verified ${assetRefs.length} relative renderer asset references.`);
