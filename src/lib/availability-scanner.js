const dns = require('dns').promises;
const whoiser = require('whoiser');

const RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
let rdapServers = null;

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

async function runChecks(domains, options = {}) {
    const { dnsConcurrency = 50, rdapConcurrency = 20, whoisDelay = 2000, whoisRetries = 3, tldCache = {} } = options;
    const results = [];

    const rdapUnsupported = new Set(tldCache.rdapUnsupported || []);
    const whoisUnsupported = new Set(tldCache.whoisUnsupported || []);

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

    return results;
}

module.exports = { checkDNS, checkRDAP, checkWHOIS, runChecks };
