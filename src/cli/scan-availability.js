const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { runChecks } = require('../lib/availability-scanner');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const RESULTS_DIR = path.join(ROOT, 'public', 'results');
const DOMAINS_PATH = path.join(RESULTS_DIR, 'domains.json');
const MANIFEST_PATH = path.join(RESULTS_DIR, 'manifest.json');
const TLD_CACHE_PATH = path.join(ROOT, 'data', 'tld-cache.json');
const TLD_POLICY_PATH = path.join(ROOT, 'data', 'tld-policy.json');

function formatDatetime(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function updateManifest(entry) {
    let manifest = { files: [] };
    if (fs.existsSync(MANIFEST_PATH)) {
        try {
            manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        } catch {}
    }
    manifest.files.unshift(entry);
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

async function main() {
    // Load generated domains
    if (!fs.existsSync(DOMAINS_PATH)) {
        console.error('No domain list found. Run "npm run generate-domain-list" first.');
        process.exit(1);
    }

    const domainsData = JSON.parse(fs.readFileSync(DOMAINS_PATH, 'utf8'));
    const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));

    // Load TLD cache
    let tldCache = { rdapUnsupported: [], whoisUnsupported: [] };
    if (fs.existsSync(TLD_CACHE_PATH)) {
        try {
            tldCache = JSON.parse(fs.readFileSync(TLD_CACHE_PATH, 'utf8'));
        } catch {}
    }

    // Load TLD policy (premiumHeavy TLDs)
    let tldPolicy = { premiumHeavy: [] };
    if (fs.existsSync(TLD_POLICY_PATH)) {
        try {
            tldPolicy = JSON.parse(fs.readFileSync(TLD_POLICY_PATH, 'utf8'));
        } catch {}
    }

    const startTime = new Date();
    console.log(`Loaded ${domainsData.domains.length} domains (generated at ${domainsData.generatedAt})`);
    console.log(`TLD cache: ${tldCache.rdapUnsupported.length} RDAP unsupported, ${tldCache.whoisUnsupported.length} WHOIS unsupported`);

    const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || null;
    const cfApiToken = process.env.CLOUDFLARE_API_TOKEN || null;
    const cfEnabled = !!(cfAccountId && cfApiToken);
    console.log(`Cloudflare confirmation: ${cfEnabled ? 'ENABLED' : 'DISABLED (set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to enable)'}`);

    // Run checks
    const results = await runChecks(domainsData.domains, {
        dnsConcurrency: config.scanner.dnsConcurrency,
        rdapConcurrency: config.scanner.rdapConcurrency,
        whoisConcurrency: config.scanner.whoisConcurrency,
        whoisDelay: config.scanner.whoisDelay,
        whoisRetries: config.scanner.whoisRetries,
        cloudflareAccountId: cfAccountId,
        cloudflareApiToken: cfApiToken,
        cloudflareBatchSize: config.scanner.cloudflareBatchSize,
        cloudflareConcurrency: config.scanner.cloudflareConcurrency,
        cloudflareDelay: config.scanner.cloudflareDelay,
        premiumHeavy: tldPolicy.premiumHeavy || [],
        tldCache
    });

    // Build output
    const now = new Date();
    const datetime = formatDatetime(now);
    const filename = `${datetime}.json`;

    const dnsExistsCount = results.filter(r => r.dnsExists).length;
    const availableCount = results.filter(r => r.status === 'available').length;
    const premiumCount = results.filter(r => r.status === 'premium').length;
    const reservedCount = results.filter(r => r.status === 'reserved').length;
    const registeredCount = results.filter(r => r.status === 'registered').length;
    const unsupportedCount = results.filter(r => r.status === 'unsupported').length;
    const errorCount = results.filter(r => r.status === 'unknown').length;

    const output = {
        config: domainsData.config,
        summary: {
            total: results.length,
            dnsExists: dnsExistsCount,
            available: availableCount,
            premium: premiumCount,
            reserved: reservedCount,
            registered: registeredCount,
            unsupported: unsupportedCount,
            error: errorCount
        },
        startTime: startTime.toISOString(),
        endTime: now.toISOString(),
        results
    };

    // Write output
    if (!fs.existsSync(RESULTS_DIR)) {
        fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(RESULTS_DIR, filename), JSON.stringify(output, null, 2), 'utf8');

    // Update manifest
    updateManifest({
        filename,
        date: now.toISOString().split('T')[0],
        config: output.config,
        summary: output.summary
    });

    console.log(`\nDone! Results: public/results/${filename}`);
    console.log(`Total: ${results.length} | Available: ${availableCount} | Premium: ${premiumCount} | Reserved: ${reservedCount} | Registered: ${registeredCount} | Unsupported: ${unsupportedCount} | DNS Exists: ${dnsExistsCount} | Error: ${errorCount}`);
}

main().catch(err => {
    console.error('Check failed:', err.message);
    process.exit(1);
});
