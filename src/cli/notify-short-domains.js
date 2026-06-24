const fs = require('fs');
const path = require('path');
const { notify } = require('../lib/short-domain-notifier');

const ROOT = path.join(__dirname, '..', '..');
const RESULTS_DIR = path.join(ROOT, 'public', 'results');
const MANIFEST_PATH = path.join(RESULTS_DIR, 'manifest.json');

if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('No manifest found. Run "npm run scan-availability" first.');
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const latest = manifest.files[0];
if (!latest) {
    console.error('No scan results in manifest.');
    process.exit(1);
}

const resultPath = path.join(RESULTS_DIR, latest.filename);
const data = JSON.parse(fs.readFileSync(resultPath, 'utf8'));

console.log(`[Notify] Loading results from ${latest.filename} (${data.results.length} domains)`);
notify(data.results).catch(err => {
    console.error('Notify failed:', err.message);
    process.exit(1);
});
