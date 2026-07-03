const fs = require('fs');
const path = require('path');
const { notify } = require('../lib/short-domain-notifier');

const ROOT = path.join(__dirname, '..', '..');
const DATA_PATH = path.join(ROOT, 'public', 'data.json');

if (!fs.existsSync(DATA_PATH)) {
    console.error('No data.json found. Run "npm run scan-availability" first.');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const results = data.results || [];

console.log(`[Notify] Loading ${results.length} available domains`);
notify(results).catch(err => {
    console.error('Notify failed:', err.message);
    process.exit(1);
});
