const CHARSETS = {
    alpha: 'abcdefghijklmnopqrstuvwxyz'.split(''),
    digits: '0123456789'.split(''),
    mixed: 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
};

function generateSLDs(maxLength, mode) {
    const chars = CHARSETS[mode] || CHARSETS.mixed;
    const results = [];

    for (let len = 1; len <= maxLength; len++) {
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

module.exports = { generateSLDs, generateDomains, CHARSETS };
