const fs = require('fs');
const path = require('path');
const { mockDomains, mockResults } = require('./mock-data');

const ROOT = path.join(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'public', 'results');
const LOGS_DIR = path.join(ROOT, 'public', 'logs');
const MANIFEST_PATH = path.join(RESULTS_DIR, 'manifest.json');

const mockRunChecks = async (domains, options) => {
    const { logger } = options;
    const results = [];

    logger?.info(`DNS check starting: ${domains.length} domains (concurrency: ${options.dnsConcurrency})`);

    for (let i = 0; i < domains.length; i++) {
        const item = domains[i];
        const mock = mockResults.find(r => r.domain === item.domain) || {
            domain: item.domain, sld: item.sld, tld: item.tld,
            sldLength: item.sld.length, tldLength: item.tld.length,
            dnsExists: true, whois: null
        };

        logger?.info(`DNS [${i + 1}/${domains.length}] ${item.domain} → ${mock.dnsExists ? 'EXISTS' : 'NOT FOUND'}`);
        results.push(mock);
    }

    const dnsExists = results.filter(r => r.dnsExists).length;
    logger?.info(`DNS check complete. Exists: ${dnsExists}, Not found: ${domains.length - dnsExists}`);

    const needWhois = results.filter(r => !r.dnsExists);
    logger?.info(`WHOIS check starting: ${needWhois.length} domains`);

    for (let i = 0; i < needWhois.length; i++) {
        const r = needWhois[i];
        logger?.info(`WHOIS checking: ${r.domain}`);
        const status = r.whois?.registered === false ? 'AVAILABLE' : r.whois?.registered === true ? 'REGISTERED' : 'ERROR';
        logger?.info(`WHOIS [${i + 1}/${needWhois.length}] ${r.domain} → ${status}`);
    }

    return results;
};

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
    const { Logger } = require('../src/lib/scan-logger');
    const { notify } = require('../src/lib/short-domain-notifier');

    const logger = new Logger(LOGS_DIR);

    console.log(`[TEST] Running scan-availability with ${mockDomains.length} mock domains\n`);

    const results = await mockRunChecks(mockDomains, {
        dnsConcurrency: 10,
        whoisDelay: 0,
        whoisRetries: 1,
        logger
    });

    const now = new Date();
    const datetime = formatDatetime(now);
    const filename = `${datetime}.json`;

    const dnsExistsCount = results.filter(r => r.dnsExists).length;
    const availableCount = results.filter(r => !r.dnsExists && r.whois && !r.whois.registered).length;
    const registeredCount = results.filter(r => r.dnsExists || (r.whois && r.whois.registered)).length;
    const errorCount = results.filter(r => !r.dnsExists && r.whois && r.whois.registered === null).length;

    const output = {
        config: { sldLength: 2, sldMode: 'mixed', tldLength: 2 },
        summary: {
            total: results.length,
            dnsExists: dnsExistsCount,
            available: availableCount,
            registered: registeredCount,
            error: errorCount
        },
        startTime: logger.startTime.toISOString(),
        endTime: now.toISOString(),
        results
    };

    if (!fs.existsSync(RESULTS_DIR)) {
        fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(RESULTS_DIR, filename), JSON.stringify(output, null, 2), 'utf8');

    updateManifest({
        filename,
        date: now.toISOString().split('T')[0],
        config: output.config,
        summary: output.summary
    });

    const logResult = logger.finish();
    console.log(`\n[TEST] Done!`);
    console.log(`[TEST] Results: public/results/${filename}`);
    console.log(`[TEST] Log: public/logs/${logResult.filename}`);
    console.log(`[TEST] Total: ${results.length} | Available: ${availableCount} | Registered: ${registeredCount} | DNS Exists: ${dnsExistsCount} | Error: ${errorCount}`);

    console.log('\n[TEST] Running notify (dry-run, no GitHub Issue created)...\n');
    await notify(results, { dryRun: true });
}

main().catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1);
});
