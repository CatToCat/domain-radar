const dns = require('dns').promises;
const whoiser = require('whoiser');

const RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const CF_API_BASE = 'https://api.cloudflare.com/client/v4';
let rdapServers = null;

// ---------------------------------------------------------------------------
// Cloudflare Registrar domain-check confirmation (Stage 4).
//
// RDAP/WHOIS can only tell us whether a domain is *in the registry*. They
// cannot distinguish "registry-reserved" or "premium" from "freely
// registerable". Cloudflare's domain-check endpoint performs an authoritative,
// real-time registry check and returns `registrable`, `tier` (standard|premium)
// and a `reason` when not registrable - exactly the signal we need.
//
// Only TLDs Cloudflare supports for programmatic registration can be
// authoritatively checked; scanning is restricted to those (see tld-policy.json).
//
// Status summary values used throughout the pipeline:
//   'registered'  - taken / unavailable
//   'available'   - registerable at standard price (Cloudflare confirmed)
//   'premium'     - registerable but premium-priced
//   'reserved'    - registry-reserved / blocked
//   'unsupported' - TLD not checkable via Cloudflare
//   'unknown'     - could not determine
// ---------------------------------------------------------------------------

// Map a single Cloudflare domain-check result object to our summary status.
function classifyCloudflareCheck(entry) {
    if (!entry || typeof entry !== 'object') return 'unknown';
    if (entry.registrable === true) {
        return entry.tier === 'premium' ? 'premium' : 'available';
    }
    // registrable === false: use the reason to classify.
    switch (entry.reason) {
        case 'domain_premium':
            return 'premium';
        case 'domain_unavailable':
            return 'registered';
        case 'extension_not_supported':
        case 'extension_not_supported_via_api':
        case 'extension_disallows_registration':
            return 'unsupported';
        default:
            return entry.tier === 'premium' ? 'premium' : 'unknown';
    }
}

// Check up to `cloudflareBatchSize` domains in one Cloudflare domain-check call.
// Returns a Map<domain, {status, pricing}> for the domains in the batch.
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
            status: classifyCloudflareCheck(entry),
            tier: entry.tier || null,
            pricing: entry.pricing || null,
            reason: entry.reason || null
        });
    }
    return out;
}

async function loadRdapBootstrap() {
    if (rdapServers) return rdapServers;
    const res = await fetch(RDAP_BOOTSTRAP_URL);
    if (!res.ok) throw new Error(`Failed to fetch RDAP bootstrap: ${res.status}`);
    const data = await res.json();
    rdapServers = new Map();
    for (const [tlds, urls] of data.services) {
        const baseUrl = urls[0];
        for (const tld of tlds) {
            rdapServers.set(tld.toLowerCase(), baseUrl);
        }
    }
    return rdapServers;
}

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

async function checkRDAP(domain, tld) {
    const servers = await loadRdapBootstrap();
    const baseUrl = servers.get(tld);
    if (!baseUrl) return null;

    const url = `${baseUrl}domain/${domain}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (res.status === 404) {
        return { registered: false, detail: 'RDAP: not found (available)' };
    }

    if (!res.ok) return null;

    const data = await res.json();

    if (data.errorCode === 404 || data.errorCode === 400) {
        return { registered: false, detail: 'RDAP: not found (available)' };
    }

    if (data.ldhName || data.handle || data.events) {
        return { registered: true, detail: 'RDAP: registered' };
    }

    return null;
}

async function checkWHOIS(domain) {
    const whoisData = await whoiser.domain(domain);
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

    const notFoundPatterns = [
        'DOMAIN NOT FOUND', 'NO MATCH FOR', 'NO ENTRIES FOUND',
        'NOT FOUND', 'NO OBJECT FOUND', 'NOT REGISTERED', 'NO DATA FOUND'
    ];

    if (notFoundPatterns.some(p => upper.includes(p))) {
        return { registered: false, detail: 'WHOIS: not found (available)' };
    }

    const registeredPatterns = [
        'REGISTRAR', 'CREATION DATE', 'REGISTRY DOMAIN ID',
        'EXPIRY DATE', 'UPDATED DATE', 'NAME SERVER:'
    ];

    if (registeredPatterns.some(p => upper.includes(p))) {
        return { registered: true, detail: 'WHOIS: registered' };
    }

    return null;
}

// Compute a preliminary status from DNS/RDAP/WHOIS results, before Cloudflare
// confirmation. premiumHeavy is a Set of TLDs whose short SLDs are commonly
// premium-priced; for those we mark unregistered domains as 'premium' rather
// than 'available' so they are not over-promised when Cloudflare is unavailable.
function derivePreliminaryStatus(record, premiumHeavy = new Set()) {
    if (record.dnsExists) return 'registered';
    const w = record.whois;
    if (!w) return 'unknown';
    if (w.registered === true) return 'registered';
    if (w.registered === null) return 'unknown';
    if (w.registered === false) {
        return premiumHeavy.has(record.tld) ? 'premium' : 'available';
    }
    return 'unknown';
}

async function runChecks(domains, options = {}) {
    const { dnsConcurrency = 50, rdapConcurrency = 20, whoisDelay = 2000, whoisRetries = 3, tldCache = {} } = options;
    const results = [];

    const rdapUnsupported = new Set(tldCache.rdapUnsupported || []);
    const whoisUnsupported = new Set(tldCache.whoisUnsupported || []);

    // Cloudflare domain-check (Stage 4) options.
    const cfAccountId = options.cloudflareAccountId || process.env.CLOUDFLARE_ACCOUNT_ID || null;
    const cfApiToken = options.cloudflareApiToken || process.env.CLOUDFLARE_API_TOKEN || null;
    const cfBatchSize = options.cloudflareBatchSize || 20;
    const cfConcurrency = options.cloudflareConcurrency || 3;
    const cfDelay = options.cloudflareDelay != null ? options.cloudflareDelay : 0;
    const premiumHeavySet = new Set(options.premiumHeavy || []);

    // Stage 1: DNS bulk check
    console.log(`[DNS] Starting: ${domains.length} domains (concurrency: ${dnsConcurrency})`);

    const dnsResults = new Map();
    const executing = new Set();
    let dnsChecked = 0;

    for (const item of domains) {
        const p = (async () => {
            const exists = await checkDNS(item.domain);
            dnsResults.set(item.domain, exists);
            dnsChecked++;
            console.log(`[DNS] [${dnsChecked}/${domains.length}] ${item.domain} → ${exists ? 'EXISTS' : 'NOT FOUND'}`);
        })();

        executing.add(p);
        p.finally(() => executing.delete(p));

        if (executing.size >= dnsConcurrency) {
            await Promise.race(executing);
        }
    }
    await Promise.all(executing);

    const dnsExistsCount = [...dnsResults.values()].filter(Boolean).length;
    console.log(`[DNS] Complete. Exists: ${dnsExistsCount}, Not found: ${domains.length - dnsExistsCount}`);

    // Add DNS-exists domains to results
    for (const item of domains) {
        if (dnsResults.get(item.domain)) {
            results.push({
                domain: item.domain,
                sld: item.sld,
                tld: item.tld,
                sldLength: item.sld.length,
                tldLength: item.tld.length,
                mode: item.mode || 'mixed',
                dnsExists: true,
                whois: null,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Stage 2: RDAP for domains where DNS returned false
    const needRdap = domains.filter(d => !dnsResults.get(d.domain));
    const rdapSkipCount = needRdap.filter(d => rdapUnsupported.has(d.tld)).length;
    console.log(`[RDAP] Starting: ${needRdap.length} domains (skip: ${rdapSkipCount}, check: ${needRdap.length - rdapSkipCount}, concurrency: ${rdapConcurrency})`);

    const rdapResults = new Map();
    const rdapExecuting = new Set();
    let rdapChecked = 0;

    try {
        await loadRdapBootstrap();
    } catch (err) {
        console.log(`[RDAP] Bootstrap failed: ${err.message}, skipping RDAP stage`);
    }

    for (const item of needRdap) {
        if (rdapUnsupported.has(item.tld)) {
            rdapResults.set(item.domain, null);
            rdapChecked++;
            continue;
        }

        const p = (async () => {
            let result = null;
            try {
                result = await checkRDAP(item.domain, item.tld);
            } catch {}
            rdapResults.set(item.domain, result);
            rdapChecked++;
            const status = result === null ? 'NO DATA' : result.registered ? 'REGISTERED' : 'AVAILABLE';
            console.log(`[RDAP] [${rdapChecked}/${needRdap.length}] ${item.domain} → ${status}`);
        })();

        rdapExecuting.add(p);
        p.finally(() => rdapExecuting.delete(p));

        if (rdapExecuting.size >= rdapConcurrency) {
            await Promise.race(rdapExecuting);
        }
    }
    await Promise.all(rdapExecuting);

    // Process RDAP results
    const rdapResolved = [];
    const needWhois = [];

    for (const item of needRdap) {
        const rdapResult = rdapResults.get(item.domain);
        if (rdapResult !== null) {
            rdapResolved.push({ item, result: rdapResult });
        } else {
            needWhois.push(item);
        }
    }

    for (const { item, result } of rdapResolved) {
        results.push({
            domain: item.domain,
            sld: item.sld,
            tld: item.tld,
            sldLength: item.sld.length,
            tldLength: item.tld.length,
            mode: item.mode || 'mixed',
            dnsExists: false,
            whois: result,
            timestamp: new Date().toISOString()
        });
    }

    const rdapAvailable = rdapResolved.filter(r => !r.result.registered).length;
    const rdapRegistered = rdapResolved.filter(r => r.result.registered).length;
    console.log(`[RDAP] Complete. Resolved: ${rdapResolved.length} (available: ${rdapAvailable}, registered: ${rdapRegistered}), No data: ${needWhois.length}`);

    // Stage 3: WHOIS for domains where RDAP returned no data (per-TLD concurrency)
    const whoisSkipCount = needWhois.filter(d => whoisUnsupported.has(d.tld)).length;
    const whoisConcurrency = options.whoisConcurrency || 10;
    console.log(`[WHOIS] Starting: ${needWhois.length} domains (skip: ${whoisSkipCount}, check: ${needWhois.length - whoisSkipCount}, TLD concurrency: ${whoisConcurrency})`);

    let whoisChecked = 0;
    let whoisSuccess = 0;
    let whoisFailed = 0;

    // Handle unsupported TLDs immediately
    for (const item of needWhois) {
        if (whoisUnsupported.has(item.tld)) {
            results.push({
                domain: item.domain,
                sld: item.sld,
                tld: item.tld,
                sldLength: item.sld.length,
                tldLength: item.tld.length,
                mode: item.mode || 'mixed',
                dnsExists: false,
                whois: { registered: null, detail: 'WHOIS: TLD not supported' },
                timestamp: new Date().toISOString()
            });
        }
    }

    // Group remaining domains by TLD
    const tldGroups = new Map();
    for (const item of needWhois) {
        if (whoisUnsupported.has(item.tld)) continue;
        if (!tldGroups.has(item.tld)) tldGroups.set(item.tld, []);
        tldGroups.get(item.tld).push(item);
    }

    // Process each TLD group as a sequential queue, run groups concurrently
    async function processTldGroup(items) {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            let whoisResult = null;
            let tldNotSupported = false;

            for (let attempt = 1; attempt <= whoisRetries; attempt++) {
                try {
                    whoisResult = await checkWHOIS(item.domain);
                    if (whoisResult !== null) {
                        whoisSuccess++;
                        break;
                    }
                } catch (err) {
                    if (err.message && err.message.includes('not supported')) {
                        tldNotSupported = true;
                        break;
                    }
                    if (attempt < whoisRetries) {
                        const backoff = attempt * 3000;
                        await new Promise(r => setTimeout(r, backoff));
                    }
                }
            }

            if (tldNotSupported) {
                whoisResult = { registered: null, detail: 'WHOIS: TLD not supported' };
                whoisFailed++;
            } else if (whoisResult === null) {
                whoisResult = { registered: null, detail: 'WHOIS: check failed' };
                whoisFailed++;
            }

            whoisChecked++;
            const whoisTotal = needWhois.length - whoisSkipCount;
            const status = whoisResult.registered === null ? 'UNKNOWN' : whoisResult.registered === false ? 'AVAILABLE' : 'REGISTERED';
            console.log(`[WHOIS] [${whoisChecked}/${whoisTotal}] ${item.domain} → ${status}`);
            results.push({
                domain: item.domain,
                sld: item.sld,
                tld: item.tld,
                sldLength: item.sld.length,
                tldLength: item.tld.length,
                mode: item.mode || 'mixed',
                dnsExists: false,
                whois: whoisResult,
                timestamp: new Date().toISOString()
            });

            if (i < items.length - 1) {
                await new Promise(r => setTimeout(r, whoisDelay));
            }
        }
    }

    const groupEntries = [...tldGroups.values()];
    const activeGroups = new Set();

    for (const group of groupEntries) {
        const p = processTldGroup(group);
        activeGroups.add(p);
        p.finally(() => activeGroups.delete(p));

        if (activeGroups.size >= whoisConcurrency) {
            await Promise.race(activeGroups);
        }
    }
    await Promise.all(activeGroups);

    console.log(`[WHOIS] Complete. Checked: ${whoisChecked}, Success: ${whoisSuccess}, Failed: ${whoisFailed}`);

    // Derive a preliminary status for every record from DNS/RDAP/WHOIS.
    for (const r of results) {
        r.status = derivePreliminaryStatus(r, premiumHeavySet);
    }

    // Stage 4: Cloudflare domain-check confirmation.
    // Earlier stages can only say "not in registry". Cloudflare's domain-check
    // is an authoritative, real-time registry check that distinguishes
    // registerable / premium / unavailable. We confirm every record that
    // currently looks 'available'. Without CF credentials this stage is skipped
    // and 'available' keeps its (less reliable) RDAP/WHOIS meaning.
    if (cfAccountId && cfApiToken) {
        const needConfirm = results.filter(r => r.status === 'available');
        const byDomain = new Map(needConfirm.map(r => [r.domain, r]));

        // Build batches of up to cfBatchSize domains.
        const batches = [];
        for (let i = 0; i < needConfirm.length; i += cfBatchSize) {
            batches.push(needConfirm.slice(i, i + cfBatchSize).map(r => r.domain));
        }
        console.log(`[Cloudflare] Starting: confirming ${needConfirm.length} candidate available domains in ${batches.length} batches (size ${cfBatchSize}, concurrency ${cfConcurrency})`);

        let batchesDone = 0;
        let stillAvailable = 0;
        let downgraded = 0;
        let cfErrors = 0;
        let aborted = false;

        const cfExecuting = new Set();

        for (const batch of batches) {
            if (aborted) break;

            const p = (async () => {
                let resultMap = null;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        resultMap = await checkCloudflareBatch(batch, { accountId: cfAccountId, apiToken: cfApiToken });
                        break;
                    } catch (err) {
                        if (err.statusCode === 401 || err.statusCode === 403) {
                            // Auth failure is fatal for the whole stage.
                            console.error(`[Cloudflare] Auth error (HTTP ${err.statusCode}). Aborting confirmation. ${err.body || ''}`);
                            aborted = true;
                            return;
                        }
                        if (err.statusCode === 429 && attempt < 3) {
                            await new Promise(res => setTimeout(res, attempt * 2000));
                            continue;
                        }
                        if (attempt >= 3) {
                            cfErrors += batch.length;
                            return;
                        }
                        await new Promise(res => setTimeout(res, attempt * 1000));
                    }
                }
                if (!resultMap) return;

                batchesDone++;
                for (const domain of batch) {
                    const r = byDomain.get(domain);
                    const cf = resultMap.get(domain);
                    if (!r || !cf) continue;
                    r.status = cf.status;
                    r.cloudflare = { tier: cf.tier, reason: cf.reason };
                    if (cf.pricing) r.pricing = cf.pricing;
                    r.whois = { ...(r.whois || {}), detail: `Cloudflare: ${cf.status}${cf.tier ? ' (' + cf.tier + ')' : ''}` };
                    if (cf.status === 'available') stillAvailable++;
                    else downgraded++;
                }
                console.log(`[Cloudflare] [${batchesDone}/${batches.length}] batch of ${batch.length} confirmed`);
            })();

            cfExecuting.add(p);
            p.finally(() => cfExecuting.delete(p));

            if (cfExecuting.size >= cfConcurrency) {
                await Promise.race(cfExecuting);
            }
            if (cfDelay > 0) {
                await new Promise(res => setTimeout(res, cfDelay));
            }
        }
        await Promise.all(cfExecuting);

        if (aborted) {
            console.log('[Cloudflare] Stopped early due to auth error; remaining domains keep preliminary status.');
        }
        console.log(`[Cloudflare] Complete. Confirmed available: ${stillAvailable}, Downgraded (premium/registered/reserved): ${downgraded}, Errors: ${cfErrors}`);
    } else {
        console.log('[Cloudflare] Skipped (set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to enable). "available" reflects RDAP/WHOIS only and may include reserved/premium domains.');
    }

    return results;
}

module.exports = { checkDNS, checkRDAP, checkWHOIS, checkCloudflareBatch, classifyCloudflareCheck, derivePreliminaryStatus, runChecks };
