// VIGIL 0.2: robust diagnostics, not a calibrated error probability.
const clip = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export function weightedMedian(values) {
  const sorted = values
    .filter((x) => Number.isFinite(x.value) && x.weight > 0)
    .sort((a, b) => a.value - b.value);
  const half = sorted.reduce((sum, x) => sum + x.weight, 0) / 2;
  let weight = 0;
  for (const x of sorted) {
    weight += x.weight;
    if (weight >= half) return x.value;
  }
  return null;
}
export function historyForecast(history, at) {
  // Recent source-days only; deterministic sampling bounds quadratic fitting.
  const sorted = history
    .filter((h) => Date.parse(h.observed_at) < at && h.price_paise > 0)
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at))
    .slice(-180);
  if (sorted.length < 8) return null;
  const origin = Date.parse(sorted[0].observed_at);
  const points = sorted.map((h) => ({
    t: (Date.parse(h.observed_at) - origin) / 86400000,
    y: Math.log(h.price_paise),
    weight:
      clip(h.reliability) *
      Math.exp(-(at - Date.parse(h.observed_at)) / (45 * 86400000)),
  }));
  // Theil–Sen median slope resists isolated price spikes. Inter-day pairs avoid
  // interpreting contemporaneous seller differences as a temporal trend.
  const slopes = [];
  const sample = points.filter(
    (_, i) => i % Math.max(1, Math.ceil(points.length / 60)) === 0,
  );
  for (let i = 0; i < sample.length; i++)
    for (let j = i + 1; j < sample.length; j++)
      if (sample[j].t - sample[i].t >= 1)
        slopes.push({
          value: (sample[j].y - sample[i].y) / (sample[j].t - sample[i].t),
          weight: Math.min(sample[i].weight, sample[j].weight),
        });
  const slope = clip(weightedMedian(slopes) ?? 0, -0.03, 0.03);
  const intercept = weightedMedian(
    points.map((x) => ({ value: x.y - slope * x.t, weight: x.weight })),
  );
  const last = points.at(-1).t;
  // Extrapolation beyond two days is too speculative; freeze there.
  const t = Math.min((at - origin) / 86400000, last + 2);
  const center = intercept + slope * t;
  const mad = weightedMedian(
    points.map((x) => ({
      value: Math.abs(x.y - intercept - slope * x.t),
      weight: x.weight,
    })),
  );
  const sigma = Math.max(0.025, 1.4826 * mad);
  return {
    logPrice: center,
    typicalPaise: Math.round(Math.exp(center)),
    conservativePaise: Math.round(Math.exp(center - 1.645 * sigma)),
    logSigma: sigma,
    residualMAD: mad,
    trendPerDay: slope,
    points: points.length,
    spanDays: last,
    latest: sorted.at(-1).observed_at,
  };
}
export function robustDiagnostics({ price, history, independent, at }) {
  const forecast = historyForecast(history, at);
  const market = independent.length
    ? Math.round(
        Math.exp(
          weightedMedian(
            independent.map((o) => ({
              value: Math.log(o.price_paise),
              weight: o.reliability,
            })),
          ),
        ),
      )
    : null;
  const centers = [forecast?.typicalPaise, market].filter((x) => x > 0);
  const reference = centers.length ? Math.min(...centers) : null;
  const drop = reference ? Math.max(0, 1 - price / reference) : null;
  const z = forecast
    ? Math.max(0, (forecast.logPrice - Math.log(price)) / forecast.logSigma)
    : null;
  // One-sided Page CUSUM on recent detrended log-price residuals. This is a
  // change diagnostic with a fixed drift allowance, not a calibrated alarm.
  let negativeCUSUM = 0;
  if (forecast) {
    const recent = [...history]
      .sort((a, b) => a.observed_at.localeCompare(b.observed_at))
      .slice(-30);
    for (const h of recent) {
      const elapsed = (at - Date.parse(h.observed_at)) / 86400000;
      const expected = forecast.logPrice - forecast.trendPerDay * elapsed;
      const residual = Math.log(h.price_paise) - expected;
      negativeCUSUM = Math.max(
        0,
        negativeCUSUM - residual - 0.5 * forecast.logSigma,
      );
    }
    negativeCUSUM = Math.max(
      0,
      negativeCUSUM -
        (Math.log(price) - forecast.logPrice) -
        0.5 * forecast.logSigma,
    );
  }
  const rank =
    history.length >= 8
      ? (1 + history.filter((h) => h.price_paise <= price).length) /
        (history.length + 1)
      : null;
  const effect = (value) =>
    value == null ? null : clip(Math.log(value / price) / Math.log(4));
  return {
    forecast,
    marketPaise: market,
    referencePaise: reference,
    dropFraction: drop,
    robustZ: z,
    lowerTailRank: rank,
    changePointCUSUM: forecast ? negativeCUSUM / forecast.logSigma : null,
    temporalSignal: forecast
      ? clip(negativeCUSUM / (8 * forecast.logSigma)) *
        clip((1 - price / forecast.typicalPaise) / 0.5)
      : null,
    historicalSignal: forecast
      ? 0.65 * effect(forecast.conservativePaise) +
        0.35 *
          clip((z - 2) / 6) *
          clip((1 - price / forecast.typicalPaise) / 0.4)
      : null,
    marketSignal: market ? effect(market) : null,
    referenceKind:
      reference == null
        ? null
        : forecast && reference === forecast.typicalPaise
          ? "robust_history_forecast"
          : "independent_market_median",
  };
}
