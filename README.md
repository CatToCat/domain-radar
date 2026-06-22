# Domain Radar

Scan short domain availability across 125+ TLDs automatically. Combines DNS, RDAP, and WHOIS lookups to detect registration status, then presents results in a filterable static dashboard.

## Features

- Exhaustive enumeration of short domain combinations (digits, alpha, or mixed modes)
- Multi-layer availability detection: DNS resolution → RDAP → WHOIS fallback
- Concurrent scanning with configurable rate limiting and retry strategies
- Static single-page result viewer with real-time filtering, sorting, and pagination
- Zero-backend architecture — deploy to Vercel as a static site, scan via CI
- Notification support for newly available domains

## Quick Start

```bash
npm install
npm run run-all
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run generate-domain-list` | Generate domain combinations based on config |
| `npm run scan-availability` | Scan generated domains for availability |
| `npm run notify-short-domains` | Send notifications for available domains |
| `npm run run-all` | Run the full pipeline |
| `npm test` | Run all tests |

## Configuration

Edit `config.yaml` to customize scanning parameters:

```yaml
sld:
  length: 2        # SLD character length
  mode: mixed      # digits | alpha | mixed

tld:
  length: 2        # Max TLD length to include

scanner:
  dnsConcurrency: 50
  rdapConcurrency: 20
  whoisDelay: 2000
  whoisRetries: 3
```

## Deployment

The project is configured for Vercel deployment. The `public/` directory serves as the static site root, displaying scan results from `public/results/`.

## Project Structure

```
domain-radar/
├── config.yaml          # Scanner configuration
├── public/
│   └── index.html       # Result viewer UI
├── src/
│   ├── cli/             # CLI entry points
│   └── lib/             # Core library modules
├── test/                # Test files
└── vercel.json          # Vercel deployment config
```

## License

[MIT](LICENSE)
