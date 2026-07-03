const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { generateSLDsOfLength, generateDomains, filterTlds } = require('../lib/domain-list-generator');
const { runChecks } = require('../lib/availability-scanner');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const TLD_POLICY_PATH = path.join(ROOT, 'data', 'cloudflare-tlds.json');
const PROGRESS_PATH = path.join(ROOT, 'data', 'scan-progress.json');
const DATA_RESULTS_DIR = path.join(ROOT, 'data', 'results');
const WEB_DATA_FILE = path.join(ROOT, 'public', 'data.json');

function loadJson(p, fallback) {
    if (!fs.existsSync(p)) return fallback;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function saveJson(p, data) {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function buildShards(tlds, minLen, maxLen) {
    const shards = [];
    for (let len = minLen; len <= maxLen; len++) {
        for (const tld of tlds) {
            shards.push({ tld, sldLength: len, id: `${tld}:${len}` });
        }
    }
    return shards;
}

function getDateStr() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function main() {
    const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const policy = loadJson(TLD_POLICY_PATH, { supported: [] });

    const maxLen = config.sld?.maxLength ?? 2;
    const minLen = 1;
    const mode = config.sld?.mode || 'mixed';
    const tldMaxLength = config.tld?.maxLength ?? 2;
    const shardsPerRun = config.scanner?.shardsPerRun ?? 0;

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || null;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN || null;
    if (!accountId || !apiToken) {
        console.error('Cloudflare credentials required. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
        process.exit(1);
    }

    const { kept: tlds } = filterTlds(policy.supported || [], policy, tldMaxLength);
    console.log(`Config: SLD 1-${maxLen} chars, mode=${mode}, TLD maxLength=${tldMaxLength}`);
    console.log(`TLDs (${tlds.length}): ${tlds.join(', ')}`);

    const allShards = buildShards(tlds, minLen, maxLen);

    const signature = `${mode}|${minLen}-${maxLen}|tldMax${tldMaxLength}|${tlds.join(',')}`;
    let progress = loadJson(PROGRESS_PATH, null);
    if (!progress || progress.signature !== signature) {
        progress = { signature, startedAt: new Date().toISOString(), done: [] };
        console.log('Started a new scan cycle (config changed or no progress found).');
    }

    const doneSet = new Set(progress.done);
    const pending = allShards.filter(s => !doneSet.has(s.id));
    if (pending.length === 0) {
        console.log('All shards already scanned for this cycle. Delete data/scan-progress.json to rescan.');
        return;
    }

    const toRun = shardsPerRun > 0 ? pending.slice(0, shardsPerRun) : pending;
    console.log(`Shards: ${allShards.length} total, ${doneSet.size} done, running ${toRun.length} this pass.`);

    // Full scan results for today (all domains with status)
    const dateStr = getDateStr();
    const dailyResultPath = path.join(DATA_RESULTS_DIR, `${dateStr}.json`);
    const dailyResult = loadJson(dailyResultPath, {
        date: dateStr,
        config: { sldMaxLength: maxLen, mode, tldMaxLength, tlds },
        domains: []
    });
    const seenDaily = new Set(dailyResult.domains.map(r => r.domain));

    // Available domains for web display
    const availableAll = [];

    for (let i = 0; i < toRun.length; i++) {
        const shard = toRun[i];
        const slds = generateSLDsOfLength(shard.sldLength, mode);
        const domains = generateDomains(slds, [shard.tld]);
        console.log(`\n=== Shard ${i + 1}/${toRun.length}: .${shard.tld} / ${shard.sldLength}-char (${domains.length} domains) ===`);

        const { available, allResults } = await runChecks(domains, {
            dnsConcurrency: config.scanner.dnsConcurrency,
            cloudflareAccountId: accountId,
            cloudflareApiToken: apiToken,
            cloudflareBatchSize: config.scanner.cloudflareBatchSize,
            cloudflareConcurrency: config.scanner.cloudflareConcurrency,
            cloudflareDelay: config.scanner.cloudflareDelay
        });

        for (const r of allResults) {
            if (!seenDaily.has(r.domain)) {
                seenDaily.add(r.domain);
                dailyResult.domains.push(r);
            }
        }

        for (const a of available) {
            availableAll.push({ domain: a.domain, price: a.price, currency: a.currency, tier: a.tier });
        }

        // Persist after each shard
        dailyResult.updatedAt = new Date().toISOString();
        saveJson(dailyResultPath, dailyResult);

        progress.done.push(shard.id);
        progress.updatedAt = new Date().toISOString();
        saveJson(PROGRESS_PATH, progress);
    }

    // Write web data file (single file: summary + results)
    const availableDomains = dailyResult.domains.filter(d => d.status === 'available');
    const unavailableDomains = dailyResult.domains.filter(d => d.status === 'unavailable');
    const stats = {
        total: dailyResult.domains.length,
        available: {
            total: availableDomains.length,
            standard: availableDomains.filter(d => d.tier === 'standard').length,
            premium: availableDomains.filter(d => d.tier === 'premium').length
        },
        unavailable: {
            total: unavailableDomains.length,
            registered: unavailableDomains.filter(d => d.reason === 'registered').length,
            other: unavailableDomains.filter(d => d.reason !== 'registered' && d.reason !== 'error').length,
            error: unavailableDomains.filter(d => d.reason === 'error').length
        }
    };
    const webData = {
        generatedAt: new Date().toISOString(),
        config: { sldMaxLength: maxLen, mode, tldMaxLength, tlds },
        summary: stats,
        results: availableAll.sort((a, b) => a.domain.localeCompare(b.domain))
    };
    saveJson(WEB_DATA_FILE, webData);

    console.log(`\nDone this pass.`);
    console.log(`  Total checked: ${stats.total}`);
    console.log(`  Available: ${stats.available.total} (standard: ${stats.available.standard}, premium: ${stats.available.premium})`);
    console.log(`  Unavailable: ${stats.unavailable.total} (registered: ${stats.unavailable.registered}, other: ${stats.unavailable.other}, error: ${stats.unavailable.error})`);
    console.log(`Progress: ${progress.done.length}/${allShards.length} shards${progress.done.length >= allShards.length ? ' (cycle COMPLETE)' : ''}`);
    console.log(`Full log: ${dailyResultPath}`);
    console.log(`Web data: ${WEB_DATA_FILE}`);
}

main().catch(err => {
    console.error('Scan failed:', err.message);
    process.exit(1);
});
