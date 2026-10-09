import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, setSettings, getSettings } from "../src/db.js";
import { ingest, detail, candidates } from "../src/evidence.js";
import {
  enqueue,
  Scheduler,
  expand,
  queryKey,
  pruneCache,
} from "../src/discovery.js";
import { FirecrawlDiscovery, ProviderError } from "../src/providers.js";
import { notifyCandidate } from "../src/notifications.js";
import { scenario, manualInput } from "./fixtures.js";
import { score } from "../src/vigil.js";
test("migrations and observations persist after reopening database", () => {
  const dir = mkdtempSync(join(tmpdir(), "ghi-test-")),
    path = join(dir, "test.sqlite");
  let db = openDb(path);
  const a = ingest(db, manualInput());
  db.close();
  db = openDb(path);
  assert.equal(detail(db, a.id).current.price_paise, 499900);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n,
    2,
  );
  db.close();
  rmSync(dir, { recursive: true });
});
test("duplicate observations stay single and manual trust cannot escalate", () => {
  const db = openDb(":memory:"),
    d = manualInput();
  ingest(db, d);
  assert.ok(ingest(db, d).duplicate);
  const c = candidates(db)[0];
  assert.equal(db.prepare("SELECT COUNT(*) n FROM observations").get().n, 1);
  assert.ok(c.result.confidence < 50);
  assert.equal(c.result.purchaseStatus, "MANUAL_CHECKOUT_REQUIRED");
  db.close();
});
test("different bundles persist separately and listing mutation is flagged", () => {
  const db = openDb(":memory:"),
    d = manualInput();
  ingest(db, d);
  const r = ingest(db, {
    ...d,
    attributes: { ...d.attributes, bundle: "printer plus accessories" },
    observedAt: new Date(Date.now() + 1000).toISOString(),
  });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM variants").get().n, 2);
  assert.ok(r.result.reasons.includes("VARIANT_CONFLICT"));
  db.close();
});
test("atomic ingestion rolls back invalid data", () => {
  const db = openDb(":memory:");
  assert.throws(() => ingest(db, { ...manualInput(), pricePaise: -1 }));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM products").get().n, 0);
  db.close();
});
test("matching complete cross-market variants share a canonical record", () => {
  const db = openDb(":memory:"),
    d = manualInput();
  ingest(db, d);
  ingest(db, {
    ...d,
    url: "https://www.flipkart.com/synthetic/p/itmtest?pid=SYNTHETIC123",
    seller: "Second synthetic seller",
  });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM variants").get().n, 1);
  db.close();
});
test("query deduplication catches reordered terms", () => {
  const db = openDb(":memory:");
  const a = enqueue(db, "FPV   drone", "Flight");
  const b = enqueue(db, "drone fpv", "Flight");
  assert.equal(a.id, b.id);
  assert.ok(b.deduplicated);
  assert.equal(queryKey("FPV drone"), queryKey("drone fpv"));
  db.close();
});
test("observed titles expand to exact-model and variant families", () => {
  const q = expand({ title: "Synthetic SYN-300 3D printer" });
  assert.ok(q.some((x) => x.family === "model"));
  assert.ok(q.some((x) => x.family === "variant"));
});
test("successful search persists leads, cost, cache and recovery state", async () => {
  const db = openDb(":memory:");
  setSettings(db, { scanEnabled: true, costPerSearch: 0.005 });
  enqueue(db, "synthetic printer");
  const scheduler = new Scheduler(db, {
    provider: {
      key: "test",
      search: async () => [
        {
          title: "Synthetic SYN-300",
          url: "https://www.amazon.in/dp/B000TEST01",
          id: "B000TEST01",
          marketplace: "amazon",
          description: "Synthetic index result",
        },
      ],
    },
  });
  await scheduler.tick();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM search_results").get().n, 1);
  assert.ok(enqueue(db, "synthetic printer").cached);
  assert.equal(
    db.prepare("SELECT outcome FROM usage").get().outcome,
    "success",
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM observations").get().n, 0);
  db.close();
});
test("quota prevents requests", async () => {
  const db = openDb(":memory:");
  setSettings(db, { scanEnabled: true, dailyBudget: 0 });
  enqueue(db, "test query");
  let calls = 0;
  const s = new Scheduler(db, {
    provider: {
      key: "test",
      search: async () => {
        calls++;
        return [];
      },
    },
  });
  await s.tick();
  assert.equal(calls, 0);
  db.close();
});
test("429 respects Retry-After and counts failed request spend", async () => {
  const db = openDb(":memory:");
  setSettings(db, { scanEnabled: true });
  enqueue(db, "test query");
  const s = new Scheduler(db, {
    provider: {
      key: "test",
      search: async () => {
        throw new ProviderError("RATE_LIMITED", 120);
      },
    },
  });
  await s.tick();
  const j = db.prepare("SELECT * FROM jobs").get();
  assert.equal(j.status, "retry");
  assert.ok(Date.parse(j.run_at) > Date.now() + 110000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM usage").get().n, 1);
  db.close();
});
test("restart requeues interrupted work and cancellation persists", () => {
  const db = openDb(":memory:");
  const j = enqueue(db, "test query");
  db.prepare("UPDATE jobs SET status='running'").run();
  const s = new Scheduler(db);
  s.recover();
  assert.equal(db.prepare("SELECT status FROM jobs").get().status, "retry");
  s.cancel(j.id);
  assert.equal(db.prepare("SELECT status FROM jobs").get().status, "cancelled");
  db.close();
});
test("provider timeout and missing credentials remain explicit", async () => {
  await assert.rejects(
    new FirecrawlDiscovery({ key: "" }).search("test"),
    /CREDENTIALS_MISSING/,
  );
  await assert.rejects(
    new FirecrawlDiscovery({
      key: "test",
      fetchImpl: async () => {
        throw new Error("network");
      },
    }).search("test"),
    /PROVIDER_TIMEOUT_OR_NETWORK/,
  );
});
test("provider rate limit is surfaced with delay", async () => {
  await assert.rejects(
    new FirecrawlDiscovery({
      key: "test",
      fetchImpl: async () =>
        new Response("", { status: 429, headers: { "retry-after": "90" } }),
    }).search("test"),
    (e) => e.code === "RATE_LIMITED" && e.retryAfter === 90,
  );
});
test("alert deduplication and material price changes", async () => {
  const db = openDb(":memory:");
  const d = ingest(db, manualInput());
  setSettings(db, { alertsEnabled: true });
  const s = scenario(),
    c = { ...candidates(db)[0], id: d.id, result: score(s) };
  let calls = 0;
  const senders = {
    test: async (text) => {
      calls++;
      assert.match(text, /not a confirmed error/);
    },
  };
  await notifyCandidate(db, c, { senders });
  await notifyCandidate(db, c, { senders });
  assert.equal(calls, 1);
  await notifyCandidate(db, { ...c, price_paise: 10000 }, { senders });
  assert.equal(calls, 2);
  db.close();
});
test("expired candidate never notifies", async () => {
  const db = openDb(":memory:");
  ingest(db, manualInput());
  setSettings(db, { alertsEnabled: true });
  const s = scenario();
  s.current.purchase_status = "EXPIRED";
  let sent = false;
  await notifyCandidate(
    db,
    { ...candidates(db)[0], result: score(s) },
    {
      senders: {
        test: async () => {
          sent = true;
        },
      },
    },
  );
  assert.equal(sent, false);
  db.close();
});

test("rate limit stops all provider queries, not just the failed job", async () => {
  const db = openDb(":memory:");
  setSettings(db, { scanEnabled: true });
  enqueue(db, "first query");
  enqueue(db, "second query");
  let calls = 0;
  const s = new Scheduler(db, {
    provider: {
      key: "test",
      search: async () => {
        calls++;
        throw new ProviderError("RATE_LIMITED", 120);
      },
    },
  });
  await s.tick();
  s.lastRequest = 0;
  await s.tick();
  assert.equal(calls, 1);
  assert.ok(
    Date.parse(
      db
        .prepare(
          "SELECT blocked_until FROM provider_health WHERE provider='firecrawl'",
        )
        .get().blocked_until,
    ) > Date.now(),
  );
  db.close();
});
test("expired caches are removed from persistent storage", () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO cache VALUES(?,?,?)").run(
    "expired",
    "[]",
    "2020-01-01T00:00:00.000Z",
  );
  pruneCache(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cache").get().n, 0);
  db.close();
});

test("full queue cannot starve existing jobs when a new monitor is added", async () => {
  const db = openDb(":memory:");
  setSettings(db, { scanEnabled: true });
  for (let i = 0; i < 200; i++) enqueue(db, `synthetic query ${i}`);
  db.prepare("INSERT INTO watchlist(label,query,created_at) VALUES(?,?,?)").run(
    "Synthetic",
    "new monitor query",
    new Date().toISOString(),
  );
  let called = 0;
  const s = new Scheduler(db, {
    provider: {
      key: "test",
      search: async () => {
        called++;
        return [];
      },
    },
  });
  await s.tick();
  assert.equal(called, 1);
  db.close();
});

test("manual search runs with scheduling off, persists matches and reuses cache", async () => {
  const db = openDb(":memory:");
  let calls = 0;
  const scheduler = new Scheduler(db, {
    provider: {
      key: "test",
      search: async () => {
        calls++;
        return [
          {
            url: "https://shop.example.com/item",
            title: "Synthetic printer",
            description: "Test listing",
          },
        ];
      },
    },
  });
  assert.equal(getSettings(db).scanEnabled, false);
  const result = await scheduler.searchNow("synthetic printer India");
  assert.ok(result.queryId);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM search_results WHERE query_id=?")
      .get(result.queryId).n,
    1,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM jobs").get().n, 1);
  assert.equal(
    (await scheduler.searchNow("synthetic printer India")).cached,
    true,
  );
  assert.equal(calls, 1);
  assert.match(
    (await scheduler.searchNow("different printer India")).error,
    /wait/,
  );
  db.close();
});
test("manual search explains missing credentials and respects a running request", async () => {
  const db = openDb(":memory:");
  const scheduler = new Scheduler(db, { provider: { key: "" } });
  assert.match(
    (await scheduler.searchNow("printer India")).error,
    /FIRECRAWL_API_KEY/,
  );
  scheduler.provider.key = "test";
  scheduler.active = {};
  assert.match((await scheduler.searchNow("printer India")).error, /running/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM usage").get().n, 0);
  db.close();
});
