const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_TOTAL_LENGTH = 4;
// Cap how many domains are listed in the issue body to keep it readable and
// well within GitHub's body size limits (~65k chars). The full count is always
// reported in the title/summary.
const MAX_LISTED_DOMAINS = 500;

function filterShortDomains(results) {
    return results.filter(r =>
        !r.dnsExists &&
        r.whois &&
        r.whois.registered === false &&
        (r.sldLength + r.tldLength) <= MAX_TOTAL_LENGTH
    );
}

function buildIssueBody(domains) {
    const total = domains.length;
    const listed = domains.slice(0, MAX_LISTED_DOMAINS);

    const lines = [
        '## Available Short Domains',
        '',
        `Found **${total}** available domain(s) with total length <= ${MAX_TOTAL_LENGTH}.`,
        '',
    ];

    if (total > MAX_LISTED_DOMAINS) {
        lines.push(`> Showing the first ${MAX_LISTED_DOMAINS} of ${total}. See the scan results JSON for the full list.`, '');
    }

    lines.push(
        '| Domain | SLD | TLD | Total Length |',
        '|--------|-----|-----|-------------|',
    );

    for (const d of listed) {
        lines.push(`| ${d.domain} | ${d.sld} | ${d.tld} | ${d.sldLength + d.tldLength} |`);
    }

    lines.push('', `Scan time: ${new Date().toISOString()}`);
    return lines.join('\n');
}

async function notify(results, options = {}) {
    const { dryRun = false } = options;
    const shortDomains = filterShortDomains(results);

    if (shortDomains.length === 0) {
        console.log(`[Notify] No short domains (<=${MAX_TOTAL_LENGTH} chars) available.`);
        return;
    }

    console.log(`[Notify] Found ${shortDomains.length} short domain(s) available!`);
    shortDomains.slice(0, 20).forEach(d => console.log(`  → ${d.domain}`));
    if (shortDomains.length > 20) {
        console.log(`  ... and ${shortDomains.length - 20} more`);
    }

    const date = new Date().toISOString().split('T')[0];
    const title = `${shortDomains.length} short domain(s) available (${date})`;
    const body = buildIssueBody(shortDomains);

    if (dryRun) {
        console.log(`[Notify] [DRY-RUN] Would create issue: "${title}"`);
        console.log(`[Notify] [DRY-RUN] Body:\n${body}`);
        return;
    }

    // Write the body to a temp file and pass it via --body-file. This avoids
    // shell escaping issues and the OS argument-length limit that breaks
    // `gh issue create --body "<huge string>"`.
    const bodyFile = path.join(os.tmpdir(), `domain-radar-issue-${Date.now()}.md`);

    try {
        fs.writeFileSync(bodyFile, body, 'utf8');

        const result = spawnSync(
            'gh',
            [
                'issue', 'create',
                '--title', title,
                '--body-file', bodyFile,
                '--label', 'domain-alert',
            ],
            { stdio: 'inherit', shell: false }
        );

        if (result.error) {
            throw result.error;
        }
        if (result.status !== 0) {
            throw new Error(`gh exited with code ${result.status}`);
        }

        console.log('[Notify] GitHub Issue created successfully.');
    } catch (err) {
        console.error('[Notify] Failed to create GitHub Issue:', err.message);
    } finally {
        try {
            fs.unlinkSync(bodyFile);
        } catch {}
    }
}

module.exports = { notify, filterShortDomains, buildIssueBody, MAX_TOTAL_LENGTH, MAX_LISTED_DOMAINS };
