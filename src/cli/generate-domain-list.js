const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { generateSLDs, filterTlds } = require('../lib/domain-list-generator');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const TLD_POLICY_PATH = path.join(ROOT, 'data', 'cloudflare-tlds.json');

// This is now a preview/inspection helper. The scanner generates domains
// inline per shard, so we do not write a giant domains.json anymore.
function main() {
    const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
    let policy = { supported: [] };
    if (fs.existsSync(TLD_POLICY_PATH)) {
        try { policy = JSON.parse(fs.readFileSync(TLD_POLICY_PATH, 'utf8')); } catch {}
    }

    const maxLen = config.sld?.maxLength ?? 2;
    const minLen = 1;
    const mode = config.sld?.mode || 'mixed';
    const tldMaxLength = config.tld?.maxLength ?? 2;

    const { kept: tlds } = filterTlds(policy.supported || [], policy, tldMaxLength);
    const slds = generateSLDs(minLen, maxLen, mode);
    const total = slds.length * tlds.length;

    console.log(`SLD: 1-${maxLen} chars, mode=${mode}`);
    console.log(`TLD maxLength=${tldMaxLength} -> ${tlds.length} TLDs: ${tlds.join(', ')}`);
    console.log(`SLD combinations: ${slds.length}`);
    console.log(`Total domains to scan: ${total} (${tlds.length} TLDs x ${slds.length} SLDs)`);
    console.log(`Shards (TLD x SLD-length): ${tlds.length * maxLen}`);
}

main();
