# Domain Radar

Scan short domain availability across 125+ TLDs automatically. Combines DNS, RDAP, and WHOIS lookups to detect registration status, then presents results in a filterable static dashboard.

## Features

- Exhaustive enumeration of short domain combinations (digits, alpha, or mixed modes)
- Multi-layer availability detection: DNS resolution → RDAP → WHOIS → Cloudflare domain-check
- Distinguishes truly **registerable** domains from registry-reserved and premium ones, with pricing
- TLD allowlist restricted to extensions Cloudflare can authoritatively confirm
- Per-TLD concurrent WHOIS with configurable rate limiting
- TLD cache to skip unsupported RDAP/WHOIS lookups (auto-updated monthly)
- Static single-page result viewer with real-time filtering, sorting, and pagination
- Execution time estimation before each scan
- GitHub Actions daily scan with auto-commit results
- Notification support for newly available domains

## Quick Start

```bash
npm install
npm run update-tld-cache   # Generate TLD support cache (first time)
npm run run-all            # Run the full pipeline
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run generate-domain-list` | Generate domain combinations based on config |
| `npm run scan-availability` | Scan generated domains for availability |
| `npm run update-tld-cache` | Probe TLDs and update support cache |
| `npm run notify-short-domains` | Send notifications for available domains |
| `npm run run-all` | Run the full pipeline |
| `npm test` | Run all tests |

## Configuration

Edit `config.yaml` to customize scanning parameters:

```yaml
sld:
  length: 2           # SLD character length
  minLength: 2        # skip SLDs shorter than this (1-char are registry-reserved)
  mode: mixed         # digits | alpha | mixed

tld:
  length: 2           # Max TLD length to include

scanner:
  dnsConcurrency: 50  # Parallel DNS lookups
  rdapConcurrency: 20 # Parallel RDAP queries
  whoisConcurrency: 10 # Parallel TLD queues for WHOIS
  whoisDelay: 500     # Delay between WHOIS calls per TLD (ms)
  whoisRetries: 3     # Retry attempts on WHOIS failure
  cloudflareConcurrency: 3 # Parallel Cloudflare domain-check batches
  cloudflareBatchSize: 20  # Domains per domain-check request (CF max 20)
  cloudflareDelay: 200     # Delay between Cloudflare batches (ms)
```

## Availability Status

Each result carries an authoritative `status`:

| Status | Meaning | In notifications? |
|--------|---------|-------------------|
| `available` | Registerable at standard price (Cloudflare confirmed) | Yes |
| `premium` | Registerable but premium-priced | No (flagged) |
| `reserved` | Registry-reserved / unavailable | No |
| `unsupported` | TLD not checkable via Cloudflare | No |
| `registered` | Already taken | No |
| `unknown` | Could not determine | No |

RDAP/WHOIS can only tell whether a domain is *in the registry* — they cannot
distinguish reserved/premium from freely registerable. The **Cloudflare
domain-check stage** performs an authoritative, real-time registry check and
returns `registrable`, pricing tier, and (when present) annual pricing. Without
Cloudflare credentials the scan still runs, but `available` reflects RDAP/WHOIS
only and may include reserved/premium domains.

### Enabling Cloudflare confirmation

1. Create a [Cloudflare API token](https://dash.cloudflare.com/profile/api-tokens) with Registrar permissions and note your account ID.
2. Set them locally (`CLOUDFLARE_ACCOUNT_ID=...`, `CLOUDFLARE_API_TOKEN=...`) or as GitHub repo secrets of the same names.

The `domain-check` endpoint is a read-only availability check (it does not
register anything) and batches up to 20 domains per request.

## TLD Policy

`data/tld-policy.json` defines the **`supported`** allowlist — the TLDs
Cloudflare supports for *programmatic* registration. Only these are scanned,
because only these can be authoritatively confirmed as registerable via the
domain-check API. TLDs outside the allowlist (e.g. most ccTLDs) are excluded
from scanning entirely; register them via the Cloudflare dashboard if needed.

Single-character SLDs are skipped by default (`sld.minLength: 2`) because registries almost always reserve them.

## TLD Cache

`data/tld-cache.json` stores which TLDs lack RDAP/WHOIS support, avoiding thousands of futile lookups each scan. The cache is updated:

- Automatically every month via GitHub Actions (`update-tld-cache.yml`)
- Manually with `npm run update-tld-cache`

## Project Structure

```
domain-radar/
├── config.yaml              # Scanner configuration
├── data/
│   ├── tld-cache.json       # TLD support cache
│   └── tld-policy.json      # TLD registration policy (restricted/premium)
├── public/
│   ├── index.html           # Result viewer UI
│   └── results/             # Scan result JSON files
├── src/
│   ├── cli/                 # CLI entry points
│   └── lib/                 # Core library modules
├── test/                    # Test files
└── .github/workflows/
    ├── daily-check.yml      # Daily scan
    └── update-tld-cache.yml # Monthly cache refresh
```

## License

[MIT](LICENSE)
