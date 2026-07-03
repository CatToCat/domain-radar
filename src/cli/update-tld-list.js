const fs = require('fs');
const path = require('path');

const TLD_POLICY_PATH = path.join(__dirname, '..', '..', 'data', 'cloudflare-tlds.json');
const CF_TLD_URL = 'https://www.cloudflare.com/tld-policies/';

async function fetchSupportedTlds() {
    const res = await fetch(CF_TLD_URL, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${CF_TLD_URL}`);
    const html = await res.text();

    // Extract TLDs from the page. The page lists them as table rows or list items.
    // Match patterns like ".com", ".xyz", ".ai" etc in the HTML content.
    const tldSet = new Set();
    const patterns = [
        // Table cells or list items containing a TLD (without subdomain dots like .co.uk)
        /(?:>|^|\s)\.?([a-z]{2,})\s*<\/(?:td|li|span|a|p)/gi,
        // Links with TLD text
        /data-tld="([a-z]+)"/gi,
        // Common pattern: standalone TLD in a cell
        /<td[^>]*>\s*\.?([a-z]{2,63})\s*<\/td>/gi
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
            const tld = match[1].toLowerCase();
            if (tld.length >= 2 && tld.length <= 63 && !tld.includes('.')) {
                tldSet.add(tld);
            }
        }
    }

    // Fallback: also try a broader extraction looking for TLD-like strings in structured content
    const broadPattern = /["'>]\s*\.?([a-z]{2,20})\s*[<"']/g;
    let match;
    while ((match = broadPattern.exec(html)) !== null) {
        const candidate = match[1].toLowerCase();
        // Filter out common HTML/CSS words
        const skipWords = new Set([
            'html', 'head', 'body', 'div', 'span', 'class', 'style', 'href', 'http',
            'https', 'type', 'text', 'none', 'auto', 'true', 'false', 'null', 'width',
            'height', 'color', 'font', 'size', 'left', 'right', 'top', 'bottom',
            'center', 'block', 'flex', 'grid', 'inline', 'hidden', 'visible',
            'solid', 'border', 'margin', 'padding', 'content', 'normal', 'bold',
            'italic', 'relative', 'absolute', 'fixed', 'static', 'inherit'
        ]);
        if (!skipWords.has(candidate) && candidate.length >= 2) {
            tldSet.add(candidate);
        }
    }

    return [...tldSet].sort();
}

async function main() {
    console.log(`Fetching TLD list from ${CF_TLD_URL}...`);

    let newTlds;
    try {
        newTlds = await fetchSupportedTlds();
    } catch (err) {
        console.error(`Failed to fetch TLD list: ${err.message}`);
        process.exit(1);
    }

    const existing = JSON.parse(fs.readFileSync(TLD_POLICY_PATH, 'utf8'));
    const oldSet = new Set(existing.supported);
    const newSet = new Set(newTlds);

    const added = newTlds.filter(t => !oldSet.has(t));
    const removed = existing.supported.filter(t => !newSet.has(t));

    if (added.length === 0 && removed.length === 0) {
        console.log(`No changes. Current list has ${existing.supported.length} TLDs.`);
        return;
    }

    // Only add new TLDs; don't remove existing ones (page parsing may miss some).
    // Manual review recommended for removals.
    const merged = [...new Set([...existing.supported, ...added])].sort();

    existing.supported = merged;
    existing._updatedAt = new Date().toISOString().split('T')[0];

    fs.writeFileSync(TLD_POLICY_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf8');

    console.log(`Updated cloudflare-tlds.json: ${merged.length} TLDs total.`);
    if (added.length) console.log(`  Added (${added.length}): ${added.join(', ')}`);
    if (removed.length) console.log(`  Possibly removed from CF (${removed.length}, kept): ${removed.join(', ')}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
