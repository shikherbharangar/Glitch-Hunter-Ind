import { iso, getSettings, budgetDayStart } from "./db.js";
export const activeProvider = "firecrawl";
export function requestAllowed(db, provider = activeProvider) {
  const settings = getSettings(db),
    health = db
      .prepare("SELECT * FROM provider_health WHERE provider=?")
      .get(provider);
  return (
    !(Date.parse(health?.blocked_until) > Date.now()) &&
    db
      .prepare(
        "SELECT COUNT(*) n FROM usage WHERE provider=? AND occurred_at>=?",
      )
      .get(provider, budgetDayStart()).n <
      (provider === "public_http"
        ? settings.historyDailyBudget
        : settings.dailyBudget)
  );
}
export function beginRequest(db, operation, provider = activeProvider) {
  const settings = getSettings(db);
  const row = db
    .prepare(
      "INSERT INTO usage(provider,occurred_at,cost,outcome,operation) VALUES(?,?,?,?,?)",
    )
    .run(
      provider,
      iso(),
      provider === "public_http"
        ? 0
        : operation === "search"
          ? settings.costPerSearch
          : settings.costPerScrape,
      "pending",
      operation,
    );
  db.prepare(
    "INSERT INTO provider_health(provider,last_request_at,last_outcome) VALUES(?,?,?) ON CONFLICT(provider) DO UPDATE SET last_request_at=excluded.last_request_at,last_outcome=COALESCE(provider_health.last_outcome,excluded.last_outcome)",
  ).run(provider, iso(), "pending");
  return Number(row.lastInsertRowid);
}
export function finishRequest(
  db,
  id,
  outcome,
  credits = null,
  { retryAfter = 0 } = {},
) {
  const at = iso();
  const provider =
    db.prepare("SELECT provider FROM usage WHERE id=?").get(id)?.provider ||
    activeProvider;
  db.prepare("UPDATE usage SET outcome=?,credits_used=? WHERE id=?").run(
    outcome,
    credits,
    id,
  );
  db.prepare(
    "INSERT INTO provider_health(provider,last_request_at,last_outcome) VALUES(?,?,?) ON CONFLICT(provider) DO UPDATE SET last_request_at=excluded.last_request_at,last_outcome=excluded.last_outcome",
  ).run(provider, at, outcome);
  if (outcome === "success")
    db.prepare(
      "UPDATE provider_health SET last_success_at=?,blocked_until=NULL,block_reason=NULL WHERE provider=?",
    ).run(at, provider);
  if (["RATE_LIMITED", "QUOTA_EXHAUSTED"].includes(outcome))
    db.prepare(
      "UPDATE provider_health SET blocked_until=?,block_reason=? WHERE provider=?",
    ).run(
      new Date(
        Date.now() +
          Math.max(retryAfter, outcome === "QUOTA_EXHAUSTED" ? 3600 : 60) *
            1000,
      ).toISOString(),
      outcome,
      provider,
    );
}
