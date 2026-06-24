const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

console.log('=== Domain Radar Scan ===\n');

console.log('[Step 1/2] Generating domain list...\n');
execSync('node src/cli/generate-domain-list.js', { cwd: ROOT, stdio: 'inherit' });

console.log('\n[Step 2/2] Scanning availability...\n');
execSync('node src/cli/scan-availability.js', { cwd: ROOT, stdio: 'inherit' });
