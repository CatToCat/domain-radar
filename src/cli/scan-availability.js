const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { generateSLDsOfLength, generateDomains, filterTlds } = require('../lib/domain-list-generator');
const { runChecks } = require('../lib/availability-scanner');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const TLD_POLICY_PATH = path.join(ROOT, 'data', 'tld-policy.json');
const PROGRESS_PATH = path.join(ROOT, 'data', 'scan-progress.json');
const RESULTS_DIR = path.join(ROOT, 'public', 'results');
const DOMAINS_FILE = path.join(RESULTS_DIR, 'domains.json'); // current accumulating result
const MANIFEST_PATH = path.join(RESULTS_DIR, 'manifest.json');

function loadJson(p, fallback) {
    if (!fs.existsSync(p)) return fallback;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function saveJson(p, data) {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data), 'utf8');
}

// A shard is one (tld, sldLength) pair. Build the full ordered list of shards.
function buildShards(tlds, minLen, maxLen) {
    const shards = [];
    for (let len = minLen; len <= maxLen; len++) {
        for (const tld of tlds) {
            shards.push({ tld, sldLength: len, id: `${tld}:${len}` });
        }
    }
    return shards;
}

async function main() {
    const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const policy = loadJson(TLD_POLICY_PATH, { supported: [] });

    const minLen = config.sld?.minLength ?? 2;
    const maxLen = config.sld?.maxLength ?? 3;
    const mode = config.sld?.mode || 'mixed';
    const tldLength = config.tld?.length ?? 3;
    const shardsPerRun = config.scanner?.shardsPerRun ?? 0;

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || null;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN || null;
    if (!accountId || !apiToken) {
        console.error('Cloudflare credentials required. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
        process.exit(1);
    }

    const { kept: tlds, removed } = filterTlds(policy.supported || [], policy, tldLength);
    console.log(`Config: SLD ${minLen}-${maxLen} chars, mode=${mode}, TLD length=${tldLength}`);
    console.log(`TLDs (${tlds.length}): ${tlds.join(', ')}`);
    if (removed.length) console.log(`Excluded ${removed.length} TLDs (wrong length or unsupported)`);

    const allShards = buildShards(tlds, minLen, maxLen);

    // Load progress. Reset if the config signature changed (different shard set).
    const signature = `${mode}|${minLen}-${maxLen}|${tldLength}|${tlds.join(',')}`;
    let progress = loadJson(PROGRESS_PATH, null);
    if (!progress || progress.signature !== signature) {
        progress = { signature, startedAt: new Date().toISOString(), done: [] };
        // Fresh run cycle: start a new accumulating result file.
        saveJson(DOMAINS_FILE, {
            generatedAt: new Date().toISOString(),
            config: { sldMinLength: minLen, sldMaxLength: maxLen, mode, tlds },
            results: []
        });
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

    // Load the current accumulating result file.
    const resultFile = loadJson(DOMAINS_FILE, {
        generatedAt: new Date().toISOString(),
        config: { sldMinLength: minLen, sldMaxLength: maxLen, mode, tlds },
        results: []
    });
    const seen = new Set(resultFile.results.map(r => r.domain));

    for (let i = 0; i < toRun.length; i++) {
        const shard = toRun[i];
        const slds = generateSLDsOfLength(shard.sldLength, mode);
        const domains = generateDomains(slds, [shard.tld]);
        console.log(`\n=== Shard ${i + 1}/${toRun.length}: .${shard.tld} / ${shard.sldLength}-char (${domains.length} domains) ===`);

        const { available } = await runChecks(domains, {
            dnsConcurrency: config.scanner.dnsConcurrency,
            cloudflareAccountId: accountId,
            cloudflareApiToken: apiToken,
            cloudflareBatchSize: config.scanner.cloudflareBatchSize,
            cloudflareConcurrency: config.scanner.cloudflareConcurrency,
            cloudflareDelay: config.scanner.cloudflareDelay
        });

        for (const a of available) {
            if (seen.has(a.domain)) continue;
            seen.add(a.domain);
            resultFile.results.push({ domain: a.domain, price: a.price, currency: a.currency });
        }

        // Persist after each shard so progress survives interruption.
        resultFile.generatedAt = new Date().toISOString();
        resultFile.results.sort((x, y) => x.domain.localeCompare(y.domain));
        saveJson(DOMAINS_FILE, resultFile);

        progress.done.push(shard.id);
        progress.updatedAt = new Date().toISOString();
        saveJson(PROGRESS_PATH, progress);
    }

    // Update manifest (single latest snapshot).
    const manifest = {
        latest: 'domains.json',
        generatedAt: resultFile.generatedAt,
        config: resultFile.config,
        summary: { available: resultFile.results.length },
        progress: {
            shardsDone: progress.done.length,
            shardsTotal: allShards.length,
            complete: progress.done.length >= allShards.length
        }
    };
    saveJson(MANIFEST_PATH, manifest);

    console.log(`\nDone this pass. Total available accumulated: ${resultFile.results.length}`);
    console.log(`Progress: ${progress.done.length}/${allShards.length} shards${progress.done.length >= allShards.length ? ' (cycle COMPLETE)' : ''}`);
    console.log(`Results: public/results/domains.json`);
}

main().catch(err => {
    console.error('Scan failed:', err.message);
    process.exit(1);
});
