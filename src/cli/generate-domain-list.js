const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { generateSLDs, generateDomains, filterTldsByPolicy } = require('../lib/domain-list-generator');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const TLD_POLICY_PATH = path.join(ROOT, 'data', 'tld-policy.json');
const OUTPUTS_DIR = path.join(ROOT, 'public', 'results');
const DOMAINS_PATH = path.join(OUTPUTS_DIR, 'domains.json');

function loadTldPolicy() {
    if (!fs.existsSync(TLD_POLICY_PATH)) return { restricted: [], premiumHeavy: [] };
    try {
        return JSON.parse(fs.readFileSync(TLD_POLICY_PATH, 'utf8'));
    } catch {
        return { restricted: [], premiumHeavy: [] };
    }
}

async function main() {
    const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const policy = loadTldPolicy();
    const tldLength = config.tld?.length || 3;
    // minSldLength defaults to 2: single-character SLDs are almost universally
    // reserved by registries, so scanning them only produces false positives.
    const minSldLength = config.sld?.minLength ?? 2;

    const lengthFiltered = (config.tlds || []).filter(t => t.length <= tldLength);
    const { kept: tlds, removed } = filterTldsByPolicy(lengthFiltered, policy);

    console.log(`Config: SLD length=${minSldLength}-${config.sld.length}, mode=${config.sld.mode}, TLD length<=${tldLength}`);
    console.log(`TLDs: ${tlds.length} CF-supported (excluded ${removed.length} unsupported: ${removed.join(', ') || 'none'})`);

    const slds = generateSLDs(config.sld.length, config.sld.mode, { minLength: minSldLength });
    console.log(`Generated ${slds.length} SLD combinations (minLength=${minSldLength})`);

    const domains = generateDomains(slds, tlds).map(d => ({ ...d, mode: config.sld.mode }));
    console.log(`Total domains: ${domains.length}`);

    if (!fs.existsSync(OUTPUTS_DIR)) {
        fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
    }

    const output = {
        config: {
            sldLength: config.sld.length,
            sldMinLength: minSldLength,
            sldMode: config.sld.mode,
            tldCount: tlds.length
        },
        generatedAt: new Date().toISOString(),
        tlds,
        domains
    };

    const header = JSON.stringify({ config: output.config, generatedAt: output.generatedAt, tlds: output.tlds });
    const lines = domains.map(d => JSON.stringify(d));
    const stream = fs.createWriteStream(DOMAINS_PATH);
    stream.write(`{"config":${JSON.stringify(output.config)},"generatedAt":"${output.generatedAt}","tlds":${JSON.stringify(output.tlds)},"domains":[\n`);
    for (let i = 0; i < lines.length; i++) {
        stream.write(lines[i] + (i < lines.length - 1 ? ',\n' : '\n'));
    }
    stream.write(']}\n');
    stream.end();
    await new Promise(resolve => stream.on('finish', resolve));
    console.log(`\nDomain list saved to public/results/domains.json (${domains.length} domains)`);
}

main().catch(err => {
    console.error('Generate failed:', err.message);
    process.exit(1);
});
