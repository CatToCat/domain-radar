const mockDomains = [
    { domain: 'aa.com', sld: 'aa', tld: 'com', mode: 'alpha' },
    { domain: 'ab.dev', sld: 'ab', tld: 'dev', mode: 'alpha' },
    { domain: '12.xyz', sld: '12', tld: 'xyz', mode: 'digits' },
    { domain: 'xyz.app', sld: 'xyz', tld: 'app', mode: 'alpha' },
    { domain: 'hi.net', sld: 'hi', tld: 'net', mode: 'alpha' },
    { domain: '99.org', sld: '99', tld: 'org', mode: 'digits' },
    { domain: 'test.run', sld: 'test', tld: 'run', mode: 'alpha' },
    { domain: 'zq.app', sld: 'zq', tld: 'app', mode: 'alpha' },
];

const mockResults = [
    // available (Cloudflare-confirmed registrable, standard tier) - SHOULD notify (len 5? aa.com=5) -> use len<=4 cases below
    { domain: 'aa.io', sld: 'aa', tld: 'io', sldLength: 2, tldLength: 2, mode: 'alpha', dnsExists: false, status: 'available', cloudflare: { tier: 'standard', reason: null }, pricing: { currency: 'USD', registration_cost: '8.57', renewal_cost: '8.57' }, whois: { registered: false, detail: 'Cloudflare: available (standard)' }, timestamp: '2026-06-22T07:00:01.000Z' },
    // available (no CF confirmation, RDAP only) - SHOULD notify
    { domain: 'ab.io', sld: 'ab', tld: 'io', sldLength: 2, tldLength: 2, mode: 'alpha', dnsExists: false, status: 'available', whois: { registered: false, detail: 'RDAP: not found (available)' }, timestamp: '2026-06-22T07:00:02.000Z' },
    // registered (DNS)
    { domain: '12.cn', sld: '12', tld: 'cn', sldLength: 2, tldLength: 2, mode: 'digits', dnsExists: true, status: 'registered', whois: null, timestamp: '2026-06-22T07:00:03.000Z' },
    // available but long - should NOT notify
    { domain: 'xyz.app', sld: 'xyz', tld: 'app', sldLength: 3, tldLength: 3, mode: 'alpha', dnsExists: false, status: 'available', cloudflare: { tier: 'standard', reason: null }, whois: { registered: false, detail: 'Cloudflare: available (standard)' }, timestamp: '2026-06-22T07:00:04.000Z' },
    // registered (RDAP)
    { domain: 'hi.de', sld: 'hi', tld: 'de', sldLength: 2, tldLength: 2, mode: 'alpha', dnsExists: false, status: 'registered', whois: { registered: true, detail: 'RDAP: registered' }, timestamp: '2026-06-22T07:00:05.000Z' },
    // premium (Cloudflare tier=premium) - registerable but premium, should NOT notify
    { domain: '99.ai', sld: '99', tld: 'ai', sldLength: 2, tldLength: 2, mode: 'digits', dnsExists: false, status: 'premium', cloudflare: { tier: 'premium', reason: 'domain_premium' }, whois: { registered: false, detail: 'Cloudflare: premium (premium)' }, timestamp: '2026-06-22T07:00:06.000Z' },
    // registered (DNS)
    { domain: 'test.org', sld: 'test', tld: 'org', sldLength: 4, tldLength: 3, mode: 'alpha', dnsExists: true, status: 'registered', whois: null, timestamp: '2026-06-22T07:00:07.000Z' },
    // reserved (Cloudflare domain_unavailable / not registrable) - should NOT notify
    { domain: 'zq.io', sld: 'zq', tld: 'io', sldLength: 2, tldLength: 2, mode: 'alpha', dnsExists: false, status: 'reserved', cloudflare: { tier: null, reason: 'domain_unavailable' }, whois: { registered: false, detail: 'Cloudflare: reserved' }, timestamp: '2026-06-22T07:00:08.000Z' },
    // unsupported TLD (CF cannot confirm) - should NOT notify
    { domain: 'qq.zz', sld: 'qq', tld: 'zz', sldLength: 2, tldLength: 2, mode: 'alpha', dnsExists: false, status: 'unsupported', cloudflare: { tier: null, reason: 'extension_not_supported' }, whois: { registered: false, detail: 'Cloudflare: unsupported' }, timestamp: '2026-06-22T07:00:09.000Z' },
];

module.exports = { mockDomains, mockResults };
