const CHARSETS = {
    alpha: 'abcdefghijklmnopqrstuvwxyz'.split(''),
    digits: '0123456789'.split(''),
    mixed: 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
};

// Generate every SLD combination for the given character set, for lengths in
// [minLength, maxLength]. Returned grouped is convenient for sharding by length.
function generateSLDs(minLength, maxLength, mode) {
    const chars = CHARSETS[mode] || CHARSETS.mixed;
    const results = [];
    const start = Math.max(1, minLength);
    for (let len = start; len <= maxLength; len++) {
        const total = Math.pow(chars.length, len);
        for (let i = 0; i < total; i++) {
            let combo = '';
            let num = i;
            for (let j = 0; j < len; j++) {
                combo = chars[num % chars.length] + combo;
                num = Math.floor(num / chars.length);
            }
            results.push(combo);
        }
    }
    return results;
}

// Generate SLDs for a single length only (used when sharding by length).
function generateSLDsOfLength(length, mode) {
    return generateSLDs(length, length, mode);
}

function generateDomains(slds, tlds) {
    const domains = [];
    for (const sld of slds) {
        for (const tld of tlds) {
            domains.push({ domain: `${sld}.${tld}`, sld, tld });
        }
    }
    return domains;
}

// Keep only TLDs that (a) Cloudflare supports for programmatic registration
// (the 'supported' allowlist in tld-policy.json) and (b) have exactly the
// configured character length. Only these can be authoritatively confirmed and
// registered via the Cloudflare domain-check / registrations API.
function filterTlds(tlds, policy = {}, tldLength = null) {
    const supported = Array.isArray(policy.supported) ? new Set(policy.supported) : null;
    const kept = [];
    const removed = [];
    for (const t of tlds) {
        const okPolicy = supported ? supported.has(t) : true;
        const okLength = tldLength == null ? true : t.length === tldLength;
        if (okPolicy && okLength) kept.push(t);
        else removed.push(t);
    }
    return { kept, removed };
}

module.exports = {
    generateSLDs,
    generateSLDsOfLength,
    generateDomains,
    filterTlds,
    CHARSETS
};
