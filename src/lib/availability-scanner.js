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
    const { dnsConcurrency = 50, rdapConcurrency = 20, whoisDelay = 2000, whoisRetries = 3, logger } = options;
    const results = [];

    // Stage 1: DNS bulk check
    logger?.info(`DNS check starting: ${domains.length} domains (concurrency: ${dnsConcurrency})`);

    const dnsResults = new Map();
    const executing = new Set();
    let dnsChecked = 0;

    for (const item of domains) {
        const p = (async () => {
            const exists = await checkDNS(item.domain);
            dnsResults.set(item.domain, exists);
            dnsChecked++;
            logger?.info(`DNS [${dnsChecked}/${domains.length}] ${item.domain} → ${exists ? 'EXISTS' : 'NOT FOUND'}`);
        })();

        executing.add(p);
        p.finally(() => executing.delete(p));

        if (executing.size >= dnsConcurrency) {
            await Promise.race(executing);
        }
    }
    await Promise.all(executing);

    const dnsExistsCount = [...dnsResults.values()].filter(Boolean).length;
    if (logger) {
        logger.info(`DNS check complete. Exists: ${dnsExistsCount}, Not found: ${domains.length - dnsExistsCount}`);
        logger.stats.dnsChecked = domains.length;
    }

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
    logger?.info(`RDAP check starting: ${needRdap.length} domains (concurrency: ${rdapConcurrency})`);

    const rdapResults = new Map();
    const rdapExecuting = new Set();
    let rdapChecked = 0;

    try {
        await loadRdapBootstrap();
    } catch (err) {
        logger?.info(`RDAP bootstrap failed: ${err.message}, skipping RDAP stage`);
    }

    for (const item of needRdap) {
        const p = (async () => {
            let result = null;
            try {
                result = await checkRDAP(item.domain, item.tld);
            } catch {}
            rdapResults.set(item.domain, result);
            rdapChecked++;
            const status = result === null ? 'NO DATA' : result.registered ? 'REGISTERED' : 'AVAILABLE';
            logger?.info(`RDAP [${rdapChecked}/${needRdap.length}] ${item.domain} → ${status}`);
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

    if (logger) {
        const rdapAvailable = rdapResolved.filter(r => !r.result.registered).length;
        const rdapRegistered = rdapResolved.filter(r => r.result.registered).length;
        logger.info(`RDAP complete. Resolved: ${rdapResolved.length} (available: ${rdapAvailable}, registered: ${rdapRegistered}), No data: ${needWhois.length}`);
        logger.stats.rdapChecked = needRdap.length;
    }

    // Stage 3: WHOIS for domains where RDAP returned no data
    logger?.info(`WHOIS check starting: ${needWhois.length} domains`);

    let whoisChecked = 0;
    let whoisSuccess = 0;
    let whoisFailed = 0;

    for (const item of needWhois) {
        let whoisResult = null;

        for (let attempt = 1; attempt <= whoisRetries; attempt++) {
            try {
                whoisResult = await checkWHOIS(item.domain);
                if (whoisResult !== null) {
                    whoisSuccess++;
                    break;
                }
            } catch (err) {
                if (attempt < whoisRetries) {
                    const backoff = attempt * 3000;
                    logger?.info(`WHOIS retry ${attempt}/${whoisRetries} for ${item.domain}: ${err.message}`);
                    await new Promise(r => setTimeout(r, backoff));
                }
            }
        }

        if (whoisResult === null) {
            whoisResult = { registered: false, detail: 'Not found in DNS/RDAP/WHOIS (available)' };
            whoisFailed++;
        }

        whoisChecked++;
        const status = whoisResult.registered === false ? 'AVAILABLE' : 'REGISTERED';
        logger?.info(`WHOIS [${whoisChecked}/${needWhois.length}] ${item.domain} → ${status}`);

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

        if (whoisChecked < needWhois.length) {
            await new Promise(r => setTimeout(r, whoisDelay));
        }
    }

    if (logger) {
        logger.stats.whoisChecked = whoisChecked;
        logger.stats.success = whoisSuccess;
        logger.stats.failed = whoisFailed;
        logger.stats.total = domains.length;
    }

    return results;
}

module.exports = { checkDNS, checkRDAP, checkWHOIS, runChecks };
