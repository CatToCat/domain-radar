const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_LISTED_DOMAINS = 500;
const ISSUE_LABEL = 'domain-alert';

function buildIssueBody(domains) {
    const total = domains.length;
    const listed = domains.slice(0, MAX_LISTED_DOMAINS);

    const lines = [
        '## Available Short Domains',
        '',
        `Found **${total}** registerable domain(s) via Cloudflare.`,
        '',
    ];

    if (total > MAX_LISTED_DOMAINS) {
        lines.push(`> Showing the first ${MAX_LISTED_DOMAINS} of ${total}. See domains.json for the full list.`, '');
    }

    lines.push(
        '| Domain | Price | Tier |',
        '|--------|-------|------|',
    );

    for (const d of listed) {
        const price = d.price != null ? `$${d.price}/yr` : '-';
        const tier = d.tier === 'premium' ? 'Premium' : 'Standard';
        lines.push(`| ${d.domain} | ${price} | ${tier} |`);
    }

    lines.push('', `Scan time: ${new Date().toISOString()}`);
    return lines.join('\n');
}

function runGhIssueCreate(args) {
    const result = spawnSync('gh', args, { stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`gh exited with code ${result.status}`);
}

async function notify(results, options = {}) {
    const { dryRun = false } = options;

    if (results.length === 0) {
        console.log('[Notify] No available domains to notify.');
        return;
    }

    console.log(`[Notify] Found ${results.length} available domain(s)!`);
    results.slice(0, 20).forEach(d => console.log(`  → ${d.domain} ($${d.price || '?'}/yr) [${d.tier || 'standard'}]`));
    if (results.length > 20) {
        console.log(`  ... and ${results.length - 20} more`);
    }

    const date = new Date().toISOString().split('T')[0];
    const title = `${results.length} domain(s) available (${date})`;
    const body = buildIssueBody(results);

    if (dryRun) {
        console.log(`[Notify] [DRY-RUN] Would create issue: "${title}"`);
        console.log(`[Notify] [DRY-RUN] Body:\n${body}`);
        return;
    }

    const bodyFile = path.join(os.tmpdir(), `domain-radar-issue-${Date.now()}.md`);

    try {
        fs.writeFileSync(bodyFile, body, 'utf8');

        const requiredArgs = ['issue', 'create', '--title', title, '--body-file', bodyFile];
        const assignee = process.env.ISSUE_ASSIGNEE || '@me';
        const optionalArgs = ['--label', ISSUE_LABEL];
        if (assignee) optionalArgs.push('--assignee', assignee);

        try {
            runGhIssueCreate([...requiredArgs, ...optionalArgs]);
        } catch (optErr) {
            console.warn(`[Notify] Issue create with label/assignee failed (${optErr.message}). Retrying without them...`);
            runGhIssueCreate(requiredArgs);
        }

        console.log('[Notify] GitHub Issue created successfully.');
    } catch (err) {
        console.error('[Notify] Failed to create GitHub Issue:', err.message);
    } finally {
        try { fs.unlinkSync(bodyFile); } catch {}
    }
}

module.exports = { notify, buildIssueBody };
