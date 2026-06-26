# Domain Radar

Find **registerable, cheap short domains** under the 3-character TLDs Cloudflare
Registrar supports for programmatic registration, then confirm real-time
availability and pricing via Cloudflare. Only available domains are kept, and
they are presented in a minimal static dashboard.

## How it works

1. **Enumerate** short SLDs (digits + letters, configurable length) under the
   eligible TLDs.
2. **DNS pre-filter** — domains that resolve are already registered and skipped
   cheaply, before spending any Cloudflare API quota.
3. **Cloudflare domain-check** — an authoritative, real-time registry check on
   the remaining candidates. Only domains confirmed `registrable` at the
   `standard` tier are kept (premium / reserved / taken are dropped).
4. **Output** — each kept domain is stored as `{ domain, price, currency }` in
   `public/results/domains.json`, viewable in `public/index.html`.

## Quick Start

```bash
npm install
# Cloudflare credentials are required:
$env:CLOUDFLARE_ACCOUNT_ID="..."   # PowerShell
$env:CLOUDFLARE_API_TOKEN="..."
npm run estimate-scan-time   # preview scope & rough time
npm run scan-availability    # run the scan
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run generate-domain-list` | Preview the scan scope (TLDs, SLD counts, totals) |
| `npm run estimate-scan-time` | Rough time estimate for a full scan |
| `npm run scan-availability` | DNS pre-filter + Cloudflare confirmation |
| `npm run run-all` | Alias for the scan |

## Configuration

Edit `config.yaml`:

```yaml
sld:
  minLength: 2    # skip 1-char SLDs (registry-reserved)
  maxLength: 3    # enumerate up to this many characters
  mode: mixed     # digits | alpha | mixed (mixed = a-z 0-9)

tld:
  length: 3       # only TLDs with exactly this many characters

scanner:
  dnsConcurrency: 50
  cloudflareConcurrency: 3
  cloudflareBatchSize: 20    # CF max is 20 per request
  cloudflareDelay: 200       # ms between batches
  shardsPerRun: 0            # max shards per run (0 = all). See Sharding.
```

## Eligible TLDs

`data/tld-policy.json` lists the TLDs Cloudflare supports for programmatic
registration. The scanner keeps only those whose length equals `tld.length`.
With the default `tld.length: 3`, the eligible TLDs are:

`com, org, net, app, dev, xyz, pro, fyi, run, day, ing, icu` (12 TLDs)

With `sld` 2–3 chars (mixed), that is ~47.9k SLDs × 12 TLDs ≈ **575k domains**.

## Sharding & resumable scans

A full scan is large and Cloudflare is rate-limited, so the scanner works in
**shards** — one shard per `(TLD, SLD-length)` pair.

- Progress is tracked in `data/scan-progress.json`. Each completed shard is
  recorded, so re-running continues where the last run left off.
- Results accumulate into `public/results/domains.json` and are de-duplicated.
- Set `scanner.shardsPerRun` to a small number to scan a few shards per run
  (e.g. one CI run per day) until the cycle completes; `0` scans everything in
  one pass.
- Changing the scan config (SLD range, mode, TLD length) starts a fresh cycle.

## Cloudflare credentials

Create a [Cloudflare API token](https://dash.cloudflare.com/profile/api-tokens)
with Registrar permissions and note your account ID. Provide them as
`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` environment variables (locally)
or GitHub repo secrets (CI). The `domain-check` endpoint is read-only and does
not register anything.

## Project Structure

```
domain-radar/
├── config.yaml                  # Scanner configuration
├── data/
│   ├── tld-policy.json          # Cloudflare-supported TLD allowlist
│   └── scan-progress.json       # Shard progress (created on first run)
├── public/
│   ├── index.html               # Result viewer (TLD + SLD-length filters)
│   └── results/
│       ├── domains.json         # Accumulated available domains
│       └── manifest.json        # Latest snapshot metadata
├── src/
│   ├── cli/                     # CLI entry points
│   └── lib/                     # Core modules (generator, scanner)
└── .github/workflows/
    └── daily-check.yml          # Daily scan
```

## License

[MIT](LICENSE)
