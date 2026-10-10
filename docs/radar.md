# Category radar and price history

Open `/#radar`. Choose the tech categories you want to monitor, enter the **exact domains of retailers that permit these reads**, and press **Start category radar**. No individual search query is needed. The default focus is products with an observed or comparison price of at least ₹10,000; a very cheap anomaly remains visible if its comparison price is above that floor.

The radar rotates through category phrases every six hours. Discovery uses your existing Firecrawl subscription/key and bounded daily request budget. Up to three approved results per discovery are sent for public-page price collection. Observed models/GTINs generate bounded comparison searches. Search snippets and category-page price ranges are never ingested as product prices.

## History without another subscription

The default price reader directly fetches permitted public HTML using the GlitchHunterIndia user agent. It spends **zero Firecrawl credits** and needs **no Keepa key or history subscription**. Its separate limit defaults to 100 product-page reads per India calendar day, with at least the configured request interval between network jobs. Robots lookups also use public HTTP. Requests do not follow redirects, private DNS addresses are blocked at connection time, and page size/time are bounded. Captchas, private sessions and access restrictions are not bypassed.

Only explicit structured Product/Offer data is used: full INR price, stock, source URL, variant identifiers and condition. Marketplace sellers must be explicit. A retailer page with incomplete variant data can be tracked under a hash of its own URL and product name; the missing fields remain unknown. An incomplete retailer can use its exact source domain as a storefront identity, which is not a claim about its legal seller name. Unknown condition prevents priority classification. These pages cannot become a comparison baseline for a similar product elsewhere. A matching checksum-valid GTIN and explicit condition permit catalog-level comparisons; explicit attribute/brand conflicts still exclude a comparison. Complete structured variants retain the existing cross-market matching route.

The collector revisits up to 100 identified products every six hours while the radar is enabled, scoped to selected categories and approved domains. It saves observations in SQLite; rechecks and discovery cache expiry do not erase history. The Render persistent disk at `/app/data` must remain attached. Category selection, tracked targets and scheduling cycles also survive restart. Prices can only be collected while the service is awake and running.

**This collects history from now onward; it cannot retrieve past prices that were never recorded.** The app does not claim a free India-wide historical-price API or all-time-low coverage. Historical modelling starts with at least eight independent source-days. Before then, matching live offers from two or more independent sellers can provide a supported comparison. MRP and advertised discount percentages are not standard-price baselines.

## Reading the cards

- **Possible price glitch:** anomaly and evidence thresholds both pass; review checkout yourself.
- **Unusual price — needs more evidence:** large supported price movement, but evidence is below the priority threshold.
- **Price observed — glitch not established:** a price was collected but there is no sufficiently strong comparison yet.
- **Checking price / Could not assess:** queued work or an explicit source/access/data limitation.

Each card shows the observed price, historical standard estimate, independent seller standard, supporting source-days and anomaly/evidence scores. Price checks update the page automatically. Scan activity exposes failures and cancellations. Pause stops automatic discovery and recurring history collection; already queued page checks can finish.

Scores are provisional rankings, not a mathematical guarantee or calibrated probability of a pricing error. Current page prices are not checkout verification. Anomaly candidates are automatically requested for a fresh recheck. Automated notifications require two matching fresh same-offer observations within 15 minutes, score/integrity gates and explicitly enabled delivery.

## Deployment

Redeploy the latest `main` commit in Render. The database migration is additive and preserves earlier observations/settings. Keep your existing Firecrawl key, app token, origin configuration and persistent disk. No new secret is required. Open the site with `/#radar`; an old bookmark ending in `/#discover` still opens manual search.

If product pages are unavailable, inspect **Scan activity** for the exact reason. Direct collection requires working outbound HTTPS/DNS on the host and readable public product HTML. A blocked source or a site requiring browser execution remains unverified rather than silently switching to paid scraping.
