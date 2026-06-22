const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const whoiser = require('whoiser');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const TLD_CACHE_PATH = path.join(ROOT, 'data', 'tld-cache.json');
const RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';

async function getRdapSupportedTlds() {
    const res = await fetch(RDAP_BOOTSTRAP_URL);
    if (!res.ok) throw new Error(`Failed to fetch RDAP bootstrap: ${res.status}`);
    const data = await res.json();
    const supported = new Set();
    for (const [tlds] of data.services) {
        for (const tld of tlds) {
            supported.add(tld.toLowerCase());
        }
    }
    return supported;
}

async function checkWhoisSupport(tld) {
    const testDomain = `test-probe-domain.${tld}`;
    try {
        await whoiser.domain(testDomain);
        return true;
    } catch (err) {
        if (err.message && err.message.includes('not supported')) {
            return false;
        }
        return true;
    }
}

async function main() {
    const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const tlds = config.tlds || [];

    console.log(`Checking ${tlds.length} TLDs for RDAP/WHOIS support...`);

    // Check RDAP support
    console.log('\n[RDAP] Fetching IANA bootstrap registry...');
    const rdapSupported = await getRdapSupportedTlds();
    const rdapUnsupported = tlds.filter(tld => !rdapSupported.has(tld));
    console.log(`[RDAP] Supported: ${tlds.length - rdapUnsupported.length}, Unsupported: ${rdapUnsupported.length}`);

    // Check WHOIS support
    console.log('\n[WHOIS] Probing TLD support (this may take a minute)...');
    const whoisUnsupported = [];
    for (let i = 0; i < tlds.length; i++) {
        const tld = tlds[i];
        const supported = await checkWhoisSupport(tld);
        if (!supported) {
            whoisUnsupported.push(tld);
        }
        if ((i + 1) % 20 === 0) {
            console.log(`[WHOIS] Progress: ${i + 1}/${tlds.length}`);
        }
        await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[WHOIS] Supported: ${tlds.length - whoisUnsupported.length}, Unsupported: ${whoisUnsupported.length}`);

    // Write cache
    const cache = {
        rdapUnsupported: rdapUnsupported.sort(),
        whoisUnsupported: whoisUnsupported.sort(),
        lastUpdated: new Date().toISOString()
    };

    const dataDir = path.dirname(TLD_CACHE_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(TLD_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');

    console.log(`\nCache written to ${TLD_CACHE_PATH}`);
    console.log(`  RDAP unsupported: [${cache.rdapUnsupported.join(', ')}]`);
    console.log(`  WHOIS unsupported: [${cache.whoisUnsupported.join(', ')}]`);
}

main().catch(err => {
    console.error('Failed to update TLD cache:', err.message);
    process.exit(1);
});
