# Glitch Hunter India

A local price-evidence workstation for Amazon India, Flipkart and other permitted public sources. It separates unusual pricing from trustworthy evidence and purchase verification. Built from an empty repository; no example deals are seeded into the application.

**Status:** category radar, persistent public-page history collection, VIGIL 0.2 robust anomaly ranking, matching-seller comparisons and manual search are implemented. The radar searches selected tech categories on a schedule; no individual query is required. Direct price collection needs no Keepa subscription and spends no Firecrawl credits, while discovery still uses Firecrawl. There is no seeded deal/history data or claim of calibrated real-world accuracy. See [Category radar setup](docs/radar.md) and [model mathematics](docs/vigil.md).

## Run

Requires Node **24** and npm. From this checkout:

```bash
cd /workspace/Glitch-Hunter-Ind
npm ci --cache /tmp/ghi-npm-cache
npm run build
npm start
```

The server binds to loopback on port 3000. `npm run dev` runs the backend with Node's watcher. To develop frontend assets, remove only the generated `dist` directory (`rm -rf dist`) or rerun `npm run build` after frontend edits; the server serves `dist` when present, otherwise `public`.

Optional local configuration:

```bash
cp .env.example .env
```

Do not overwrite an existing `.env`. Enter credentials in that local ignored file or secure deployment settings, never in a commit. Node loads `.env` without overriding injected environment values.

1. Set `FIRECRAWL_API_KEY` securely for your authorized Firecrawl account; review your plan’s collection, storage, quota and rate terms. Restart the server. Without a key, the app starts and manual evidence/history remain usable; automated search and extraction are disabled.
2. In Settings, set the shared daily request budget, minimum interval, timeout, search result limit (1–20), cache lifetime, and optional costs per search/scrape. Provider-reported credits and unknown costs are shown separately; no pricing tier is assumed.
3. Enable scheduled searches, then queue a category or exact model on the Results page. Starter categories are optional. Results are index leads, not live prices.
4. For optional product-page extraction, review the website’s terms and approve its exact domain in Settings. Queue the exact URL on the Results page. Robots denial/unavailability, access controls, ambiguous variants or prices remain unverified. A fresh recheck bypasses only the local extraction cache and still respects deduplication, permission and budget. Otherwise record a real price in Price evidence, including the exact variant and source. Manual entries remain unvalidated and do not create trusted history. No login session, cart or purchase is automated.
5. Add product/category monitors in Watchlist. They recur after cache expiry while scanning is enabled.

No product-data credentials are guessed. `Amazon Creators API` and `Flipkart Affiliate` remain unavailable official API boundaries; opting into permitted Firecrawl extraction does not establish marketplace API access. No authenticated marketplace response has been verified in this environment.

## Validation

```bash
npm test
npm run build
npm run backtest
npm run test:visual
npm audit --omit=dev --audit-level=high --cache /tmp/ghi-npm-cache
```

Visual QA requires Chromium at `/usr/bin/chromium`, or set `CHROMIUM_PATH`. It uses a temporary isolated SQLite database and synthetic fixtures, exercises desktop/mobile flows, verifies actual browser font use, and writes screenshots to ignored `artifacts/`. Tests do not send notifications or make live paid searches. `backtest` writes an explicitly synthetic report; its performance must not be presented as real marketplace accuracy.

## Modules and files

| Path                                                        | Purpose                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/server.js`                                             | Validated HTTP API, host/origin checks, optional session authentication, app lifecycle      |
| `src/db.js`, `migrations/`                                  | Versioned SQLite migration, WAL persistence, policy settings                                |
| `src/providers.js`                                          | Firecrawl v2 search/scrape HTTP adapter and explicit unavailable marketplace boundaries     |
| `src/extraction.js`, `src/urls.js`, `src/provider-state.js` | Permitted structured extraction, source normalization, health and shared request accounting |
| `src/discovery.js`, `src/radar.js`                          | Adaptive bounded queue, expansion, inferred categories, caches, retry, quota and recovery   |
| `src/public-pages.js`                                       | Free direct public HTML reads, DNS/address checks, response limits                          |
| `src/identity.js`, `src/evidence.js`                        | Price parsing, exact identity, product/variant/listing/offer records, provenance and review |
| `src/vigil.js`, `src/robust-model.js`                       | Reproducible severity/confidence/value/purchase-state calculations                          |
| `src/notifications.js`                                      | Opt-in Telegram/SMTP delivery, eligibility, cooldown and deduplication                      |
| `public/`                                                   | Seven data-connected views; local Paper Mono and its OFL licence                            |
| `scripts/`                                                  | Build, synthetic evaluation and browser QA                                                  |
| `tests/`                                                    | Unit, API, persistence, provider-contract, scheduler and notification tests                 |
| `docs/research-and-assumptions.md`                          | Source URLs, verified facts, blocked research, assumptions and provenance                   |
| `docs/vigil.md`                                             | Formulas, parameter ranges, integrity gates, scientific limitations                         |
| `docs/delivery.md`                                          | Verified outcomes, remaining access and unfinished capabilities                             |

The category radar extends VIGIL to robust trend and change diagnostics, adds persistent public-page tracking and conservative identity scopes, and keeps the local Paper Mono font assets. The earlier [Firecrawl migration report](docs/firecrawl-migration.md) documents the discovery adapter. Generated dependencies, database, production assets, logs and screenshots are ignored.

## Persistence and API

SQLite defaults to `data/glitch-hunter.sqlite`, overridable via `DATABASE_PATH`. Back up using SQLite's backup mechanism or stop the process before copying the database; WAL files are live state. Products, variants, listings, seller offers, observations, baseline provenance, candidates, jobs, query yield, feedback, usage, monitors and notifications persist across restarts. Scheduler recovery requeues interrupted work. Run one server/worker instance per database; this is not a multi-user or distributed deployment.

Important endpoints: `GET /api/state`, `GET /api/candidates/:id`, `POST /api/observations`, `POST /api/baselines`, `POST /api/jobs`, `POST /api/extractions` (optional `recheck: true`), extraction `/cancel`, `POST /api/watchlist`, `PATCH /api/settings`, and candidate `/feedback` and `/verification`. JSON bodies are validated. The baseline endpoint always creates `user_entered_unvalidated` records. Public APIs cannot assert external trust or checkout verification.

Price types, currency, source timestamp and provenance remain explicit. Observation duplicates are suppressed by offer/time/provider/reference. API errors contain codes and field issues, not credential values or upstream response bodies.

## Deployment

For Render, follow [the Render setup guide](docs/render.md).

A Docker image, HTTPS reverse proxy and persistent-volume configuration are provided. See [hosted deployment](docs/hosting.md) and [first-use guide](docs/quick-start.md). Hosting account/server and hostname are still required for a live website.

Local deployment uses the run commands above. For a hosted single-user deployment, put a TLS reverse proxy in front and supply a strong random `APP_AUTH_TOKEN` and exact HTTPS `PUBLIC_ORIGIN`. Public binding refuses to start without a sign-in token and a trusted HTTPS origin. On Render, its automatically supplied `RENDER_EXTERNAL_URL` provides that origin; `PUBLIC_ORIGIN` is optional unless you use a custom domain. Set these securely in the process environment, then:

```bash
npm ci --omit=dev --cache /tmp/ghi-npm-cache
HOST=0.0.0.0 PORT=3000 NODE_ENV=production npm start
```

Build with development dependencies installed **before** the production-only install, and retain `dist`, `public/fonts`, `src` and `migrations`. Mount persistent storage for `data`, configure restart-on-failure with your process supervisor, and run one process. Sign in with the deployment token; sessions use HttpOnly/SameSite cookies (Secure with HTTPS origin) and expire after eight hours. Session memory is intentionally lost on restart. Only configured hosts/origins are accepted. TLS termination, public DNS, SMTP/network access and an actual hosted deployment have not been provisioned or verified.

Each Codex cloud task is already isolated. Use the existing checkout; do not create a Git worktree unless explicitly requested. Reusable installation and startup instructions are also saved in the cloud environment draft. Draft saving is separate from publication.

## Optional alerts

Telegram needs `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. SMTP email needs `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`; this adapter uses implicit TLS, default port 465. SMTP requires real locally injected credentials and network access; proxy placeholders are not raw SMTP passwords. Enable alerts in Settings only after configuring your own destination. The worker evaluates eligible candidates once per minute; System health can also request processing. Both severity and confidence thresholds and all integrity gates apply. Firecrawl observations additionally require a second matching observation of the same offer and exact variant within 15 minutes, including a fresh current price; they still never claim cart or checkout verification.

Outbound delivery was not attempted. Sent alerts carry source and baseline provenance, independent severity/confidence, identity, stock, seller, timestamps, reasons and listing links. Deduplication uses variant/marketplace/seller, price buckets and purchase state, with a 24-hour cooldown. Failures are recorded without secrets. Delivery is best effort: a crash between remote delivery and local acknowledgement can leave an uncertain record. There is no exactly-once guarantee.

## Typography and evidence honesty

The only selected font is **Paper Mono**, locally served from the official Paper.design repository, unmodified under SIL OFL 1.1. Its variable axis supports weights 100–800. See `public/fonts/OFL.txt` and the research ledger for source commit/hash. Generic monospace is only a fallback; a failed font request produces a visible warning.

No decorative product images, invented histories, hardcoded deals, claimed verified checkout, or claims of complete marketplace coverage are included. VIGIL is a provisional ranking model, not a calibrated probability of seller error. Potential savings exclude unknown fulfilment, delivery and cancellation outcomes.

Radar controls use `POST /api/radar`; the UI handles category/source validation and start/pause. `GET /api/state` includes the category feed and its price-history/comparison assessments. No new credential is required for direct collection.
