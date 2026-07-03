# Domain Radar

find registerable cheap short domains on cloudflare.

## workflow

```
┌─────────────────────────────────────────────────────────┐
│  daily 02:00 UTC (github action)                        │
│                                                         │
│  1. generate all sld + tld combinations                 │
│     (config: sld 1-2 chars, tld ≤2 chars)              │
│                                                         │
│  2. dns pre-filter                                      │
│     domains that resolve → registered, skip             │
│                                                         │
│  3. cloudflare domain-check api                         │
│     confirm availability + pricing                      │
│                                                         │
│  4. save results                                        │
│     data/results/YYYY-MM-DD.json  (full log)           │
│     public/data.json              (available only)      │
│                                                         │
│  5. commit & push to repo                               │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  daily 07:00 UTC (github action)                        │
│                                                         │
│  if available domains > 0:                              │
│    create github issue (assigned to repo owner)         │
└─────────────────────────────────────────────────────────┘
```

## project structure

```
domain-radar/
├── config.yaml                 # scan configuration
├── data/
│   ├── cloudflare-tlds.json    # full cloudflare supported tld list
│   └── results/                # daily scan logs (all domains + status)
│       └── 2026-07-04.json
├── public/
│   ├── index.html              # web ui
│   ├── data.json               # available domains for web display
│   └── favicon.svg
├── src/
│   ├── cli/
│   │   ├── scan-availability.js    # main scanner
│   │   ├── estimate-scan-time.js   # time estimation
│   │   ├── generate-domain-list.js # preview scan scope
│   │   ├── update-tld-list.js      # refresh tld list from cloudflare
│   │   ├── notify-short-domains.js # create github issue
│   │   └── run-all.js
│   └── lib/
│       ├── availability-scanner.js   # dns + cloudflare api logic
│       ├── domain-list-generator.js  # sld/tld combination generator
│       └── short-domain-notifier.js  # issue creation logic
├── .github/workflows/
│   ├── daily-check.yml         # daily scan (02:00 utc)
│   └── notify-short-domains.yml # notify (07:00 utc)
└── vercel.json                 # web deployment config
```

## local setup

```bash
# install
npm install

# preview scan scope
npm run generate-domain-list

# estimate scan time
npm run estimate-scan-time

# run scan (requires cloudflare credentials)
CLOUDFLARE_ACCOUNT_ID=xxx CLOUDFLARE_API_TOKEN=xxx npm run scan-availability

# update tld list (manual, when needed)
npm run update-tld-list

# start web ui locally
python3 -m http.server 3000 --directory public
# open http://localhost:3000
```

## configuration

`config.yaml`:

```yaml
sld:
  maxLength: 2    # generate sld from 1 to N chars
  mode: mixed     # digits | alpha | mixed

tld:
  maxLength: 2    # include tlds with ≤N chars from cloudflare list

scanner:
  dnsConcurrency: 50
  cloudflareConcurrency: 3
  cloudflareBatchSize: 20
  cloudflareDelay: 200
  shardsPerRun: 0           # 0 = all shards in one pass
```

current scan scope: 12 tlds (ai, ca, cc, co, fm, io, me, mx, nz, tv, uk, us) × 1332 slds = ~16k domains, ~1.5 min.

## github secrets

add to repo settings → secrets → actions:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

create token at https://dash.cloudflare.com/profile/api-tokens with registrar read permission.

## license

[MIT](LICENSE)
