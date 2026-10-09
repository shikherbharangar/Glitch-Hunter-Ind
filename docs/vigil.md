# VIGIL 0.1: Variant-Integrity and Glitch Inference Layer

This is a project-specific model proposal using standard robust statistics, not a claim of unprecedented mathematics. Implementation: `src/vigil.js`. All INR amounts are integer paise. Output scores are uncalibrated rankings.

## Evidence selection and identity

The identity matcher checks model, GTIN, SKU, bundle, capacity, colour, generation, condition, kind and pack count. Any shared conflicting attribute yields confidence zero. Without a shared model/GTIN/SKU, confidence is 0.15. Otherwise `i = 0.7 + 0.3 * matchingAttributes/10`. Missing model, bundle, condition, kind or pack count caps i at 0.6. Values below 0.8 block alerts. Fuzzy titles are not used as proof.

Comparable historical observations must predate the candidate, match variant attributes, have positive full INR prices, reliability at least 0.6 and not be out of stock. One latest observation per source group per UTC day is retained for statistical counts. Repeated polling does not imply independent evidence. Current offers must match identity, be full INR prices, have reliability >=0.6, be in stock and within one hour. Offers from the candidate seller or source group are excluded; both seller and underlying source group are deduplicated.

Manual entries have reliability 0.5 and an unvalidated quality flag. They do not become trusted history. Trusted external lows require an internal validated source contract and quality >=0.8. The public baseline API cannot set validation flags. No operational external history adapter exists yet.

## Signals, each bounded in [0,1]

Let p be current price, m median(log history), MAD median absolute deviation of log history, n comparable source-days, and D(b)=max(0,log(b/p)). `clip` means clamp to [0,1].

- **H**: for n>=8, `u=(1+count(h<=p))/(n+1)`. If MAD>0.015, `zr=(log(p)-m)/(1.4826*MAD)`. H is `0.5*clip(-log10(u)/2)*clip(D(exp(m))/0.35) + 0.5*clip(-zr/8)`. The zr contribution is zero when spread is unstable; H is unavailable below eight observations. The magnitude term prevents a tiny lowest-ever movement receiving an extreme rarity score. u is a descriptive rank, not a precise event probability.
- **L**: `clip(D(trusted_low)/log(5))`. Unavailable without validated trusted low. The scanner low is reported separately and never labelled all-time low.
- **M**: `clip(D(exp(median(log(independent offers))))/log(5))`. Unavailable without qualifying independent offers.
- **T**: `clip(D(previous same-seller price)/log(5))`, using the latest comparable observation in the previous seven days. This is a bounded drop diagnostic, not a validated change-point model. Unavailable without prior comparable evidence.
- **R**: 1 if identity passes and there are no integrity/freshness rejection reasons; otherwise 0. It cannot create a severity score alone.

Default weights H=.30, L=.25, M=.20, T=.20, R=.05; configured weights are nonnegative and R<=.10. A price signal must have positive weight. Available weights are renormalized. Let coverage C be `0.35*min(n/8,1) + 0.30*hasTrustedLow + 0.25*min(independentOffers/3,1) + 0.10*hasPrevious`.

`severity = 100 * weightedAvailableMean * (0.5 + 0.5*C)`; severity is zero if no price signal is available. Missing evidence cannot earn full severity. The result stores signals, weights, median, MAD, u, zr and provenance so the ranking can be reproduced using the same evaluation time.

## Evidence confidence, separately

- q: minimum quality of qualifying trusted low sources, otherwise `min(0.65,n/30*0.65)` for scanner history, otherwise 0.
- i: explicit identity confidence above.
- f: `exp(-ageMilliseconds/3_600_000)` (one-hour exponential time constant, not half-life).
- a: fraction of independent qualifying offers >1.3p, otherwise 0.
- v: search result .05; product page .50; cart .75; checkout 1; manual required .20; all other states 0.
- r: current source reliability in [0,1].
- N: distinct underlying source groups across current/history/independent offers; repeated observations do not increase N.

`confidence = 100*i*f*r*historyStability*(.35*q + .20*min(N/3,1) + .15*a + .15*v + .15*min(n/30,1))`.

historyStability is 0.75 when historical MAD is zero, otherwise 1. A separate log scanner-low breach is reported as a diagnostic, never labelled an all-time low.

Search-result confidence is capped at 25. Missing sources, old observations and insufficient history lower confidence. This is evidence completeness/reliability scoring, not an empirically calibrated correctness probability.

## Value and purchase state

Potential saving is `max(0,reference-p)` with reference provenance, choosing trusted low, scanner median or independent current median in that order. It is **not monetary expected utility**: realization probability remains null because no cancellation/fulfilment model exists.

Purchase states are SEARCH_RESULT_OBSERVED, PRODUCT_PAGE_OBSERVED, CART_PRICE_OBSERVED, CHECKOUT_VERIFIED, MANUAL_CHECKOUT_REQUIRED, EXPIRED, UNAVAILABLE and UNKNOWN. Automated integrations do not open carts or private sessions. Manual ingestion creates MANUAL_CHECKOUT_REQUIRED; public review actions can mark expired or unavailable, but cannot fabricate checkout verification.

## Gates, ranking and evaluation

Identity incompleteness, conflicting listing configuration, non-new condition, non-full price, wrong currency, out-of-stock, expired/unavailable, or observation older than one hour suppress alerts. Confidence and severity must **both** meet configured thresholds (default 70 and 75). The UI defaults to evidence-first ordering. Feedback can reject a candidate and adjust yield statistics for queries associated with its listing.

`npm run backtest` evaluates eight labelled synthetic cases in chronological order; it never uses future observations for a baseline. It also performs identity, history-rarity, market, temporal and source-weight ablations. Identity ablation deliberately erases structured conflicts; source-weight ablation forces reliability to one. These diagnostics exercise gates; they are not a representative empirical study. Detection delay, survival, checkout confirmation, cost per actionable candidate, real category coverage and calibration stay null without observed labelled outcomes.

Failure modes: sparse/biased histories; stale index prices; coordinated sellers; aliases disguising common ownership; seller source-group misassignment; gradual model drift; incomplete bundles; conditional coupon/shipping differences; uncertain account eligibility. The temporal diagnostic is not a full sequential change-point detector. Weights remain provisional.
