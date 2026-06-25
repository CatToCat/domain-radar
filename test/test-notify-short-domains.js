const { mockResults } = require('./mock-data');
const { notify } = require('../src/lib/short-domain-notifier');

async function main() {
    console.log(`[TEST] Running notify-short-domains with ${mockResults.length} mock results\n`);

    console.log('--- Test 1: with available short domains (dry-run) ---\n');
    await notify(mockResults, { dryRun: true });

    console.log('\n--- Test 2: no available short domains ---\n');
    const allRegistered = mockResults.map(r => ({
        ...r,
        dnsExists: true,
        status: 'registered',
        whois: null
    }));
    await notify(allRegistered, { dryRun: true });

    console.log('\n--- Test 3: assert only truly-available short domains are selected ---\n');
    const { filterShortDomains } = require('../src/lib/short-domain-notifier');
    const selected = filterShortDomains(mockResults).map(d => d.domain).sort();
    const expected = ['aa.io', 'ab.io'].sort();
    const ok = JSON.stringify(selected) === JSON.stringify(expected);
    console.log(`Selected: ${JSON.stringify(selected)}`);
    console.log(`Expected: ${JSON.stringify(expected)}`);
    if (!ok) {
        throw new Error('filterShortDomains selected the wrong domains (premium/reserved/long should be excluded)');
    }
    console.log('PASS: premium (99.ai), reserved (zq.io), unsupported (qq.zz), and long (xyz.app) correctly excluded.');

    console.log('\n[TEST] All tests passed.');
}

main().catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1);
});
