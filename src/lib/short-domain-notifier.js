const { execSync } = require('child_process');

const MAX_TOTAL_LENGTH = 4;

function filterShortDomains(results) {
    return results.filter(r =>
        !r.dnsExists &&
        r.whois &&
        r.whois.registered === false &&
        (r.sldLength + r.tldLength) <= MAX_TOTAL_LENGTH
    );
}

function buildIssueBody(domains) {
    const lines = [
        '## Available Short Domains',
        '',
        '| Domain | SLD | TLD | Total Length |',
        '|--------|-----|-----|-------------|',
    ];

    for (const d of domains) {
        lines.push(`| ${d.domain} | ${d.sld} | ${d.tld} | ${d.sldLength + d.tldLength} |`);
    }

    lines.push('', `Scan time: ${new Date().toISOString()}`);
    return lines.join('\n');
}

async function notify(results, options = {}) {
    const { dryRun = false } = options;
    const shortDomains = filterShortDomains(results);

    if (shortDomains.length === 0) {
        console.log('[Notify] No short domains (<=4 chars) available.');
        return;
    }

    console.log(`[Notify] Found ${shortDomains.length} short domain(s) available!`);
    shortDomains.forEach(d => console.log(`  → ${d.domain}`));

    const date = new Date().toISOString().split('T')[0];
    const title = `${shortDomains.length} short domain(s) available (${date})`;
    const body = buildIssueBody(shortDomains);

    if (dryRun) {
        console.log(`[Notify] [DRY-RUN] Would create issue: "${title}"`);
        console.log(`[Notify] [DRY-RUN] Body:\n${body}`);
        return;
    }

    try {
        execSync(
            `gh issue create --title "${title}" --body "${body.replace(/"/g, '\\"')}" --label "domain-alert"`,
            { stdio: 'inherit' }
        );
        console.log('[Notify] GitHub Issue created successfully.');
    } catch (err) {
        console.error('[Notify] Failed to create GitHub Issue:', err.message);
    }
}

module.exports = { notify, filterShortDomains };
