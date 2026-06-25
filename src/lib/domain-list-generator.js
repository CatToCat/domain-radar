const CHARSETS = {
    alpha: 'abcdefghijklmnopqrstuvwxyz'.split(''),
    digits: '0123456789'.split(''),
    mixed: 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
};

function generateSLDs(maxLength, mode, options = {}) {
    const { minLength = 1 } = options;
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

function generateDomains(slds, tlds) {
    const domains = [];
    for (const sld of slds) {
        for (const tld of tlds) {
            domains.push({ domain: `${sld}.${tld}`, sld, tld });
        }
    }
    return domains;
}

// Keep only TLDs Cloudflare supports for programmatic registration (the
// 'supported' allowlist in tld-policy.json). Other TLDs cannot be
// authoritatively confirmed as registerable, so scanning them is pointless.
// Falls back to the legacy 'restricted' blocklist if no allowlist is present.
function filterTldsByPolicy(tlds, policy = {}) {
    if (Array.isArray(policy.supported) && policy.supported.length > 0) {
        const supported = new Set(policy.supported);
        const kept = tlds.filter(t => supported.has(t));
        const removed = tlds.filter(t => !supported.has(t));
        return { kept, removed };
    }
    const restricted = new Set(policy.restricted || []);
    const kept = tlds.filter(t => !restricted.has(t));
    const removed = tlds.filter(t => restricted.has(t));
    return { kept, removed };
}

module.exports = { generateSLDs, generateDomains, filterTldsByPolicy, CHARSETS };
