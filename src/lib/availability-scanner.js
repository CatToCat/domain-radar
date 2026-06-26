const dns = require('dns').promises;

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

// ---------------------------------------------------------------------------
// Two-stage availability detection:
//
//   Stage 1 (DNS pre-filter): if a domain resolves (NS or A), it is registered
//     and in use — skip it. This cheaply eliminates the bulk of taken short
//     domains before spending Cloudflare API quota.
//
//   Stage 2 (Cloudflare domain-check): an authoritative, real-time registry
//     check. Only this can distinguish freely-registerable from
//     reserved/premium/taken. Restricted to TLDs Cloudflare supports for
//     programmatic registration (see data/tld-policy.json).
//
// Only domains Cloudflare confirms as registrable at standard tier are kept.
// ---------------------------------------------------------------------------

// Check up to 20 domains in one Cloudflare domain-check call.
// Returns Map<domain, { registrable, tier, reason, pricing }>.
async function checkCloudflareBatch(domains, { accountId, apiToken }) {
    const url = `${CF_API_BASE}/accounts/${accountId}/registrar/domain-check`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ domains }),
        signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
        const err = new Error(`Cloudflare HTTP ${res.status}`);
        err.statusCode = res.status;
        try { err.body = await res.text(); } catch {}
        throw err;
    }
    const data = await res.json();
    if (!data.success || !data.result || !Array.isArray(data.result.domains)) {
        const err = new Error('Cloudflare domain-check returned unexpected payload');
        err.body = JSON.stringify(data).slice(0, 300);
        throw err;
    }
    const out = new Map();
    for (const entry of data.result.domains) {
        out.set(entry.name, {
            registrable: entry.registrable === true,
            tier: entry.tier || null,
            reason: entry.reason || null,
            pricing: entry.pricing || null
        });
    }
    return out;
}

// Returns true if the domain resolves (NS or A) => already registered/in use.
async function checkDNS(domain) {
    try {
        await dns.resolve(domain, 'NS');
        return true;
    } catch {
        try {
            await dns.resolve(domain, 'A');
            return true;
        } catch {
            return false;
        }
    }
}

// Run DNS pre-filter over `domains`, returning those that did NOT resolve
// (candidates that may be available). Runs with bounded concurrency.
async function dnsPrefilter(domains, { dnsConcurrency = 50, onProgress } = {}) {
    const candidates = [];
    const executing = new Set();
    let checked = 0;
    let resolved = 0;

    for (const item of domains) {
        const p = (async () => {
            const exists = await checkDNS(item.domain);
            checked++;
            if (exists) {
                resolved++;
            } else {
                candidates.push(item);
            }
            if (onProgress) onProgress({ checked, total: domains.length, resolved });
        })();
        executing.add(p);
        p.finally(() => executing.delete(p));
        if (executing.size >= dnsConcurrency) {
            await Promise.race(executing);
        }
    }
    await Promise.all(executing);
    return { candidates, resolved };
}

// Confirm candidate domains via Cloudflare domain-check. Returns an array of
// AVAILABLE records only: { domain, sld, tld, sldLength, tldLength, price, currency }.
async function cloudflareConfirm(candidates, options = {}) {
    const {
        accountId,
        apiToken,
        cloudflareBatchSize = 20,
        cloudflareConcurrency = 3,
        cloudflareDelay = 0,
        onProgress
    } = options;

    const byDomain = new Map(candidates.map(c => [c.domain, c]));
    const available = [];

    const batches = [];
    for (let i = 0; i < candidates.length; i += cloudflareBatchSize) {
        batches.push(candidates.slice(i, i + cloudflareBatchSize).map(c => c.domain));
    }

    let batchesDone = 0;
    let errors = 0;
    let aborted = false;
    const executing = new Set();

    for (const batch of batches) {
        if (aborted) break;
        const p = (async () => {
            let resultMap = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    resultMap = await checkCloudflareBatch(batch, { accountId, apiToken });
                    break;
                } catch (err) {
                    if (err.statusCode === 401 || err.statusCode === 403) {
                        console.error(`[Cloudflare] Auth error (HTTP ${err.statusCode}). Aborting. ${err.body || ''}`);
                        aborted = true;
                        return;
                    }
                    if (err.statusCode === 429 && attempt < 3) {
                        await new Promise(r => setTimeout(r, attempt * 2000));
                        continue;
                    }
                    if (attempt >= 3) { errors += batch.length; return; }
                    await new Promise(r => setTimeout(r, attempt * 1000));
                }
            }
            if (!resultMap) return;

            batchesDone++;
            for (const domain of batch) {
                const cf = resultMap.get(domain);
                const item = byDomain.get(domain);
                if (!cf || !item) continue;
                // Keep only standard-tier registerable domains.
                if (cf.registrable && cf.tier !== 'premium') {
                    available.push({
                        domain: item.domain,
                        sld: item.sld,
                        tld: item.tld,
                        sldLength: item.sld.length,
                        tldLength: item.tld.length,
                        price: cf.pricing ? cf.pricing.registration_cost : null,
                        currency: cf.pricing ? cf.pricing.currency : null
                    });
                }
            }
            if (onProgress) onProgress({ batchesDone, totalBatches: batches.length, available: available.length });
        })();

        executing.add(p);
        p.finally(() => executing.delete(p));
        if (executing.size >= cloudflareConcurrency) {
            await Promise.race(executing);
        }
        if (cloudflareDelay > 0) {
            await new Promise(r => setTimeout(r, cloudflareDelay));
        }
    }
    await Promise.all(executing);

    return { available, errors, aborted };
}

// Full scan over a domain list: DNS pre-filter then Cloudflare confirmation.
// Returns { available, stats }. Requires Cloudflare credentials.
async function runChecks(domains, options = {}) {
    const accountId = options.cloudflareAccountId || process.env.CLOUDFLARE_ACCOUNT_ID || null;
    const apiToken = options.cloudflareApiToken || process.env.CLOUDFLARE_API_TOKEN || null;

    if (!accountId || !apiToken) {
        throw new Error('Cloudflare credentials required: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
    }

    console.log(`[DNS] Pre-filtering ${domains.length} domains (concurrency ${options.dnsConcurrency || 50})`);
    const { candidates, resolved } = await dnsPrefilter(domains, {
        dnsConcurrency: options.dnsConcurrency || 50,
        onProgress: ({ checked, total, resolved }) => {
            if (checked % 500 === 0 || checked === total) {
                console.log(`[DNS] ${checked}/${total} (resolved/registered: ${resolved})`);
            }
        }
    });
    console.log(`[DNS] Done. Registered (resolved): ${resolved}, Candidates (unresolved): ${candidates.length}`);

    console.log(`[Cloudflare] Confirming ${candidates.length} candidates (batch ${options.cloudflareBatchSize || 20}, concurrency ${options.cloudflareConcurrency || 3})`);
    const { available, errors, aborted } = await cloudflareConfirm(candidates, {
        accountId,
        apiToken,
        cloudflareBatchSize: options.cloudflareBatchSize || 20,
        cloudflareConcurrency: options.cloudflareConcurrency || 3,
        cloudflareDelay: options.cloudflareDelay != null ? options.cloudflareDelay : 0,
        onProgress: ({ batchesDone, totalBatches, available }) => {
            if (batchesDone % 20 === 0 || batchesDone === totalBatches) {
                console.log(`[Cloudflare] ${batchesDone}/${totalBatches} batches (available so far: ${available})`);
            }
        }
    });
    console.log(`[Cloudflare] Done. Available: ${available.length}, Errors: ${errors}${aborted ? ' (aborted on auth error)' : ''}`);

    return {
        available,
        stats: {
            total: domains.length,
            registered: resolved,
            candidates: candidates.length,
            available: available.length,
            errors,
            aborted
        }
    };
}

module.exports = {
    checkDNS,
    checkCloudflareBatch,
    dnsPrefilter,
    cloudflareConfirm,
    runChecks
};
