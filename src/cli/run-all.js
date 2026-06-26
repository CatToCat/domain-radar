const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

console.log('=== Domain Radar Scan ===\n');

// Generation is now done inline per-shard by the scanner; just run it.
execSync('node src/cli/scan-availability.js', { cwd: ROOT, stdio: 'inherit' });
