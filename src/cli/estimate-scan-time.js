const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { generateSLDs, filterTlds } = require('../lib/domain-list-generator');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const TLD_POLICY_PATH = path.join(ROOT, 'data', 'tld-policy.json');

function formatDuration(sec) {
    sec = Math.ceil(sec);
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function main() {
    const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
    let policy = { supported: [] };
    if (fs.existsSync(TLD_POLICY_PATH)) {
        try { policy = JSON.parse(fs.readFileSync(TLD_POLICY_PATH, 'utf8')); } catch {}
    }

    const minLen = config.sld?.minLength ?? 2;
    const maxLen = config.sld?.maxLength ?? 3;
    const mode = config.sld?.mode || 'mixed';
    const tldLength = config.tld?.length ?? 3;

    const { kept: tlds } = filterTlds(policy.supported || [], policy, tldLength);
    const sldCount = generateSLDs(minLen, maxLen, mode).length;
    const total = sldCount * tlds.length;

    const dnsConcurrency = config.scanner.dnsConcurrency || 50;
    const cfConcurrency = config.scanner.cloudflareConcurrency || 3;
    const cfBatchSize = config.scanner.cloudflareBatchSize || 20;
    const cfDelay = (config.scanner.cloudflareDelay || 0) / 1000;

    // DNS: ~6ms each, divided by concurrency.
    const dnsEstSec = (total * 0.006) / Math.max(1, dnsConcurrency / 10);

    // Assume ~60% of these short domains resolve (already registered) and are
    // filtered out; the rest hit Cloudflare. Each batch ~0.5s + configured delay.
    const candidateRatio = 0.4;
    const candidates = Math.ceil(total * candidateRatio);
    const cfBatches = Math.ceil(candidates / cfBatchSize);
    const cfEstSec = (cfBatches * (0.5 + cfDelay)) / Math.max(1, cfConcurrency);

    const totalEstSec = dnsEstSec + cfEstSec;

    console.log('');
    console.log(`SLD ${minLen}-${maxLen} chars (${mode}), TLD length ${tldLength}`);
    console.log(`TLDs (${tlds.length}): ${tlds.join(', ')}`);
    console.log('');
    console.log('\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
    console.log('\u2502 Stage    \u2502 Count    \u2502 Est. Time    \u2502');
    console.log('\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524');
    console.log(`\u2502 DNS      \u2502 ${String(total).padStart(8)} \u2502 ${formatDuration(dnsEstSec).padStart(12)} \u2502`);
    console.log(`\u2502 CF check \u2502 ${String(candidates).padStart(8)} \u2502 ${formatDuration(cfEstSec).padStart(12)} \u2502`);
    console.log('\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524');
    console.log(`\u2502 Total    \u2502 ${String(total).padStart(8)} \u2502 ${formatDuration(totalEstSec).padStart(12)} \u2502`);
    console.log('\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');
    console.log('');
    console.log('(Estimates are rough; candidate ratio and CF rate limits vary.)');
}

main();
