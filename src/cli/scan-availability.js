const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { runChecks } = require('../lib/availability-scanner');
const { Logger } = require('../lib/scan-logger');
const { notify } = require('../lib/short-domain-notifier');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const RESULTS_DIR = path.join(ROOT, 'public', 'results');
const LOGS_DIR = path.join(ROOT, 'public', 'logs');
const DOMAINS_PATH = path.join(RESULTS_DIR, 'domains.json');
const MANIFEST_PATH = path.join(RESULTS_DIR, 'manifest.json');

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
        console.error('No domain list found. Run "npm run generate" first.');
        process.exit(1);
    }

    const domainsData = JSON.parse(fs.readFileSync(DOMAINS_PATH, 'utf8'));
    const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const logger = new Logger(LOGS_DIR);

    console.log(`Loaded ${domainsData.domains.length} domains (generated at ${domainsData.generatedAt})`);
    logger.info(`Check starting: ${domainsData.domains.length} domains`);
    logger.info(`Config: SLD≤${domainsData.config.sldLength}, mode=${domainsData.config.sldMode}, TLDs=${domainsData.config.tldCount}`);

    // Run checks
    const results = await runChecks(domainsData.domains, {
        dnsConcurrency: config.scanner.dnsConcurrency,
        rdapConcurrency: config.scanner.rdapConcurrency,
        whoisDelay: config.scanner.whoisDelay,
        whoisRetries: config.scanner.whoisRetries,
        logger
    });

    // Build output
    const now = new Date();
    const datetime = formatDatetime(now);
    const filename = `${datetime}.json`;

    const dnsExistsCount = results.filter(r => r.dnsExists).length;
    const availableCount = results.filter(r => !r.dnsExists && r.whois && !r.whois.registered).length;
    const registeredCount = results.filter(r => r.dnsExists || (r.whois && r.whois.registered)).length;
    const errorCount = results.filter(r => !r.dnsExists && r.whois && r.whois.registered === null).length;

    const output = {
        config: domainsData.config,
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

    // Finish
    const logResult = logger.finish();
    console.log(`\nDone! Results: public/results/${filename}`);
    console.log(`Log: public/logs/${logResult.filename}`);
    console.log(`Total: ${results.length} | Available: ${availableCount} | Registered: ${registeredCount} | DNS Exists: ${dnsExistsCount} | Error: ${errorCount}`);

    // Notify if short domains are available
    await notify(results);
}

main().catch(err => {
    console.error('Check failed:', err.message);
    process.exit(1);
});
