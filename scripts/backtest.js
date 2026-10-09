// Synthetic diagnostic cases, never a claim of real-market precision.
import { mkdirSync, writeFileSync } from "node:fs";
import { score, defaultWeights } from "../src/vigil.js";
import { scenario, attrs } from "../tests/fixtures.js";
const now = Date.parse("2026-10-09T12:00:00Z");
const cases = [
  ["extreme underpricing", true, (s) => s],
  [
    "ordinary discount",
    false,
    (s) => {
      s.current.price_paise = 2550000;
      return s;
    },
  ],
  [
    "accessory mismatch",
    false,
    (s) => {
      s.current.attributes.kind = "replacement nozzle";
      s.baselines = [];
      return s;
    },
  ],
  [
    "refurbished",
    false,
    (s) => {
      s.current.attributes.condition = "refurbished";
      s.baselines = [];
      return s;
    },
  ],
  [
    "wrong bundle",
    false,
    (s) => {
      s.current.attributes.bundle = "accessory-only";
      s.baselines = [];
      return s;
    },
  ],
  [
    "stale snippet",
    false,
    (s) => {
      s.current.observed_at = new Date(now - 86400000).toISOString();
      s.current.purchase_status = "SEARCH_RESULT_OBSERVED";
      return s;
    },
  ],
  [
    "no trustworthy history",
    false,
    (s) => {
      s.history = [];
      s.baselines = [];
      s.offers = [];
      return s;
    },
  ],
  [
    "disappeared on recheck",
    false,
    (s) => {
      s.current.purchase_status = "EXPIRED";
      return s;
    },
  ],
];
const ablations = {
  full: (s) => s,
  no_identity: (s) => {
    s.current.attributes = { ...attrs };
    s.history = s.history.map((h) => ({ ...h, attributes: { ...attrs } }));
    s.offers = s.offers.map((h) => ({ ...h, attributes: { ...attrs } }));
    return s;
  },
  no_historical_rarity: (s) => ({ ...s, weights: { ...defaultWeights, H: 0 } }),
  no_market_signal: (s) => ({
    ...s,
    offers: [],
    weights: { ...defaultWeights, M: 0 },
  }),
  no_temporal_signal: (s) => ({ ...s, weights: { ...defaultWeights, T: 0 } }),
  no_source_weighting: (s) => {
    s.current.reliability = 1;
    s.baselines = s.baselines.map((b) => ({ ...b, quality: 1 }));
    return s;
  },
};
const runs = Object.entries(ablations).map(([name, transform]) => {
  const results = cases.map(([label, positive, mutate]) => {
    const s = transform(mutate(scenario(now)));
    s.history = s.history.filter(
      (h) => Date.parse(h.observed_at) < Date.parse(s.current.observed_at),
    );
    const r = score(s);
    return {
      label,
      synthetic: true,
      positive,
      severity: r.severity,
      confidence: r.confidence,
      alert: !r.blocked && r.severity >= 75 && r.confidence >= 70,
      reasons: r.reasons,
    };
  });
  const tp = results.filter((r) => r.alert && r.positive).length,
    fp = results.filter((r) => r.alert && !r.positive).length,
    negative = results.filter((r) => !r.positive).length;
  return {
    name,
    precision: tp + fp ? tp / (tp + fp) : null,
    falsePositiveRate: fp / negative,
    alerts: tp + fp,
    results,
  };
});
const report = {
  dataset: "8 explicitly synthetic cases; no live marketplace data",
  cutoff: new Date(now).toISOString(),
  timeOrdered: true,
  trained: false,
  calibrated: false,
  limitations:
    "Case-level ablations, small hand-built sample, no tuning or statistical comparison. Identity ablation normalizes structured attributes; source ablation forces reliability and baseline quality to one. Remaining gates stay enabled.",
  metrics: {
    detectionDelay: null,
    candidateSurvival: null,
    checkoutConfirmationRate: null,
    costPerActionableCandidate: null,
    realCategoryCoverage: null,
    confidenceCalibration: null,
  },
  runs,
};
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/synthetic-evaluation.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      dataset: report.dataset,
      runs: runs.map(({ results, ...r }) => r),
      realWorldCalibration: "unavailable",
    },
    null,
    2,
  ),
);
if (!runs[0].results[0].alert || runs[0].results.slice(1).some((r) => r.alert))
  process.exitCode = 1;
