import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
export const budgetDayStart = (now = Date.now()) =>
  new Date(
    Math.floor((now + 19800000) / 86400000) * 86400000 - 19800000,
  ).toISOString();
export const iso = () => new Date().toISOString();
export function openDb(
  path = process.env.DATABASE_PATH || "data/glitch-hunter.sqlite",
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  for (const [version, file] of [
    [1, "001_initial.sql"],
    [2, "002_firecrawl.sql"],
    [3, "003_radar.sql"],
  ]) {
    if (
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=?").get(version)
    )
      continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(
        readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
      );
      if (version === 2) {
        for (const row of db
          .prepare("SELECT id,url FROM search_results")
          .all()) {
          let domain = null;
          try {
            domain = new URL(row.url).hostname;
          } catch {}
          db.prepare(
            "UPDATE search_results SET original_url=url,source_domain=? WHERE id=?",
          ).run(domain, row.id);
        }
      }
      db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
        version,
        iso(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      db.close();
      throw e;
    }
  }
  return db;
}
export const defaults = {
  severityThreshold: 75,
  confidenceThreshold: 70,
  dailyBudget: 50,
  intervalSeconds: 10,
  cacheMinutes: 60,
  scanEnabled: false,
  requestTimeoutMs: 30000,
  searchResultLimit: 10,
  scrapeAllowedDomains: [],
  costPerScrape: null,
  alertsEnabled: false,
  costPerSearch: null,
  radarEnabled: false,
  radarCategories: [
    "fabrication",
    "computing",
    "imaging",
    "audio",
    "astronomy",
    "instruments",
  ],
  radarCycleMinutes: 360,
  historyIntervalMinutes: 360,
  historyDailyBudget: 100,
  radarMinPricePaise: 1000000,
  maxTrackedProducts: 100,
  weights: { H: 0.3, L: 0.25, M: 0.2, T: 0.2, R: 0.05 },
};
export function getSettings(db) {
  return {
    ...defaults,
    ...Object.fromEntries(
      db
        .prepare("SELECT * FROM settings")
        .all()
        .map((r) => [r.key, JSON.parse(r.value)]),
    ),
  };
}
export function setSettings(db, values) {
  for (const [k, v] of Object.entries(values))
    db.prepare(
      "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(k, JSON.stringify(v));
  return getSettings(db);
}
