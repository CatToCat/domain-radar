# Domain Radar

Scan short domain availability across 125+ TLDs automatically. Combines DNS, RDAP, and WHOIS lookups to detect registration status, then presents results in a filterable static dashboard.

## Features

- Exhaustive enumeration of short domain combinations (digits, alpha, or mixed modes)
- Multi-layer availability detection: DNS resolution → RDAP → WHOIS fallback
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
  mode: mixed         # digits | alpha | mixed

tld:
  length: 2           # Max TLD length to include

scanner:
  dnsConcurrency: 50  # Parallel DNS lookups
  rdapConcurrency: 20 # Parallel RDAP queries
  whoisConcurrency: 10 # Parallel TLD queues for WHOIS
  whoisDelay: 500     # Delay between WHOIS calls per TLD (ms)
  whoisRetries: 3     # Retry attempts on WHOIS failure
```

## TLD Cache

`data/tld-cache.json` stores which TLDs lack RDAP/WHOIS support, avoiding thousands of futile lookups each scan. The cache is updated:

- Automatically every month via GitHub Actions (`update-tld-cache.yml`)
- Manually with `npm run update-tld-cache`

## Project Structure

```
domain-radar/
├── config.yaml              # Scanner configuration
├── data/
│   └── tld-cache.json       # TLD support cache
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
