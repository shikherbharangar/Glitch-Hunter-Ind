# VIGIL 0.2: robust price anomaly model

Implementation: `src/vigil.js`, `src/robust-model.js`, `src/identity.js`. These are standard robust statistical techniques combined into a project-specific ranking model. There is no claim of new mathematics, empirical calibration or a trained detector. All prices are integer INR paise.

## Comparable evidence

History must predate the candidate, be at most 180 days old, have a positive full INR price, acceptable stock, reliability at least 0.6, and compatible identity. Conflicting variants are excluded. Retain one latest point per underlying source group per UTC day; repeated polls cannot increase independent history support. Current comparisons require a matching variant, independent seller and source group, in-stock full INR price and observation within one hour. Current sellers are excluded from their own comparison median.

Explicit model/configuration/bundle/condition/kind/pack conflicts block comparisons. Complete structured variants use the existing identity matcher. For incomplete retailer data, a title-specific URL hash permits only same-listing history. Unknown fields are not asserted to match across shops; unknown condition blocks priority classification. Checksum-valid GTINs plus explicit condition permit catalog matching, with brand and shared attribute conflicts still rejected. User-entered prices remain unvalidated and cannot reach priority confidence or provide trusted historical evidence.

## Robust historical standard price

Let `y_i = log(p_i)` and `t_i` be days since the earliest retained observation. Use weights

`w_i = sourceReliability_i * exp(-(candidateTime - observationTime_i)/(45 days))`.

With at least eight comparable source-days, fit a weighted Theil–Sen slope:

`b = weightedMedian((y_j-y_i)/(t_j-t_i), min(w_i,w_j))`,

using only pairs at least one day apart. Bound `b` to ±0.03 log units/day. Fit

`a = weightedMedian(y_i-b*t_i, w_i)`.

The fit uses the latest 180 source-days and at most 60 deterministic samples for the quadratic slope calculation. Prediction is `mu = a+b*t`, extrapolated at most two days after the latest point. A source's routine falling prices therefore need not look like a sudden glitch.

Estimate residual dispersion

`MAD = weightedMedian(abs(y_i-a-b*t_i),w_i)`;

`sigma = max(0.025,1.4826*MAD)`.

The historical standard is `round(exp(mu))`. The historical signal uses a conservative reference `round(exp(mu-1.645*sigma))`. That multiplier is a ranking heuristic, **not** a validated prediction interval. The sigma floor prevents zero spread from causing infinite statistics.

The one-sided robust deviation is `z=max(0,(mu-log(currentPrice))/sigma)`. The lower-tail history rank is `(1+count(historyPrice<=currentPrice))/(n+1)`; it is descriptive, not a calibrated p-value. A one-sided Page CUSUM accumulates negative detrended log-price residuals with drift allowance `0.5*sigma`, then includes the current residual. It is a change diagnostic, not a calibrated sequential hypothesis test.

## Independent seller standard and signals

The market standard is the reliability-weighted geometric median of qualifying independent offers. If both historical and market standards exist, use their **minimum** for the ordinary comparison reference, avoiding a stale high historical level dominating a newer cheaper market. A validated external historical low, if one was already legitimately recorded, retains separate precedence/provenance; this release adds no external history feed.

Let `clip` clamp to [0,1], `D(b)=max(0,log(b/currentPrice))`.

- **H:** `0.65*clip(D(conservativeHistory)/log(4)) + 0.35*clip((z-2)/6)*clip((1-currentPrice/historicalStandard)/0.4)`.
- **L:** `clip(D(validatedHistoricalLow)/log(5))`; unavailable without validated provenance.
- **M:** `clip(D(independentSellerStandard)/log(4))`; unavailable without a matching independent offer.
- **T:** maximum of the previous same-seller drop `clip(D(previousPrice)/log(5))` and `clip(CUSUM/(8*sigma))*clip((1-currentPrice/historicalStandard)/0.5)`.
- **R:** existing identity, condition, price, stock and freshness integrity check; cannot create severity alone.

Default weights remain H=.30, L=.25, M=.20, T=.20, R=.05. Available positive weights are renormalized; at least one price signal is required. Severity is the weighted mean multiplied by `100*(0.5+0.5*coverage)`.

Coverage is the maximum of the previous additive history/low/market/drop coverage, `0.9*min(independentOffers/3,1)`, and `0.85*hasEightSourceDays*min(historySpanDays/7,1)`. This lets sufficient independent live offers support a cold-start candidate without requiring every possible data source. One unsupported comparison cannot provide full coverage.

## Evidence index, separately from severity

`historySupport = hasEightSourceDays * min(n/16,1) * min(spanDays/7,1) * exp(-latestHistoryAge/(45 days))`.

`marketSupport = min(independentOffers/2,1)`.

`baselineSupport` is the minimum validated low-source quality, otherwise zero. `support = max(historySupport,marketSupport,baselineSupport)`.

With identity index i, current reliability r, freshness `f=exp(-observationAge/(one hour))`, and page/checkout verification v (page .75, checkout 1, other .2):

`confidence = 100*i*f*(.40*r + .35*support + .15*max(baselineSupport,min(independentOffers/3,1),historySupport*historyStability) + .10*v)`.

Historical zero raw MAD uses stability .75 and a further .95 score multiplier. Manual/unvalidated input is capped at 49; search-only input at 25. With no history, independent offer or validated low, confidence is capped at 25. Confidence expresses evidence support, **not** a calibrated probability. This avoids the old multiplicative reliability ceiling making every .65-reliability page impossible to classify at the default threshold, while retaining source and identity checks.

Priority classification requires both configured severity (default 75) and evidence (default 70), no rejected feedback, and no integrity blocks. Large anomalies with evidence at least 50 can be surfaced separately for review. Non-new or unknown condition, incomplete/conflicting identity, wrong currency, non-full price, out of stock, expired/unavailable or current observation older than one hour prevents priority classification. The auto collector requests a fresh check for priority candidates; notifications still need two fresh matching same-offer prices and opt-in delivery.

## Evaluation and limits

`npm test` covers anomaly magnitude, routine discounts, robust trend handling, outlier resistance, sparse history, unknown listing scopes, catalog matching, source independence, future leakage, repeated polls, budget separation, autonomous category-to-price flow and persistence. `npm run backtest` remains an explicitly labelled eight-case synthetic diagnostic with ablations, not a real-market accuracy study.

No labeled marketplace validation or calibration was performed. Source selection bias, missing shipping/eligibility details, merchant data errors, coordinated sellers, silent listing changes and incomplete histories remain material limitations. This model cannot compensate for unavailable prices. It neither invents backdated history nor uses MRP as a standard price. Buying and checkout confirmation remain manual.
