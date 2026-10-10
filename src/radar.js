import { assessListing } from "./assessment.js";
import { iso, getSettings, budgetDayStart } from "./db.js";
import { enqueueExtraction } from "./extraction.js";
export const categories = [
  {
    id: "fabrication",
    label: "3D printers & fabrication",
    queries: [
      "3D printer India buy price",
      "resin 3D printer India price",
      "laser engraver CNC India price",
    ],
  },
  {
    id: "computing",
    label: "Computers & components",
    queries: [
      "mini PC India buy price",
      "GPU graphics card India price",
      "NAS workstation India buy price",
    ],
  },
  {
    id: "imaging",
    label: "Cameras & lenses",
    queries: [
      "mirrorless camera India price",
      "camera lens India buy price",
      "action camera India price",
    ],
  },
  {
    id: "audio",
    label: "Audio equipment",
    queries: [
      "audio interface India buy price",
      "studio monitor India price",
      "headphones amplifier India price",
    ],
  },
  {
    id: "astronomy",
    label: "Telescopes & astronomy",
    queries: [
      "telescope India buy price",
      "astrophotography mount India price",
      "astronomy camera India price",
    ],
  },
  {
    id: "instruments",
    label: "Test instruments",
    queries: [
      "oscilloscope India buy price",
      "thermal camera India price",
      "laboratory microscope India price",
    ],
  },
  {
    id: "robotics",
    label: "Robotics & drones",
    queries: [
      "robotics development kit India price",
      "FPV drone goggles India price",
      "drone flight controller India price",
    ],
  },
  {
    id: "networking",
    label: "Networking & storage",
    queries: [
      "managed network switch India price",
      "NAS storage India price",
      "enterprise router India price",
    ],
  },
];
export function planRadar(db, enqueue, now = Date.now()) {
  const s = getSettings(db);
  const selectedLabels = categories
    .filter((c) => s.radarCategories.includes(c.id))
    .map((c) => c.label);
  if (!s.radarEnabled || !s.scrapeAllowedDomains.length) return;
  for (const category of categories.filter((x) =>
    s.radarCategories.includes(x.id),
  )) {
    const cycle = db
      .prepare("SELECT * FROM radar_cycles WHERE category_id=?")
      .get(category.id);
    if (
      cycle &&
      now - Date.parse(cycle.last_planned) < s.radarCycleMinutes * 60000
    )
      continue;
    const active = db
      .prepare(
        "SELECT 1 FROM jobs j JOIN queries q ON q.id=j.query_id WHERE q.category=? AND q.family='radar' AND j.status IN ('queued','running','retry')",
      )
      .get(category.label);
    if (active) continue;
    const round = cycle?.round || 0;
    const domains = s.scrapeAllowedDomains
      .filter((d) => d.length < 100)
      .slice(
        round % Math.max(1, s.scrapeAllowedDomains.length),
        (round % Math.max(1, s.scrapeAllowedDomains.length)) + 2,
      );
    const prefix = domains.length
      ? `(${domains.map((d) => "site:" + d).join(" OR ")}) `
      : "";
    try {
      enqueue(
        db,
        prefix + category.queries[round % category.queries.length],
        category.label,
        "radar",
      );
    } catch (e) {
      if (e.message === "QUEUE_FULL") break;
      throw e;
    }
    db.prepare(
      "INSERT INTO radar_cycles VALUES(?,?,?) ON CONFLICT(category_id) DO UPDATE SET last_planned=excluded.last_planned,round=excluded.round",
    ).run(category.id, new Date(now).toISOString(), round + 1);
  }
  // Track prices on a bounded set of previously identified products. These
  // observations persist after discovery-cache expiry and across deployments.
  for (const target of db
    .prepare(
      "SELECT * FROM radar_targets WHERE next_check<=? ORDER BY next_check",
    )
    .all(new Date(now).toISOString())
    .filter((t) => selectedLabels.includes(t.category))
    .slice(0, 3)) {
    if (!s.scrapeAllowedDomains.includes(new URL(target.url).hostname))
      continue;
    try {
      enqueueExtraction(db, target.url, target.category, { recheck: true });
    } catch (e) {
      if (e.code === "QUEUE_FULL") break;
      throw e;
    }
    db.prepare("UPDATE radar_targets SET next_check=? WHERE url=?").run(
      new Date(now + s.historyIntervalMinutes * 60000).toISOString(),
      target.url,
    );
  }
}
export function radarState(db, evidence = []) {
  const settings = getSettings(db);
  const historyUsage = db
    .prepare(
      "SELECT COUNT(*) requests FROM usage WHERE provider='public_http' AND occurred_at>=?",
    )
    .get(budgetDayStart()).requests;
  const labels = categories
    .filter((x) => settings.radarCategories.includes(x.id))
    .map((x) => x.label);
  const checks = db
    .prepare("SELECT * FROM extraction_jobs ORDER BY id DESC LIMIT 200")
    .all();
  const tracked = db
    .prepare(
      "SELECT t.*,l.title FROM radar_targets t JOIN observations o ON o.id=t.observation_id JOIN offers f ON f.id=o.offer_id JOIN listings l ON l.id=f.listing_id ORDER BY last_checked DESC LIMIT 100",
    )
    .all()
    .filter((x) => labels.includes(x.category));
  const leads = db
    .prepare(
      "SELECT sr.*,q.category FROM search_results sr JOIN queries q ON q.id=sr.query_id WHERE sr.expires_at>? AND q.family IN ('radar','comparison','observed_product') ORDER BY sr.observed_at DESC LIMIT 200",
    )
    .all(iso())
    .filter((x) => labels.includes(x.category));
  const seen = new Set();
  const products = [...tracked, ...leads]
    .filter((x) => {
      if (seen.has(x.url)) return false;
      seen.add(x.url);
      return true;
    })
    .map((x) => {
      const assessment = assessListing(x.url, {
        candidates: evidence,
        extractions: checks,
        settings,
      });
      const candidate = evidence.find((c) => c.url === x.url);
      return {
        url: x.url,
        title: x.title,
        category: x.category,
        assessment,
        observedAt: candidate?.observed_at || null,
        historyPoints: candidate?.result.statistics.n || 0,
        history: candidate?.result.mathematics?.forecast || null,
        dropFraction: candidate?.result.mathematics?.dropFraction ?? null,
        marketPricePaise: candidate?.result.mathematics?.marketPaise ?? null,
      };
    })
    .filter(
      (x) =>
        !x.assessment.pricePaise ||
        Math.max(x.assessment.pricePaise, x.assessment.referencePaise || 0) >=
          settings.radarMinPricePaise,
    );
  products.sort(
    (a, b) =>
      Number(b.assessment.status === "possible_glitch") -
        Number(a.assessment.status === "possible_glitch") ||
      (b.assessment.severity || 0) - (a.assessment.severity || 0) ||
      (b.assessment.confidence || 0) - (a.assessment.confidence || 0),
  );
  return {
    products,
    categories,
    enabled: settings.radarEnabled,
    selected: settings.radarCategories,
    trackedProducts: db.prepare("SELECT COUNT(*) n FROM radar_targets").get().n,
    collectedPrices: db
      .prepare(
        "SELECT COUNT(*) n FROM observations WHERE provider IN ('firecrawl','public_http')",
      )
      .get().n,
    historyRequests: historyUsage,
    historyDailyBudget: settings.historyDailyBudget,
    historyProvider: "Public product pages + persistent local history",
    lastScan: db
      .prepare("SELECT MAX(last_planned) value FROM radar_cycles")
      .get().value,
    cycles: db.prepare("SELECT * FROM radar_cycles").all(),
    now: iso(),
  };
}
