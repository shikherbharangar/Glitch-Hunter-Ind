# Firecrawl migration

Reviewed 10 October 2026. The second pasted directive is the migration request; the PDF remains supporting material, not executable instructions. Work modifies the existing application without changing VIGIL formulas, identity comparisons, typography or CSS. After the migration, the user published the cloud environment and authorized a GitHub push for Render. Production hosting remains a separate step.

## Audit and plan

The prior provider was isolated in `src/providers.js`, but scheduler accounting, cache keys, result filtering, environment examples, provider health, tests and setup instructions assumed Brave. `undici` was shared transport rather than a Brave-only dependency. Existing anonymous search results did not record their original provider or source website. VIGIL and price identity had no search-provider dependency.

The migration plan was to introduce a dedicated Firecrawl adapter and provider-independent lead normalization; migrate provenance and health additively; keep discovery separate from permitted extraction/validation; retain existing identity, scoring, history and alerts; then replace runtime configuration/docs and verify mocked contracts, persistence and browser flows. A consistent pre-migration SQLite backup and source copy are retained at `/tmp/ghi-before-firecrawl/`.

## Verified provider contract

The requested [official documentation](https://docs.firecrawl.dev/) returned proxy CONNECT 403 in this instance. To avoid guessing, verification used Firecrawl’s own repository at commit `3f5f906ca28fbbc48ed71a0af2e01c1dd6a35dd8`:

- [Official v2 search method](https://github.com/firecrawl/firecrawl/blob/3f5f906ca28fbbc48ed71a0af2e01c1dd6a35dd8/apps/js-sdk/firecrawl/src/v2/methods/search.ts), [scrape method](https://github.com/firecrawl/firecrawl/blob/3f5f906ca28fbbc48ed71a0af2e01c1dd6a35dd8/apps/js-sdk/firecrawl/src/v2/methods/scrape.ts) and [types](https://github.com/firecrawl/firecrawl/blob/3f5f906ca28fbbc48ed71a0af2e01c1dd6a35dd8/apps/js-sdk/firecrawl/src/v2/types.ts).
- [Official API validation](https://github.com/firecrawl/firecrawl/blob/3f5f906ca28fbbc48ed71a0af2e01c1dd6a35dd8/apps/api/src/controllers/v2/types.ts) and [search response implementation](https://github.com/firecrawl/firecrawl/blob/3f5f906ca28fbbc48ed71a0af2e01c1dd6a35dd8/apps/api/src/controllers/v2/search.ts).

`POST https://api.firecrawl.dev/v2/search` uses Bearer authentication, `query`, web `sources`, `country: IN`, `limit`, `timeout` and `ignoreInvalidURLs`. Wire results are `success`, `data.web`, and optional top-level `creditsUsed`. The app caps results at 20 even though the current provider supports up to 100. No pagination parameter exists in the reviewed v2 search interface; no offsets or speculative methods are sent.

`POST /v2/scrape` requests `rawHtml` and `markdown`, `onlyMainContent: false`, `proxy: basic`, `maxAge: 0`, `storeInCache: false`, and `timeout`. Its response uses `data.rawHtml` and `data.metadata.sourceURL/statusCode`, with optional metadata credits. No crawl endpoint, actions, private session, login, CAPTCHA/stealth bypass or purchase flow is used.

The current official SDK uses an Axios transport without the external abort signal and existing Undici proxy dispatcher needed for this scheduler’s cancellation and cloud secret route. The app therefore uses the official HTTP contract through its existing Undici transport. TLS verification remains enabled. Endpoint/options/envelopes are mocked in tests; An authenticated bounded search subsequently succeeded after user publication on 9 October 2026 at 22:35 UTC: two leads and two provider-reported credits. No account quota/pricing claim is made. Documentation-site verification remains outstanding.

## Pipeline and permission boundaries

Search produces leads only: original and canonical URLs, title, snippet/optional markdown, website domain, marketplace identity, retrieval time, provider and safe metadata. Other public HTTPS websites are retained alongside Amazon and Flipkart; a website’s domain does not prove marketplace identity. Unsafe/local URLs and credentials in URLs are rejected. Tracking parameters are removed without removing other-source variant query parameters.

Manual URL entry and extraction are separate. Domain approval is empty by default and must follow the user’s review of collection terms. Exact approved domains and readable robots policy are required; denial or policy-fetch failure stops before a paid scrape. No cross-domain redirect is accepted. This check does not independently prove legal permission or future robots behavior at Firecrawl’s infrastructure.

Only one explicit JSON-LD Product and Offer can create an observation. Required fields include brand/model, bundle, capacity, colour, generation, kind, pack count, condition, seller, availability, INR and an unambiguous full price. Conflicting products/offers, missing attributes, malformed structured data, conditional/instalment/coupon prices, access-control pages and mismatched product URLs produce an explicit unverified extraction record. No snippet, MRP, guessed attribute or missing value becomes a price. Site-specific fallbacks and probabilistic price extraction are intentionally absent.

Validated page observations retain Firecrawl provenance, retrieval time, source URL, seller source group and `PRODUCT_PAGE_OBSERVED`; they feed the unchanged identity/evidence/VIGIL pipeline. This is page evidence, not independent historical validation, manually verified checkout, cart evidence or checkout confirmation. Manual evidence stays unvalidated. High-priority Firecrawl alerts require a second matching, fresh same-offer/variant/price observation within 15 minutes in addition to the existing score/integrity gates. Request a fresh recheck explicitly in Discover; repeated polling does not increase independent-source counts. Alerts remain opt-in.

## Budget, health and compatibility

Concurrency is one across search and extraction. Shared daily attempted-request budget resets at midnight India time. Minimum interval, request timeout (1–120 seconds), result limit, cache TTL and optional costs are configurable. Search queue capacity is 200; extraction capacity is 50. Requests are deduplicated; extraction can bypass recent cache only through an explicit fresh recheck. Rate/transient extraction retries are bounded to three attempts; Retry-After and exponential backoff apply. Quota exhaustion pauses the provider rather than trying another paid provider. Search/watchlist expansion remains bounded, with adaptive priority and exploration; starter categories are opt-in and cover niche maker, flight, astronomy, computing, laboratory and hobby products.

System health reports missing credentials, configured/unverified, operational only after actual success, configured/failing, rate-limited and quota-exhausted states, last successful discovery/request, and recent safe outcomes. Request counts, estimated configured costs and reported credits are distinct; missing cost/credit data is labelled unknown. There is no assumed free or unlimited tier.

Migration `002_firecrawl.sql` adds provenance, operation/credit usage fields, provider health and extraction jobs without dropping products, variants, offers, observations, baselines, candidates, jobs, watchlists or notifications. Old anonymous results are labelled `legacy_search`, with URLs/domains backfilled. Historical usage keeps its original `brave` label rather than falsely attributing it to Firecrawl. Legacy cache entries remain until TTL cleanup but cannot match the Firecrawl/version/result-limit cache namespace. The obsolete legacy rate-limit setting is removed. Compatibility mentions are confined to migration documentation, SQL and the legacy-data test. No Brave adapter, fallback, runtime key read or mandatory application dependency remains.

The cloud draft API only adds secret requirements; it cannot remove the previous `BRAVE_SEARCH_API_KEY` requirement. Remove that obsolete requirement and its API domain in environment settings. The draft save automatically retained `api.search.brave.com` because that requirement still exists; the obsolete dashboard domain was removed. The application does not need or read it. The saved Firecrawl API/docs destinations and requirement are draft changes only, not runtime activation or publication. Approved extraction domains also need outbound robots connectivity in restricted environments; add only sites you actually approve.

## Files and validation

Changed modules: `src/providers.js`, `src/discovery.js`, `src/db.js`, `src/evidence.js`, `src/server.js`, `src/notifications.js`; new `src/urls.js`, `src/provider-state.js`, `src/extraction.js` and migration `002_firecrawl.sql`. UI logic changes are in `public/app.js`; CSS/font assets are preserved. `robots-parser` and lockfile entries implement policy checks. Environment examples, README, research/delivery notes, provider/API/pipeline tests and browser QA are updated.

Run `npm test`, `npm run build`, `npm run backtest`, `npm run test:visual` and the production dependency audit listed in README. All automated provider/extraction inputs are clearly synthetic and isolated; they consume no Firecrawl credits and send no alerts. No TypeScript or dedicated lint script exists; formatting and production build checks supplement the test suite. Live search is now verified. Real permitted extraction and outbound delivery remain unverified.

Set `FIRECRAWL_API_KEY` securely, restart, verify one bounded search, inspect real health/usage, and approve specific domains only after checking their terms. Keep scanning and alerts disabled until account limits and evidence expectations are understood. Authoritative external history and marketplace checkout remain separate unfinished integrations.
