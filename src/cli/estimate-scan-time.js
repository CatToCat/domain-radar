const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const RESULTS_DIR = path.join(ROOT, 'public', 'results');
const DOMAINS_PATH = path.join(RESULTS_DIR, 'domains.json');
const TLD_CACHE_PATH = path.join(ROOT, 'data', 'tld-cache.json');

function formatDuration(sec) {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function main() {
    if (!fs.existsSync(DOMAINS_PATH)) {
        console.error('No domain list found. Run "npm run generate-domain-list" first.');
        process.exit(1);
    }

    const domainsData = JSON.parse(fs.readFileSync(DOMAINS_PATH, 'utf8'));
    const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));

    let tldCache = { rdapUnsupported: [], whoisUnsupported: [] };
    if (fs.existsSync(TLD_CACHE_PATH)) {
        try { tldCache = JSON.parse(fs.readFileSync(TLD_CACHE_PATH, 'utf8')); } catch {}
    }

    const totalDomains = domainsData.domains.length;
    const dnsConcurrency = config.scanner.dnsConcurrency || 50;
    const rdapConcurrency = config.scanner.rdapConcurrency || 20;
    const whoisConcurrency = config.scanner.whoisConcurrency || 10;
    const whoisDelay = config.scanner.whoisDelay || 500;

    const rdapUnsupportedSet = new Set(tldCache.rdapUnsupported || []);
    const whoisUnsupportedSet = new Set(tldCache.whoisUnsupported || []);

    // DNS estimate
    const dnsEstSec = Math.ceil(totalDomains * 0.006);

    // RDAP estimate
    const dnsNotFoundRatio = 0.58;
    const rdapNeedCount = Math.ceil(totalDomains * dnsNotFoundRatio);
    const rdapSkipDomains = domainsData.domains.filter(d => rdapUnsupportedSet.has(d.tld)).length;
    const rdapCheckCount = Math.max(0, Math.ceil(rdapNeedCount - rdapSkipDomains * dnsNotFoundRatio));
    const rdapEstSec = Math.ceil(rdapCheckCount * 0.08);

    // WHOIS estimate
    const rdapResolveRatio = 0.83;
    const whoisFromRdap = Math.ceil(rdapCheckCount * (1 - rdapResolveRatio));
    const whoisFromSkip = Math.ceil(rdapSkipDomains * dnsNotFoundRatio);
    const whoisNeedCount = whoisFromRdap + whoisFromSkip;
    const whoisSkipDomains = domainsData.domains.filter(d => whoisUnsupportedSet.has(d.tld)).length;
    const whoisCheckCount = Math.max(0, whoisNeedCount - Math.ceil(whoisSkipDomains * dnsNotFoundRatio));
    const whoisEstSec = Math.ceil((whoisCheckCount * (whoisDelay / 1000 + 1)) / whoisConcurrency);

    const totalEstSec = dnsEstSec + rdapEstSec + whoisEstSec;

    console.log('');
    console.log('┌──────────┬──────────┬────────────┬──────────────┐');
    console.log('│ Stage    │ Domains  │ Concurrency│ Est. Time    │');
    console.log('├──────────┼──────────┼────────────┼──────────────┤');
    console.log(`│ DNS      │ ${String(totalDomains).padStart(8)} │ ${String(dnsConcurrency).padStart(10)} │ ${formatDuration(dnsEstSec).padStart(12)} │`);
    console.log(`│ RDAP     │ ${String(rdapCheckCount).padStart(8)} │ ${String(rdapConcurrency).padStart(10)} │ ${formatDuration(rdapEstSec).padStart(12)} │`);
    console.log(`│ WHOIS    │ ${String(whoisCheckCount).padStart(8)} │ ${String(whoisConcurrency).padStart(10)} │ ${formatDuration(whoisEstSec).padStart(12)} │`);
    console.log('├──────────┼──────────┼────────────┼──────────────┤');
    console.log(`│ Total    │ ${String(totalDomains).padStart(8)} │          - │ ${formatDuration(totalEstSec).padStart(12)} │`);
    console.log('└──────────┴──────────┴────────────┴──────────────┘');
    console.log('');
}

main();
