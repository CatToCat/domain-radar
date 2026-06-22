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
        whois: null
    }));
    await notify(allRegistered, { dryRun: true });

    console.log('\n[TEST] All tests passed.');
}

main().catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1);
});
