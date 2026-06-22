const mockDomains = [
    { domain: 'a.ai', sld: 'a', tld: 'ai', mode: 'alpha' },
    { domain: 'ab.io', sld: 'ab', tld: 'io', mode: 'alpha' },
    { domain: '1.cn', sld: '1', tld: 'cn', mode: 'digits' },
    { domain: 'xyz.com', sld: 'xyz', tld: 'com', mode: 'alpha' },
    { domain: 'hi.de', sld: 'hi', tld: 'de', mode: 'alpha' },
    { domain: '99.ai', sld: '99', tld: 'ai', mode: 'digits' },
    { domain: 'test.org', sld: 'test', tld: 'org', mode: 'alpha' },
    { domain: 'z.io', sld: 'z', tld: 'io', mode: 'alpha' },
];

const mockResults = [
    // available (RDAP not found)
    { domain: 'a.ai', sld: 'a', tld: 'ai', sldLength: 1, tldLength: 2, mode: 'alpha', dnsExists: false, whois: { registered: false, detail: 'RDAP: not found (available)' }, timestamp: '2026-06-22T07:00:01.000Z' },
    // available (not found in all 3 stages)
    { domain: 'ab.io', sld: 'ab', tld: 'io', sldLength: 2, tldLength: 2, mode: 'alpha', dnsExists: false, whois: { registered: false, detail: 'Not found in DNS/RDAP/WHOIS (available)' }, timestamp: '2026-06-22T07:00:02.000Z' },
    // registered (DNS)
    { domain: '1.cn', sld: '1', tld: 'cn', sldLength: 1, tldLength: 2, mode: 'digits', dnsExists: true, whois: null, timestamp: '2026-06-22T07:00:03.000Z' },
    // available (RDAP not found, long - should NOT trigger notify)
    { domain: 'xyz.com', sld: 'xyz', tld: 'com', sldLength: 3, tldLength: 3, mode: 'alpha', dnsExists: false, whois: { registered: false, detail: 'RDAP: not found (available)' }, timestamp: '2026-06-22T07:00:04.000Z' },
    // registered (RDAP)
    { domain: 'hi.de', sld: 'hi', tld: 'de', sldLength: 2, tldLength: 2, mode: 'alpha', dnsExists: false, whois: { registered: true, detail: 'RDAP: registered' }, timestamp: '2026-06-22T07:00:05.000Z' },
    // available (RDAP not found)
    { domain: '99.ai', sld: '99', tld: 'ai', sldLength: 2, tldLength: 2, mode: 'digits', dnsExists: false, whois: { registered: false, detail: 'RDAP: not found (available)' }, timestamp: '2026-06-22T07:00:06.000Z' },
    // registered (DNS)
    { domain: 'test.org', sld: 'test', tld: 'org', sldLength: 4, tldLength: 3, mode: 'alpha', dnsExists: true, whois: null, timestamp: '2026-06-22T07:00:07.000Z' },
    // error
    { domain: 'z.io', sld: 'z', tld: 'io', sldLength: 1, tldLength: 2, mode: 'alpha', dnsExists: false, whois: { registered: null, detail: 'WHOIS error: timeout' }, timestamp: '2026-06-22T07:00:08.000Z' },
];

module.exports = { mockDomains, mockResults };
