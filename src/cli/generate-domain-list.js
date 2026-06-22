const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { generateSLDs, generateDomains } = require('../lib/domain-list-generator');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const OUTPUTS_DIR = path.join(ROOT, 'public', 'results');
const DOMAINS_PATH = path.join(OUTPUTS_DIR, 'domains.json');

async function main() {
    const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const tldLength = config.tld?.length || 3;
    const tlds = (config.tlds || []).filter(t => t.length <= tldLength);

    console.log(`Config: SLD length=${config.sld.length}, mode=${config.sld.mode}, TLD length=${tldLength}, TLDs=${tlds.length}`);

    const slds = generateSLDs(config.sld.length, config.sld.mode);
    console.log(`Generated ${slds.length} SLD combinations`);

    const domains = generateDomains(slds, tlds).map(d => ({ ...d, mode: config.sld.mode }));
    console.log(`Total domains: ${domains.length}`);

    if (!fs.existsSync(OUTPUTS_DIR)) {
        fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
    }

    const output = {
        config: {
            sldLength: config.sld.length,
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
