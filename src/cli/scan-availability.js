const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { runChecks } = require('../lib/availability-scanner');
const { notify } = require('../lib/short-domain-notifier');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const RESULTS_DIR = path.join(ROOT, 'public', 'results');
const DOMAINS_PATH = path.join(RESULTS_DIR, 'domains.json');
const MANIFEST_PATH = path.join(RESULTS_DIR, 'manifest.json');
const TLD_CACHE_PATH = path.join(ROOT, 'data', 'tld-cache.json');

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

    // Load TLD cache
    let tldCache = { rdapUnsupported: [], whoisUnsupported: [] };
    if (fs.existsSync(TLD_CACHE_PATH)) {
        try {
            tldCache = JSON.parse(fs.readFileSync(TLD_CACHE_PATH, 'utf8'));
        } catch {}
    }

    const startTime = new Date();
    console.log(`Loaded ${domainsData.domains.length} domains (generated at ${domainsData.generatedAt})`);
    console.log(`TLD cache: ${tldCache.rdapUnsupported.length} RDAP unsupported, ${tldCache.whoisUnsupported.length} WHOIS unsupported`);

    // Estimate execution time
    const totalDomains = domainsData.domains.length;
    const dnsConcurrency = config.scanner.dnsConcurrency || 50;
    const rdapConcurrency = config.scanner.rdapConcurrency || 20;
    const whoisConcurrency = config.scanner.whoisConcurrency || 10;
    const whoisDelay = config.scanner.whoisDelay || 500;

    const dnsEstDomains = totalDomains;
    const dnsEstSec = Math.ceil(dnsEstDomains * 0.006);

    const rdapUnsupportedSet = new Set(tldCache.rdapUnsupported || []);
    const whoisUnsupportedSet = new Set(tldCache.whoisUnsupported || []);
    const dnsNotFoundRatio = 0.58;
    const rdapNeedCount = Math.ceil(totalDomains * dnsNotFoundRatio);
    const rdapSkipCount = domainsData.domains.filter(d => rdapUnsupportedSet.has(d.tld)).length;
    const rdapCheckCount = Math.ceil((rdapNeedCount - rdapSkipCount * dnsNotFoundRatio));
    const rdapEstSec = Math.ceil(rdapCheckCount * 0.08);

    const rdapResolveRatio = 0.83;
    const whoisNeedCount = Math.ceil(rdapNeedCount * (1 - rdapResolveRatio)) + Math.ceil(rdapSkipCount * dnsNotFoundRatio);
    const whoisSkipCount = domainsData.domains.filter(d => whoisUnsupportedSet.has(d.tld)).length;
    const whoisCheckCount = Math.max(0, whoisNeedCount - Math.ceil(whoisSkipCount * dnsNotFoundRatio));
    const whoisEstSec = Math.ceil((whoisCheckCount * (whoisDelay / 1000 + 1)) / whoisConcurrency);

    const totalEstSec = dnsEstSec + rdapEstSec + whoisEstSec;

    function formatDuration(sec) {
        if (sec < 60) return `${sec}s`;
        if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
        return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
    }

    console.log('\n┌──────────┬──────────┬────────────┬──────────────┐');
    console.log('│ Stage    │ Domains  │ Concurrency│ Est. Time    │');
    console.log('├──────────┼──────────┼────────────┼──────────────┤');
    console.log(`│ DNS      │ ${String(dnsEstDomains).padStart(8)} │ ${String(dnsConcurrency).padStart(10)} │ ${formatDuration(dnsEstSec).padStart(12)} │`);
    console.log(`│ RDAP     │ ${String(rdapCheckCount).padStart(8)} │ ${String(rdapConcurrency).padStart(10)} │ ${formatDuration(rdapEstSec).padStart(12)} │`);
    console.log(`│ WHOIS    │ ${String(whoisCheckCount).padStart(8)} │ ${String(whoisConcurrency).padStart(10)} │ ${formatDuration(whoisEstSec).padStart(12)} │`);
    console.log('├──────────┼──────────┼────────────┼──────────────┤');
    console.log(`│ Total    │ ${String(totalDomains).padStart(8)} │          - │ ${formatDuration(totalEstSec).padStart(12)} │`);
    console.log('└──────────┴──────────┴────────────┴──────────────┘\n');

    // Run checks
    const results = await runChecks(domainsData.domains, {
        dnsConcurrency: config.scanner.dnsConcurrency,
        rdapConcurrency: config.scanner.rdapConcurrency,
        whoisConcurrency: config.scanner.whoisConcurrency,
        whoisDelay: config.scanner.whoisDelay,
        whoisRetries: config.scanner.whoisRetries,
        tldCache
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
    console.log(`Total: ${results.length} | Available: ${availableCount} | Registered: ${registeredCount} | DNS Exists: ${dnsExistsCount} | Error: ${errorCount}`);

    // Notify if short domains are available
    await notify(results);
}

main().catch(err => {
    console.error('Check failed:', err.message);
    process.exit(1);
});
