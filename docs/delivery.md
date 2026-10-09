# Delivery status

The local development application is implemented. **Firecrawl search is live-verified; permitted price extraction and authoritative verification remain unverified.** No live search response, Amazon/Flipkart product response, trusted external historical dataset, checkout result, or outbound notification has been fabricated or reported as successful.

## Implemented

- Node 24 / Express / persistent SQLite with versioned migration and separate product, variant, listing, seller-offer, observation, baseline and candidate records.
- Conservative identity comparisons, currency/full-price validation, provenance, deduplication, freshness and stock gates. Manual evidence and baselines remain explicitly unvalidated.
- Modular VIGIL outputs: severity, evidence confidence, potential saving/reference provenance, and purchase status. Evaluation time, component signals, weights and comparison attributes are recorded. See `vigil.md` for exact formulas.
- Firecrawl v2 search/scrape adapter based on official provider source, broad public-source normalization and opt-in robots-checked structured extraction, bounded persistent scheduling, deduplication, per-provider rate backoff, cancellation, restart recovery, daily request/cost accounting, TTL cleanup, watchlists and observed-title/model/category expansion. Daily budget resets at midnight India time. Capacity is one request at a time and at most 200 pending jobs.
- Adaptive priority uses useful/false-positive feedback, new listing yield, search age, exploration/information-gain proxy, observed value weighted by reliability, category diversity and configured search cost. Defaults are hypotheses, not an optimized policy.
- Seven backend-connected views: Radar, Discover, Price evidence, Candidate detail, Watchlist, System health and Settings. Filters, sorting, forms, review actions, queue controls and policy settings operate against the database.
- Point-only historical chart with provenance, missing intervals left unconnected, candidate marker, readable horizontally scrollable mobile chart and an accessible tabular source ledger.
- Optional Telegram and SMTP notification adapters with explicit enablement, dual score thresholds, integrity gates, deduplication and cooldown. No message was sent during development.
- Host/origin protections, validated JSON API, CSP, output escaping, safe credential handling, loopback default and mandatory authentication for public binding.
- Locally bundled, licensed Paper Mono variable WOFF2. Only Paper Mono is deliberately selected; generic monospace is fallback only. Variable weights 100–800 and the INR glyph were inspected. Browser font failure is visible.

The existing application was migrated in place; VIGIL, identity logic, CSS and Paper Mono assets are preserved. The module inventory and commands are in `README.md`; migration details are in `firecrawl-migration.md`. The user subsequently published the cloud environment and authorized a GitHub push for Render. A production Render deployment remains to be created and verified.

## Validation performed

- `npm test`: **74 passed, 0 failed, 0 skipped**, covering identity/variant separation, price parsing, missing and stale data, zero MAD, source independence, ordinary discounts, accessory/refurbished/bundle conflicts, expiry, persistence and migrations, provider contract/timeout/rate-limit behavior, queue recovery/cancellation/quota, cache expiry, notification deduplication, input validation, authentication and origin/host restrictions.
- `npm run build`: production JS/CSS built successfully, local font-family audit passed.
- `npm run backtest`: eight explicitly synthetic chronological cases plus five ablations ran. Full-model expected decisions pass; this is **not real-world accuracy evidence**. Report: `artifacts/synthetic-evaluation.json`.
- Chromium/Playwright: 1440×1000 desktop and 390×844 mobile, navigation, watchlist add/remove, search and extraction queue/cancel, fresh recheck selection, six mocked provider-health states, settings persistence, observation entry, candidate review, reference entry, missing-provider states, initial loading, API failure and font failure. Actual custom font usage is verified via Chromium's font inspector. Screenshots and `visual-qa.json` are in `artifacts/`.
- Automated WCAG A/AA checks and keyboard skip-link behavior are included in browser QA. Manual screenshot inspection covered desktop/mobile radar, settings and candidate layouts. This does not establish full accessibility conformance.
- Production dependency audit: zero reported vulnerabilities after updating the initial vulnerable mail and HTTP dependencies.
- Useful local HTTP requests and restart/persistence checks validate the API and saved startup flow. No public deployment or fresh cloud-task snapshot restoration has been tested.

## Operational providers and missing access

| Provider            | Actual status                                                                  | Needed next                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Firecrawl           | Authenticated search passed: two leads, two reported credits on 9 October 2026 | Keep budgets explicit; review terms and approve domains before extraction.                                           |
| Amazon Creators API | Unavailable adapter boundary                                                   | Current official India documentation, eligible account and usable credentials; implement only the verified contract. |
| Flipkart Affiliate  | Unavailable adapter boundary                                                   | Current official documentation, approved account and usable credentials; implement only the verified contract.       |
| External history    | Not integrated                                                                 | Licensed variant-level source and its provenance/retention contract.                                                 |
| Telegram / email    | Optional adapters, no live delivery test                                       | User-selected destination, channel credentials and network route; explicitly enable alerts.                          |
| Paper Mono          | Official asset obtained and browser-verified                                   | None for local use; retain OFL notice.                                                                               |

The reusable cloud setup draft is updated for Firecrawl. Enter missing credentials securely in environment settings. Saving a draft does not change the running instance or publish a snapshot. No publication is authorized.

## Known limitations and unfinished work

- After publication, one bounded authenticated search returned two real public-source listing leads from `wol3d.com` and `www.3idea.in`, using two reported credits. These are search leads, not validated price observations. Search coverage is bounded by configured queries and returned indexed results, never all of Amazon or Flipkart. Search requests return a configurable 1–20 results; official v2 search types expose no offset/page pagination and none is invented.
- Permitted product-page collection and fresh page rechecks use Firecrawl; authoritative marketplace API and checkout verification remain unavailable. Extraction deliberately requires one explicit structured product and offer with complete variant fields, INR full price, seller and stock. Many pages will remain unverified. Search snippets stay discovery leads. Manual observations are useful for recording/review but cannot make themselves trusted or checkout-verified. High-confidence automatic alerts are not currently reachable from manual entries alone.
- Trusted historical lows require a validated provider contract. No historical dataset was invented, no manufacturer MRP is substituted, and no all-time-low claim is made.
- Manual checkout remains external. No private account sessions, cart automation or purchasing is performed. Public review actions cannot set CHECKOUT_VERIFIED.
- Potential savings are not probabilistic expected utility; fulfilment and cancellation probability is unknown. Temporal change is a bounded same-seller drop diagnostic, not a learned change-point detector. Weights and calibration remain provisional.
- Synthetic ablations cannot establish superiority, calibrated confidence, detection delay, candidate survival, manual confirmation rates, cost per actionable finding, or representative category precision. These metrics stay unavailable until labelled live outcomes exist.
- Single-user/single-worker deployment only. Public TLS/domain configuration, hosted deployment, email connectivity and proxy-specific notification credentials have not been provisioned or verified.
- Notification delivery is best effort, not exactly once. A crash after remote delivery can leave local acknowledgement uncertain. A failed notification stays visible and respects the cooldown.
- No known failing automated checks remain in the delivered local workflow. The missing integrations above are unfinished capabilities, not successful tests.

## Startup and deployment

```bash
cd /workspace/Glitch-Hunter-Ind
npm ci --cache /tmp/ghi-npm-cache
npm run build
npm start
```

Development server: `npm run dev` (see README for frontend rebuild behavior). Hosted deployment requires a TLS reverse proxy, persistent storage, secure `APP_AUTH_TOKEN` and `PUBLIC_ORIGIN`; with those securely set, `HOST=0.0.0.0 PORT=3000 NODE_ENV=production npm start`. The local service binds to loopback port 3000 by default.
