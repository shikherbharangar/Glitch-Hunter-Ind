import { normalize } from "./identity.js";
import { iso, getSettings } from "./db.js";
import { FirecrawlDiscovery } from "./providers.js";
import { normalizeLead } from "./urls.js";
import {
  requestAllowed,
  beginRequest,
  finishRequest,
  activeProvider,
} from "./provider-state.js";
import { runExtraction } from "./extraction.js";
export const cacheKey = (normalized, settings) =>
  `${activeProvider}:v2:${settings.searchResultLimit}:${normalized}`;
export const seeds = [
  ["Fabrication", "3D printer price India"],
  ["Fabrication", "resin printer India"],
  ["Fabrication", "CNC laser engraver India"],
  ["Robotics", "robotics development kit India"],
  ["Flight", "FPV drone goggles India"],
  ["Flight", "drone flight controller India"],
  ["Astronomy", "telescope India"],
  ["Astronomy", "astrophotography mount India"],
  ["Instruments", "oscilloscope India"],
  ["Instruments", "thermal camera India"],
  ["Computing", "mini PC India"],
  ["Computing", "GPU workstation India"],
  ["Computing", "single board development kit India"],
  ["Imaging", "mirrorless camera lens India"],
  ["Audio", "audio interface India"],
  ["Field equipment", "GPS sports watch India"],
  ["Field equipment", "action camera India"],
  ["Collectibles", "LEGO Technic India"],
  ["Maker supplies", "3D printer filament India"],
  ["Flight", "FPV radio transmitter India"],
  ["Networking", "managed network switch India"],
  ["Storage", "NAS storage India"],
  ["Laboratory", "laboratory microscope India"],
  ["Precision tools", "digital micrometer India"],
  ["Industrial tools", "soldering rework station India"],
  ["Marketplace discovery", "site:amazon.in telescope India"],
  ["Marketplace discovery", "site:flipkart.com mini PC India"],
];
export function pruneCache(db) {
  const now = iso();
  db.prepare("DELETE FROM cache WHERE expires_at<=?").run(now);
  db.prepare("DELETE FROM search_results WHERE expires_at<=?").run(now);
}
export const queryKey = (q) =>
  normalize(q)
    .replace(/[^\p{L}\p{N}\s.-]/gu, "")
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
export function priority(q, { now = Date.now(), cost = 1 } = {}) {
  const runs = q.runs || 0,
    novel = (q.discoveries || 0) / (runs + 1),
    yieldRate = (q.useful || 0) / (runs + 1),
    bad = (q.false_positives || 0) / (runs + 1);
  const age = q.last_run
    ? Math.min((now - Date.parse(q.last_run)) / 86400000, 7)
    : 7;
  return (
    (2 * yieldRate +
      Math.log1p(novel) +
      age / 7 +
      2 / Math.sqrt(runs + 1) +
      Math.log1p((q.expected_value_paise || 0) / 100) / 10 +
      1 / Math.sqrt((q.category_runs || 0) + 1) -
      bad) /
    Math.max(cost, 0.001)
  );
}
export function enqueue(
  db,
  query,
  category = "Custom",
  family = "custom",
  kind = "discovery",
) {
  query = query.trim().replace(/\s+/g, " ");
  if (!query || query.length > 300 || query.split(" ").length > 40)
    throw new Error("INVALID_QUERY");
  const key = queryKey(query),
    settings = getSettings(db);
  db.prepare(
    "INSERT INTO queries(normalized,query,category,family) VALUES(?,?,?,?) ON CONFLICT(normalized) DO NOTHING",
  ).run(key, query, category, family);
  const q = db.prepare("SELECT * FROM queries WHERE normalized=?").get(key);
  const existing = db
    .prepare(
      "SELECT id FROM jobs WHERE query_id=? AND status IN ('queued','running','retry')",
    )
    .get(q.id);
  if (existing) return { id: existing.id, deduplicated: true };
  const cached = db
    .prepare("SELECT expires_at FROM cache WHERE key=?")
    .get(cacheKey(key, settings));
  if (cached && Date.parse(cached.expires_at) > Date.now())
    return { cached: true, expiresAt: cached.expires_at };
  if (
    db
      .prepare(
        "SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running','retry')",
      )
      .get().n >= 200
  )
    throw new Error("QUEUE_FULL");
  const r = db
    .prepare(
      "INSERT INTO jobs(query_id,kind,priority,run_at,created_at) VALUES(?,?,?,?,?)",
    )
    .run(
      q.id,
      kind,
      priority(q, { cost: settings.costPerSearch || 1 }) +
        (kind === "recheck" ? 10 : 0),
      iso(),
      iso(),
    );
  return { id: Number(r.lastInsertRowid), deduplicated: false };
}
export function expand(result) {
  const title = result.title
    .replace(/\b(?:Amazon\.in|Flipkart\.com)\b/gi, "")
    .replace(/[|:]/g, " ")
    .trim();
  const model = title.match(
    /\b(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9-]{3,20}\b/,
  )?.[0];
  const clean = title
    .replace(/[^\p{L}\p{N}\s.-]/gu, "")
    .split(/\s+/)
    .slice(0, 8)
    .join(" ");
  const categoryPhrase = clean
    .split(/\s+/)
    .filter((w) => w !== model && !/\d/.test(w))
    .slice(1, 5)
    .join(" ");
  const variants = [{ query: clean, family: "observed_product" }];
  if (categoryPhrase.length > 5)
    variants.push({
      query: categoryPhrase,
      family: "observed_category",
      category: "Inferred: " + categoryPhrase.slice(0, 65),
    });
  if (model) {
    variants.push(
      { query: `${title.split(/\s+/)[0]} ${model}`, family: "model" },
      { query: `${model} bundle capacity`, family: "variant" },
      { query: `${model} price offer`, family: "conflicting_offer" },
    );
  }
  return variants.filter((x) => x.query.length > 4 && x.query.length <= 300);
}
export class Scheduler {
  constructor(db, { provider = new FirecrawlDiscovery(), robotsCheck } = {}) {
    this.db = db;
    this.provider = provider;
    this.robotsCheck = robotsCheck;
    this.active = null;
    this.timer = null;
    this.lastRequest = 0;
    this.ticks = 0;
  }
  recover() {
    this.db
      .prepare(
        "UPDATE extraction_jobs SET status='retry',error='RESTART_RECOVERY',run_at=? WHERE status='running'",
      )
      .run(iso());
    this.db
      .prepare(
        "UPDATE jobs SET status='retry',error='RESTART_RECOVERY',run_at=? WHERE status='running'",
      )
      .run(iso());
  }
  start() {
    this.recover();
    this.timer = setInterval(
      () =>
        this.tick().catch(() =>
          console.error(
            JSON.stringify({ event: "scheduler_error", code: "INTERNAL" }),
          ),
        ),
      1000,
    );
    this.timer.unref();
  }
  async stop() {
    clearInterval(this.timer);
    this.active?.controller.abort();
    if (this.inflight) await this.inflight;
  }
  cancel(id) {
    this.db
      .prepare(
        "UPDATE jobs SET status='cancelled',finished_at=? WHERE id=? AND status IN ('queued','retry','running')",
      )
      .run(iso(), id);
    if (this.active?.kind !== "extraction" && this.active?.id === id)
      this.active.controller.abort();
  }
  async searchNow(query, category = "Custom") {
    const db = this.db,
      settings = getSettings(db),
      normalized = queryKey(query);
    const cached = db
      .prepare("SELECT expires_at FROM cache WHERE key=?")
      .get(cacheKey(normalized, settings));
    const existingQuery = db
      .prepare("SELECT id FROM queries WHERE normalized=?")
      .get(normalized);
    if (cached && Date.parse(cached.expires_at) > Date.now())
      return { queryId: existingQuery.id, cached: true };
    if (!this.provider.key)
      return {
        error: "Add FIRECRAWL_API_KEY in your hosting settings, then redeploy.",
      };
    if (this.active)
      return {
        error: "Another search is running. Please try again when it finishes.",
      };
    if (!requestAllowed(db))
      return {
        error:
          "Search is paused by the daily budget or provider limit. Check Settings and System health.",
      };
    const seconds = Math.ceil(
      (this.lastRequest + settings.intervalSeconds * 1000 - Date.now()) / 1000,
    );
    if (seconds > 0)
      return { error: `Please wait ${seconds} seconds before another search.` };
    const queued = enqueue(db, query, category, "manual");
    const job = db
      .prepare(
        "SELECT jobs.*,queries.query,queries.normalized,queries.category,queries.family FROM jobs JOIN queries ON queries.id=jobs.query_id WHERE jobs.id=?",
      )
      .get(queued.id);
    this.active = { id: job.id, controller: new AbortController() };
    this.lastRequest = Date.now();
    this.inflight = this.run(
      { ...job, family: "manual" },
      settings,
      this.active.controller.signal,
    );
    try {
      await this.inflight;
    } finally {
      this.active = null;
      this.inflight = null;
    }
    const outcome = db
      .prepare("SELECT status,error FROM jobs WHERE id=?")
      .get(job.id);
    return outcome.status === "done"
      ? { queryId: job.query_id, cached: false }
      : {
          error:
            "The search provider could not complete this search. Check your Firecrawl key and credits in System health.",
          code: outcome.error,
        };
  }
  async tick() {
    if (this.active) return;
    pruneCache(this.db);
    const settings = getSettings(this.db);
    if (!requestAllowed(this.db) || !this.provider.key) return;
    if (Date.now() - this.lastRequest < settings.intervalSeconds * 1000) return;
    const extraction = this.db
      .prepare(
        "SELECT * FROM extraction_jobs WHERE status IN ('queued','retry') AND run_at<=? ORDER BY id LIMIT 1",
      )
      .get(iso());
    if (extraction) {
      this.active = {
        id: extraction.id,
        kind: "extraction",
        controller: new AbortController(),
      };
      this.lastRequest = Date.now();
      this.inflight = runExtraction(this.db, extraction, this.provider, {
        signal: this.active.controller.signal,
        robotsCheck: this.robotsCheck,
      });
      try {
        await this.inflight;
      } finally {
        this.active = null;
        this.inflight = null;
      }
      return;
    }
    if (!settings.scanEnabled) return;
    // Explicit monitoring recurs; broad seeds are opt-in from the UI.
    for (const w of this.db.prepare("SELECT * FROM watchlist").all()) {
      try {
        enqueue(this.db, w.query, "Watchlist", "watchlist", "recheck");
      } catch (e) {
        if (e.message === "QUEUE_FULL") break;
        throw e;
      }
    }
    const jobs = this.db
      .prepare(
        "SELECT j.*,q.query,q.normalized,q.category,q.family,q.runs,q.discoveries,q.useful,q.false_positives,q.last_run,(SELECT SUM(q2.runs) FROM queries q2 WHERE q2.category=q.category) category_runs,(SELECT MAX(o.price_paise*o.reliability) FROM search_results sr JOIN listings l ON l.url=sr.url JOIN offers sf ON sf.listing_id=l.id JOIN observations o ON o.offer_id=sf.id WHERE sr.query_id=q.id) expected_value_paise FROM jobs j JOIN queries q ON q.id=j.query_id WHERE j.status IN ('queued','retry') AND j.run_at<=?",
      )
      .all(iso());
    if (!jobs.length) return;
    jobs.sort(
      (a, b) =>
        priority(b, { cost: settings.costPerSearch || 1 }) +
        (b.kind === "recheck" ? 10 : 0) -
        (priority(a, { cost: settings.costPerSearch || 1 }) +
          (a.kind === "recheck" ? 10 : 0)),
    );
    // Every fifth request explores the least-run query, retaining 20% exploration.
    const job =
      ++this.ticks % 5 === 0
        ? [...jobs].sort((a, b) => a.runs - b.runs || a.id - b.id)[0]
        : jobs[0];
    this.active = { id: job.id, controller: new AbortController() };
    this.lastRequest = Date.now();
    this.inflight = this.run(job, settings, this.active.controller.signal);
    try {
      await this.inflight;
    } finally {
      this.active = null;
      this.inflight = null;
    }
  }
  async run(job, settings, signal) {
    this.db
      .prepare(
        "UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=?",
      )
      .run(job.id);
    const use = beginRequest(this.db, "search");
    try {
      const payload = await this.provider.search(job.query, {
        signal,
        timeoutMs: settings.requestTimeoutMs,
        limit: settings.searchResultLimit,
      });
      const rawResults = Array.isArray(payload) ? payload : payload.results;
      const credits = Array.isArray(payload) ? null : payload.creditsUsed;
      if (!Array.isArray(rawResults))
        throw new Error("PROVIDER_RESPONSE_INVALID");
      const results = [
        ...new Map(
          rawResults
            .map((r) =>
              normalizeLead(
                { ...r, markdown: r.content },
                { retrievedAt: r.retrievedAt || iso() },
              ),
            )
            .filter(Boolean)
            .map((r) => [r.url, r]),
        ).values(),
      ];
      if (signal.aborted) {
        finishRequest(this.db, use, "CANCELLED");
        return;
      }
      const expires = new Date(
        Date.now() + settings.cacheMinutes * 60000,
      ).toISOString();
      let added = 0;
      for (const r of results) {
        const known = this.db
          .prepare("SELECT 1 FROM search_results WHERE url=?")
          .get(r.url);
        if (!known) added++;
        this.db
          .prepare(
            "INSERT INTO search_results(query_id,url,title,description,marketplace,marketplace_id,observed_at,expires_at,provider,original_url,source_domain,provider_metadata,extracted_content) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(query_id,url) DO UPDATE SET title=excluded.title,description=excluded.description,observed_at=excluded.observed_at,expires_at=excluded.expires_at,provider=excluded.provider,original_url=excluded.original_url,source_domain=excluded.source_domain,provider_metadata=excluded.provider_metadata,extracted_content=excluded.extracted_content",
          )
          .run(
            job.query_id,
            r.url,
            r.title,
            r.description,
            r.marketplace,
            r.id,
            r.retrievedAt,
            expires,
            r.provider,
            r.originalUrl,
            r.sourceDomain,
            JSON.stringify(r.metadata),
            r.content,
          );
      }
      this.db
        .prepare(
          "INSERT INTO cache VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET result=excluded.result,expires_at=excluded.expires_at",
        )
        .run(
          cacheKey(job.normalized, settings),
          JSON.stringify(results),
          expires,
        );
      this.db
        .prepare(
          "UPDATE queries SET runs=runs+1,discoveries=discoveries+?,last_run=? WHERE id=?",
        )
        .run(added, iso(), job.query_id);
      this.db
        .prepare(
          "UPDATE jobs SET status='done',error=NULL,finished_at=? WHERE id=?",
        )
        .run(iso(), job.id);
      finishRequest(this.db, use, "success", credits);
      if (job.family === "seed" || job.family === "custom")
        for (const r of results.slice(0, 3))
          for (const x of expand(r))
            try {
              enqueue(this.db, x.query, x.category || job.category, x.family);
            } catch (e) {
              if (e.message !== "QUEUE_FULL") throw e;
            }
    } catch (e) {
      const code = e.code || "PROVIDER_ERROR";
      finishRequest(this.db, use, code, null, e);
      if (signal.aborted) return;
      const terminal =
        [
          "CREDENTIALS_MISSING",
          "PROVIDER_ACCESS_DENIED",
          "QUOTA_EXHAUSTED",
          "INVALID_QUERY",
          "PROVIDER_RESPONSE_INVALID",
        ].includes(code) || job.attempts >= 3;
      const seconds =
        Math.max(e.retryAfter || 0, Math.min(3600, 30 * 2 ** job.attempts)) +
        Math.floor(Math.random() * 5);
      this.db
        .prepare(
          "UPDATE jobs SET status=?,error=?,run_at=?,finished_at=? WHERE id=?",
        )
        .run(
          terminal ? "failed" : "retry",
          code,
          new Date(Date.now() + seconds * 1000).toISOString(),
          terminal ? iso() : null,
          job.id,
        );
    }
  }
}
