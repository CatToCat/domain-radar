const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const whoiser = require('whoiser');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const TLD_CACHE_PATH = path.join(ROOT, 'data', 'tld-cache.json');
const RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';

const NOT_FOUND_PATTERNS = [
    'DOMAIN NOT FOUND', 'NO MATCH FOR', 'NO ENTRIES FOUND',
    'NOT FOUND', 'NO OBJECT FOUND', 'NOT REGISTERED', 'NO DATA FOUND'
];

const REGISTERED_PATTERNS = [
    'REGISTRAR', 'CREATION DATE', 'REGISTRY DOMAIN ID',
    'EXPIRY DATE', 'UPDATED DATE', 'NAME SERVER:'
];

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

function parseWhoisResult(whoisData) {
    let rawText = '';
    for (const server in whoisData) {
        if (whoisData[server] && whoisData[server].text) {
            rawText += whoisData[server].text + '\n';
        }
        if (typeof whoisData[server] === 'string') {
            rawText += whoisData[server] + '\n';
        }
    }
    if (!rawText && typeof whoisData === 'object') {
        rawText = JSON.stringify(whoisData);
    }

    const upper = rawText.toUpperCase();
    if (NOT_FOUND_PATTERNS.some(p => upper.includes(p))) return 'available';
    if (REGISTERED_PATTERNS.some(p => upper.includes(p))) return 'registered';
    return null;
}

async function checkWhoisSupport(tld) {
    const testDomains = [`test-probe.${tld}`, `zzz999.${tld}`];

    for (const domain of testDomains) {
        try {
            const whoisData = await whoiser.domain(domain);
            const result = parseWhoisResult(whoisData);
            if (result !== null) return 'supported';
        } catch (err) {
            if (err.message && err.message.includes('not supported')) {
                return 'not_supported';
            }
        }
        await new Promise(r => setTimeout(r, 500));
    }

    return 'unparseable';
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
    console.log('\n[WHOIS] Probing TLD support (testing 2 domains per TLD)...');
    const whoisUnsupported = [];
    const whoisUnparseable = [];

    for (let i = 0; i < tlds.length; i++) {
        const tld = tlds[i];
        const status = await checkWhoisSupport(tld);

        if (status === 'not_supported') {
            whoisUnsupported.push(tld);
            console.log(`  [${i + 1}/${tlds.length}] .${tld} → NOT SUPPORTED`);
        } else if (status === 'unparseable') {
            whoisUnparseable.push(tld);
            console.log(`  [${i + 1}/${tlds.length}] .${tld} → UNPARSEABLE`);
        } else if ((i + 1) % 20 === 0) {
            console.log(`  [${i + 1}/${tlds.length}] progress...`);
        }
    }

    const allWhoisUnsupported = [...whoisUnsupported, ...whoisUnparseable];
    console.log(`\n[WHOIS] Results:`);
    console.log(`  Supported: ${tlds.length - allWhoisUnsupported.length}`);
    console.log(`  Not supported (library error): ${whoisUnsupported.length}`);
    console.log(`  Unparseable (connects but unrecognized format): ${whoisUnparseable.length}`);

    // Write cache
    const cache = {
        rdapUnsupported: rdapUnsupported.sort(),
        whoisUnsupported: allWhoisUnsupported.sort(),
        lastUpdated: new Date().toISOString()
    };

    const dataDir = path.dirname(TLD_CACHE_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(TLD_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');

    console.log(`\nCache written to ${TLD_CACHE_PATH}`);
    console.log(`  RDAP unsupported (${cache.rdapUnsupported.length}): [${cache.rdapUnsupported.join(', ')}]`);
    console.log(`  WHOIS unsupported (${cache.whoisUnsupported.length}): [${cache.whoisUnsupported.join(', ')}]`);
}

main().catch(err => {
    console.error('Failed to update TLD cache:', err.message);
    process.exit(1);
});
