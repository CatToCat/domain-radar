const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { generateSLDs, filterTlds } = require('../lib/domain-list-generator');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const TLD_POLICY_PATH = path.join(ROOT, 'data', 'tld-policy.json');

// This is now a preview/inspection helper. The scanner generates domains
// inline per shard, so we do not write a giant domains.json anymore.
function main() {
    const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
    let policy = { supported: [] };
    if (fs.existsSync(TLD_POLICY_PATH)) {
        try { policy = JSON.parse(fs.readFileSync(TLD_POLICY_PATH, 'utf8')); } catch {}
    }

    const minLen = config.sld?.minLength ?? 2;
    const maxLen = config.sld?.maxLength ?? 3;
    const mode = config.sld?.mode || 'mixed';
    const tldLength = config.tld?.length ?? 3;

    const { kept: tlds, removed } = filterTlds(policy.supported || [], policy, tldLength);
    const slds = generateSLDs(minLen, maxLen, mode);
    const total = slds.length * tlds.length;

    console.log(`SLD: ${minLen}-${maxLen} chars, mode=${mode}`);
    console.log(`TLD length=${tldLength} -> ${tlds.length} TLDs: ${tlds.join(', ')}`);
    if (removed.length) console.log(`Excluded ${removed.length} TLDs`);
    console.log(`SLD combinations: ${slds.length}`);
    console.log(`Total domains to scan: ${total} (${tlds.length} TLDs x ${slds.length} SLDs)`);
    console.log(`Shards (TLD x SLD-length): ${tlds.length * (maxLen - minLen + 1)}`);
}

main();
