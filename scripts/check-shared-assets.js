const fs = require('fs');
const path = require('path');

const wrapperDir = path.resolve(__dirname, '..');
const sharedAppDir = path.resolve(wrapperDir, '..', 'app');
const appEntry = path.join(sharedAppDir, 'index.html');
const lucideEntry = path.join(wrapperDir, 'node_modules', 'lucide', 'dist', 'umd', 'lucide.min.js');

if (!fs.existsSync(appEntry)) {
  throw new Error(`Shared frontend entry not found: ${appEntry}`);
}

if (!fs.existsSync(lucideEntry)) {
  throw new Error('Run npm install before preparing the Steam build.');
}

console.log(`Using shared frontend from ${sharedAppDir}`);
