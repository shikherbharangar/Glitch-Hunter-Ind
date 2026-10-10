import { robustDiagnostics } from "./robust-model.js";
import { identity } from "./identity.js";
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((a, b) => a - b),
    k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};
export const defaultWeights = { H: 0.3, L: 0.25, M: 0.2, T: 0.2, R: 0.05 };
export function score({
  current,
  history = [],
  baselines = [],
  offers = [],
  now = Date.now(),
  weights = defaultWeights,
}) {
  const p = current.price_paise,
    time = Date.parse(current.observed_at),
    reasons = [];
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(time))
    throw new Error("INVALID_OBSERVATION");
  const comparisonAudit = [
    ...history.map((h) => ({ kind: "history", h })),
    ...offers.map((h) => ({ kind: "offer", h })),
  ].map(({ kind, h }) => ({
    kind,
    sourceRef: h.source_ref || null,
    observedAt: h.observed_at,
    ...identity(current.attributes, h.attributes),
  }));
  const valid = history.filter(
    (h) =>
      h.price_paise > 0 &&
      Date.parse(h.observed_at) < time &&
      Date.parse(h.observed_at) >= time - 180 * 86400000 &&
      h.currency === "INR" &&
      h.price_type === "full" &&
      h.stock !== "out_of_stock" &&
      h.reliability >= 0.6 &&
      !h.quality?.includes("VARIANT_CONFLICT") &&
      !identity(current.attributes, h.attributes).blocked,
  );
  // One point per underlying source per UTC day prevents polling-frequency inflation.
  const buckets = new Map();
  for (const h of valid.sort((a, b) =>
    a.observed_at.localeCompare(b.observed_at),
  ))
    buckets.set(`${h.source_group}:${h.observed_at.slice(0, 10)}`, h);
  const hist = [...buckets.values()],
    logs = hist.map((h) => Math.log(h.price_paise)),
    m = median(logs),
    mad = m == null ? null : median(logs.map((x) => Math.abs(x - m)));
  const match = identity(current.attributes, current.attributes),
    i = match.confidence;
  if (match.blocked) reasons.push("IDENTITY_INCOMPLETE");
  if (current.quality?.includes("VARIANT_CONFLICT"))
    reasons.push("VARIANT_CONFLICT");
  if (current.attributes.condition !== "new") reasons.push("CONDITION_NOT_NEW");
  if (current.price_type !== "full") reasons.push("NOT_FULL_PRICE");
  if (current.currency !== "INR") reasons.push("CURRENCY_MISMATCH");
  if (current.stock === "out_of_stock") reasons.push("OUT_OF_STOCK");
  if (["EXPIRED", "UNAVAILABLE"].includes(current.purchase_status))
    reasons.push(current.purchase_status);
  const age = Math.max(0, now - time),
    f = Math.exp(-age / 3_600_000);
  if (age > 3_600_000) reasons.push("STALE_OBSERVATION");
  const trusted = baselines.filter(
    (b) =>
      b.kind === "trusted_external_low" &&
      b.validated &&
      b.price_paise > 0 &&
      b.quality >= 0.8 &&
      Date.parse(b.observed_at) < time,
  );
  const low = trusted.length
      ? Math.min(...trusted.map((b) => b.price_paise))
      : null,
    scanner = hist.length ? Math.min(...hist.map((h) => h.price_paise)) : null;
  const u =
    hist.length >= 8
      ? (1 + hist.filter((h) => h.price_paise <= p).length) / (hist.length + 1)
      : null;
  const zr =
    hist.length >= 8 && mad > 0.015 ? (Math.log(p) - m) / (1.4826 * mad) : null;
  const logDrop = (b) => (b == null ? null : Math.max(0, Math.log(b / p)));
  const groups = new Map(),
    sellers = new Set([String(current.seller).toLowerCase().trim()]);
  for (const o of [...offers].sort((a, b) =>
    b.observed_at.localeCompare(a.observed_at),
  )) {
    if (
      !groups.has(o.source_group) &&
      !sellers.has(String(o.seller).toLowerCase().trim()) &&
      o.source_group !== current.source_group &&
      o.seller !== current.seller &&
      o.stock === "in_stock" &&
      o.reliability >= 0.6 &&
      o.price_paise > 0 &&
      o.price_type === "full" &&
      o.currency === "INR" &&
      Date.parse(o.observed_at) <= now &&
      now - Date.parse(o.observed_at) < 3_600_000 &&
      !identity(current.attributes, o.attributes).blocked
    ) {
      groups.set(o.source_group, o);
      sellers.add(String(o.seller).toLowerCase().trim());
    }
  }
  const independent = [...groups.values()],
    c = independent.length
      ? Math.exp(median(independent.map((o) => Math.log(o.price_paise))))
      : null;
  const previous = valid
    .filter(
      (h) =>
        h.seller === current.seller &&
        time - Date.parse(h.observed_at) <= 7 * 86400000,
    )
    .at(-1);
  const robust = robustDiagnostics({
    price: p,
    history: hist,
    independent,
    at: time,
  });
  const signals = {
    H: robust.historicalSignal,
    L: low == null ? null : clamp(logDrop(low) / Math.log(5)),
    M: robust.marketSignal,
    T:
      previous || robust.temporalSignal != null
        ? Math.max(
            previous ? clamp(logDrop(previous.price_paise) / Math.log(5)) : 0,
            robust.temporalSignal || 0,
          )
        : null,
    R: !match.blocked && !reasons.length ? 1 : 0,
  };
  const entries = Object.entries(signals).filter(([, v]) => v != null),
    total = entries.reduce((s, [k]) => s + (weights[k] || 0), 0);
  const evidenceCoverage = Math.max(
    Math.min(independent.length / 3, 1) * 0.9,
    (hist.length >= 8 ? 0.85 : 0) *
      Math.min((robust.forecast?.spanDays || 0) / 7, 1),
    (hist.length >= 8 ? 0.35 : (hist.length / 8) * 0.35) +
      (low ? 0.3 : 0) +
      (independent.length ? Math.min(independent.length / 3, 1) * 0.25 : 0) +
      (previous ? 0.1 : 0),
  );
  const severity =
    total && entries.some(([k]) => k !== "R" && weights[k] > 0)
      ? ((100 * entries.reduce((s, [k, v]) => s + v * (weights[k] || 0), 0)) /
          total) *
        (0.5 + 0.5 * evidenceCoverage)
      : 0;
  const q = low
    ? Math.min(...trusted.map((b) => b.quality))
    : hist.length
      ? Math.min(0.65, (hist.length / 30) * 0.65)
      : 0;
  const n = new Set([
    current.source_group,
    ...hist.map((h) => h.source_group),
    ...groups.keys(),
  ]).size;
  const a = independent.length
    ? independent.filter((o) => o.price_paise > p * 1.3).length /
      independent.length
    : 0;
  const v =
    {
      SEARCH_RESULT_OBSERVED: 0.05,
      PRODUCT_PAGE_OBSERVED: 0.5,
      CART_PRICE_OBSERVED: 0.75,
      CHECKOUT_VERIFIED: 1,
      MANUAL_CHECKOUT_REQUIRED: 0.2,
    }[current.purchase_status] || 0;
  const historyStability = mad === 0 ? 0.75 : 1;
  const historySupport =
    hist.length >= 8
      ? Math.min(hist.length / 16, 1) *
        Math.min((robust.forecast?.spanDays || 0) / 7, 1) *
        Math.exp(
          -Math.max(0, time - Date.parse(robust.forecast?.latest)) /
            (45 * 86400000),
        )
      : 0;
  const marketSupport = Math.min(independent.length / 2, 1);
  const baselineSupport = low ? Math.min(...trusted.map((b) => b.quality)) : 0;
  const support = Math.max(historySupport, marketSupport, baselineSupport);
  let confidence =
    100 *
    i *
    f *
    (0.4 * clamp(current.reliability) +
      0.35 * support +
      0.15 *
        Math.max(
          baselineSupport,
          Math.min(independent.length / 3, 1),
          historySupport * historyStability,
        ) +
      0.1 *
        (current.purchase_status === "CHECKOUT_VERIFIED"
          ? 1
          : current.purchase_status === "PRODUCT_PAGE_OBSERVED"
            ? 0.75
            : 0.2));
  confidence *= mad === 0 ? 0.95 : 1;
  if (!hist.length && !independent.length && !low)
    confidence = Math.min(confidence, 25);
  if (
    current.provider === "manual" ||
    current.quality?.includes("USER_ENTERED_UNVALIDATED")
  )
    confidence = Math.min(confidence, 49);
  if (current.purchase_status === "SEARCH_RESULT_OBSERVED")
    confidence = Math.min(confidence, 25);
  const blocked = reasons.some((r) =>
    [
      "IDENTITY_INCOMPLETE",
      "VARIANT_CONFLICT",
      "CONDITION_NOT_NEW",
      "NOT_FULL_PRICE",
      "CURRENCY_MISMATCH",
      "OUT_OF_STOCK",
      "EXPIRED",
      "UNAVAILABLE",
      "STALE_OBSERVATION",
    ].includes(r),
  );
  if (hist.length < 8) reasons.push("INSUFFICIENT_HISTORY");
  if (mad === 0) reasons.push("ZERO_MAD");
  if (!low) reasons.push("NO_TRUSTED_HISTORICAL_LOW");
  if (!independent.length) reasons.push("NO_INDEPENDENT_OFFERS");
  if (current.purchase_status !== "CHECKOUT_VERIFIED")
    reasons.push("MANUAL_CHECKOUT_REQUIRED");
  const reference = low ?? robust.referencePaise;
  return {
    model: "VIGIL-0.2",
    evaluatedAt: new Date(now).toISOString(),
    severity: Math.round(severity),
    confidence: Math.round(confidence),
    identity: match,
    comparisonAudit,
    expectedValue:
      reference == null
        ? null
        : {
            savingPaise: Math.max(0, Math.round(reference - p)),
            referencePaise: Math.round(reference),
            provenance: low ? "trusted_external_low" : robust.referenceKind,
            realizationProbability: null,
          },
    purchaseStatus: current.purchase_status,
    blocked,
    reasons,
    signals,
    mathematics: robust,
    statistics: {
      n: hist.length,
      u,
      zr,
      mad,
      typicalPaise:
        robust.forecast?.typicalPaise ??
        (m == null ? null : Math.round(Math.exp(m))),
      trustedLowPaise: low,
      scannerLowPaise: scanner,
      scannerLowBreach: logDrop(scanner),
      independentSources: n,
    },
    factors: {
      q,
      i,
      f,
      a,
      v,
      historyStability,
      evidenceCoverage,
      historySupport,
      marketSupport,
    },
    weights,
  };
}
