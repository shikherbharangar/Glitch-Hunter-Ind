import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, setSettings, iso } from "../src/db.js";
import {
  FirecrawlDiscovery,
  ProviderError,
  registry,
} from "../src/providers.js";
import { normalizeLead, publicUrl } from "../src/urls.js";
import {
  extractStructuredObservation,
  robotsAllowed,
  enqueueExtraction,
  runExtraction,
} from "../src/extraction.js";
import { enqueue, Scheduler, cacheKey, queryKey } from "../src/discovery.js";
import {
  beginRequest,
  finishRequest,
  requestAllowed,
} from "../src/provider-state.js";
import { candidates, ingest } from "../src/evidence.js";
import { notifyCandidate } from "../src/notifications.js";
import { manualInput } from "./fixtures.js";
const url = "https://shop.example.com/products/synthetic-printer?colour=black";
const product = () => ({
  "@type": "Product",
  name: "SYNTHETIC TEST printer",
  brand: { name: "Synthetic" },
  model: "QA100",
  color: "black",
  additionalProperty: Object.entries({
    bundle: "printer only",
    capacity: "none",
    generation: "first",
    kind: "printer",
    packcount: "1",
  }).map(([name, value]) => ({ name, value })),
  offers: {
    "@type": "Offer",
    url,
    price: "4999.00",
    priceCurrency: "INR",
    seller: { name: "Synthetic Seller" },
    availability: "https://schema.org/InStock",
    itemCondition: "https://schema.org/NewCondition",
  },
});
const document = (p = product(), sourceURL = url) => ({
  html: `<script type="application/ld+json">${JSON.stringify(p)}</script>`,
  metadata: { sourceURL, statusCode: 200 },
  retrievedAt: iso(),
  creditsUsed: 1,
});
const response = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
const configuredDb = () => {
  const db = openDb(":memory:");
  setSettings(db, {
    scrapeAllowedDomains: ["shop.example.com"],
    intervalSeconds: 0,
  });
  return db;
};
test("v2 search contract, broad sites, canonical dedup and provenance, never observations", async () => {
  let captured;
  const provider = new FirecrawlDiscovery({
    key: "synthetic-test-only",
    fetchImpl: async (u, o) => {
      captured = { u, o, body: JSON.parse(o.body) };
      return response({
        success: true,
        creditsUsed: 2,
        data: {
          web: [
            {
              url,
              title: "SYNTHETIC",
              description: "₹99 snippet",
              position: 1,
            },
            { url: url + "&utm_source=test" },
            { url: "https://www.amazon.in/dp/B012345678", title: "Amazon" },
            {
              url: "https://www.flipkart.com/item/p/itmabc?pid=ABC123",
              title: "Flipkart",
            },
          ],
        },
      });
    },
  });
  const r = await provider.search("robotics kit India", {
    limit: 4,
    timeoutMs: 1000,
  });
  assert.equal(captured.u, "https://api.firecrawl.dev/v2/search");
  assert.equal(captured.o.headers.Authorization, "Bearer synthetic-test-only");
  assert.deepEqual(captured.body, {
    query: "robotics kit India",
    sources: ["web"],
    country: "IN",
    limit: 4,
    timeout: 1000,
    ignoreInvalidURLs: true,
  });
  assert.equal(captured.o.redirect, "error");
  assert.ok(captured.o.signal);
  assert.equal(r.results.length, 3);
  assert.equal(r.results[0].sourceDomain, "shop.example.com");
  assert.equal(r.results[0].marketplace, "other");
  assert.equal(r.results[0].provider, "firecrawl");
  assert.equal(r.creditsUsed, 2);
  assert.equal(r.results[0].description, "₹99 snippet");
  assert.equal(r.results[0].pricePaise, undefined);
  const db = configuredDb();
  setSettings(db, { scanEnabled: true });
  const queued = enqueue(db, "robotics kit India");
  const scheduler = new Scheduler(db, { provider });
  await scheduler.tick();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM observations").get().n, 0);
  const saved = db
    .prepare("SELECT * FROM search_results ORDER BY id LIMIT 1")
    .get();
  assert.equal(saved.source_domain, "shop.example.com");
  assert.equal(saved.provider, "firecrawl");
  assert.equal(JSON.parse(saved.provider_metadata).position, 1);
  assert.equal(saved.original_url, url);
  assert.ok(saved.observed_at);
  assert.equal(
    db.prepare("SELECT credits_used FROM usage").get().credits_used,
    2,
  );
  assert.equal(
    db.prepare("SELECT status FROM jobs WHERE id=?").get(queued.id).status,
    "done",
  );
  db.close();
});
test("lead safety rejects local addresses and retains exact variant queries", () => {
  for (const unsafe of [
    "http://shop.example.com/a",
    "https://127.0.0.1/a",
    "https://[::1]/a",
    "https://localhost/a",
    "https://foo.local/a",
    "https://user:pass@shop.example.com/a",
    "javascript:alert(1)",
    "https://shop.example.com:8443/a",
  ])
    assert.equal(publicUrl(unsafe), null, unsafe);
  const lead = normalizeLead({
    url: url + "&utm_source=x#tracking",
    markdown: "page",
  });
  assert.equal(lead.url, url);
  assert.match(lead.originalUrl, /utm_source/);
  assert.equal(lead.content, "page");
  assert.equal(
    normalizeLead({ url: "https://amazon.in.evil.com/item" }).marketplace,
    "other",
  );
});
for (const [status, code] of [
  [401, "PROVIDER_ACCESS_DENIED"],
  [403, "PROVIDER_ACCESS_DENIED"],
  [402, "QUOTA_EXHAUSTED"],
  [429, "RATE_LIMITED"],
  [503, "PROVIDER_TRANSIENT_ERROR"],
])
  test(`provider HTTP ${status} is safe ${code}`, async () => {
    const p = new FirecrawlDiscovery({
      key: "never-return-this",
      fetchImpl: async () =>
        response({ error: "never-return-this upstream detail" }, status, {
          "retry-after": "120",
        }),
    });
    await assert.rejects(
      p.search("test"),
      (e) =>
        e.code === code &&
        e.retryAfter === 120 &&
        !e.message.includes("never-return-this"),
    );
  });
test("missing credentials, malformed JSON/envelope and network failures are explicit", async () => {
  let calls = 0;
  const absent = new FirecrawlDiscovery({
    key: "",
    fetchImpl: async () => {
      calls++;
    },
  });
  await assert.rejects(absent.search("test"), { code: "CREDENTIALS_MISSING" });
  assert.equal(calls, 0);
  for (const body of [
    { success: false, data: {} },
    { success: true, data: {} },
    { success: true, data: { web: [null] } },
  ])
    await assert.rejects(
      new FirecrawlDiscovery({
        key: "test",
        fetchImpl: async () => response(body),
      }).search("test"),
      { code: "PROVIDER_RESPONSE_INVALID" },
    );
  await assert.rejects(
    new FirecrawlDiscovery({
      key: "test",
      fetchImpl: async () => new Response("invalid"),
    }).search("test"),
    { code: "PROVIDER_RESPONSE_INVALID" },
  );
  await assert.rejects(
    new FirecrawlDiscovery({
      key: "test",
      fetchImpl: async () => {
        throw new Error("secret");
      },
    }).search("test"),
    { code: "PROVIDER_TIMEOUT_OR_NETWORK" },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new FirecrawlDiscovery({
      key: "test",
      fetchImpl: async () => {
        throw Error("aborted");
      },
    }).search("test", { signal: controller.signal }),
    { code: "CANCELLED" },
  );
});
test("scrape uses basic proxy with no actions, login or anti-bot bypass", async () => {
  let body;
  const p = new FirecrawlDiscovery({
    key: "test",
    fetchImpl: async (u, o) => {
      assert.equal(u, "https://api.firecrawl.dev/v2/scrape");
      body = JSON.parse(o.body);
      return response({
        success: true,
        data: {
          rawHtml: document().html,
          metadata: { sourceURL: url, statusCode: 200, creditsUsed: 1 },
        },
      });
    },
  });
  const d = await p.scrape(url);
  assert.deepEqual(body, {
    url,
    formats: ["rawHtml", "markdown"],
    onlyMainContent: false,
    proxy: "basic",
    maxAge: 0,
    storeInCache: false,
    timeout: 30000,
  });
  assert.equal(d.creditsUsed, 1);
  await assert.rejects(
    new FirecrawlDiscovery({
      key: "test",
      fetchImpl: async () =>
        response({
          success: true,
          data: {
            rawHtml: "x",
            metadata: {
              sourceURL: "https://other.example.com/a",
              statusCode: 200,
            },
          },
        }),
    }).scrape(url),
    { code: "REDIRECT_REQUIRES_REVIEW" },
  );
});
test("structured extraction requires explicit variant, offer, INR and seller", () => {
  const good = extractStructuredObservation(document(), { url });
  assert.equal(good.status, "product_page_observed");
  assert.equal(good.observation.pricePaise, 499900);
  assert.equal(good.observation.priceType, "full");
  assert.equal(good.observation.currency, "INR");
  for (const mutate of [
    (p) => delete p.model,
    (p) => (p.offers.priceCurrency = "USD"),
    (p) => delete p.offers.seller,
    (p) => (p.offers.price = "₹999 per month"),
    (p) => (p.offers.name = "EMI installment"),
    (p) => (p.offers.priceSpecification = { price: 99 }),
    (p) => (p.offers = [p.offers, { ...p.offers, price: 1 }]),
    (p) => delete p.additionalProperty,
    (p) => delete p.offers.availability,
    (p) => (p.offers.url = "https://shop.example.com/products/another"),
  ]) {
    const p = product();
    mutate(p);
    assert.equal(
      extractStructuredObservation(document(p), { url }).status,
      "unverified",
    );
  }
  assert.deepEqual(
    extractStructuredObservation(
      { ...document(), html: "captcha challenge" },
      { url },
    ).reasons,
    ["ACCESS_CONTROL_PAGE"],
  );
  assert.equal(
    extractStructuredObservation(document([product(), product()]), { url })
      .status,
    "unverified",
  );
  assert.equal(
    extractStructuredObservation(
      document(product(), "https://shop.example.com/products/another"),
      { url },
    ).status,
    "unverified",
  );
});
test("robots denial and unavailable policies fail closed before paid scraping", async () => {
  await assert.rejects(
    robotsAllowed(url, {
      fetchImpl: async () => new Response("User-agent: *\nDisallow: /products"),
    }),
    { code: "ROBOTS_DISALLOWED" },
  );
  await assert.rejects(
    robotsAllowed(url, {
      fetchImpl: async () => new Response("", { status: 403 }),
    }),
    { code: "ROBOTS_POLICY_UNAVAILABLE" },
  );
  assert.equal(
    await robotsAllowed(url, {
      fetchImpl: async () => new Response("", { status: 404 }),
    }),
    true,
  );
  const db = configuredDb();
  const queued = enqueueExtraction(db, url);
  let calls = 0;
  await runExtraction(
    db,
    db.prepare("SELECT * FROM extraction_jobs WHERE id=?").get(queued.id),
    {
      scrape: async () => {
        calls++;
      },
    },
    {
      robotsCheck: async () => {
        throw new ProviderError("ROBOTS_DISALLOWED");
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM usage").get().n, 0);
  assert.equal(
    db.prepare("SELECT error FROM extraction_jobs").get().error,
    "ROBOTS_DISALLOWED",
  );
  db.close();
});
test("explicit approved extraction persists observed evidence, shares budget and never checkout", async () => {
  const db = configuredDb();
  assert.throws(
    () => enqueueExtraction(db, "https://unapproved.example.com/item"),
    { code: "DOMAIN_NOT_APPROVED" },
  );
  const queued = enqueueExtraction(db, url);
  assert.equal(enqueueExtraction(db, url).deduplicated, true);
  await runExtraction(
    db,
    db.prepare("SELECT * FROM extraction_jobs WHERE id=?").get(queued.id),
    { scrape: async () => document() },
    { robotsCheck: async () => true },
  );
  const c = candidates(db)[0];
  assert.equal(c.provider, "firecrawl");
  assert.equal(c.purchase_status, "PRODUCT_PAGE_OBSERVED");
  assert.notEqual(c.result.purchaseStatus, "CHECKOUT_VERIFIED");
  assert.equal(c.price_paise, 499900);
  assert.equal(
    db.prepare("SELECT operation FROM usage").get().operation,
    "scrape",
  );
  assert.equal(enqueueExtraction(db, url).cached, true);
  assert.ok(enqueueExtraction(db, url, "Recheck", { recheck: true }).id);
  setSettings(db, { dailyBudget: 1 });
  assert.equal(requestAllowed(db), false);
  db.close();
});
test("health derives real successes, rate/quota blocks and configured failures", () => {
  const db = openDb(":memory:");
  assert.equal(registry(db, { key: "" })[0].status, "credentials_missing");
  assert.equal(
    registry(db, { key: "test" })[0].status,
    "configured_unverified",
  );
  finishRequest(db, beginRequest(db, "search"), "success", 2);
  assert.equal(registry(db, { key: "test" })[0].status, "operational");
  assert.ok(registry(db, { key: "test" })[0].lastDiscoveryAt);
  finishRequest(db, beginRequest(db, "scrape"), "PROVIDER_ACCESS_DENIED");
  assert.equal(registry(db, { key: "test" })[0].status, "configured_failing");
  finishRequest(db, beginRequest(db, "search"), "RATE_LIMITED", null, {
    retryAfter: 120,
  });
  assert.equal(registry(db, { key: "test" })[0].status, "rate_limited");
  assert.equal(requestAllowed(db), false);
  finishRequest(db, beginRequest(db, "search"), "QUOTA_EXHAUSTED");
  assert.equal(registry(db, { key: "test" })[0].status, "quota_exhausted");
  db.close();
});
test("schema v1 upgrade retains legacy rows, user settings and prevents old cache reuse", () => {
  const dir = mkdtempSync(join(tmpdir(), "ghi-migrate-")),
    path = join(dir, "db.sqlite");
  let db = new DatabaseSync(path);
  db.exec(
    readFileSync(
      new URL("../migrations/001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  db.prepare("INSERT INTO schema_migrations VALUES(1,?)").run(iso());
  const prior = ingest(db, manualInput());
  db.prepare(
    "INSERT INTO baselines(variant_id,kind,price_paise,source_ref,observed_at,quality,validated) VALUES(?,?,?,?,?,?,?)",
  ).run(
    db
      .prepare("SELECT variant_id FROM observations WHERE id=?")
      .get(prior.observationId).variant_id,
    "user_entered_unvalidated",
    2000000,
    "https://shop.example.com/history",
    iso(),
    0.3,
    0,
  );
  db.prepare(
    "INSERT INTO notifications(candidate_id,channel,fingerprint,status,created_at) VALUES(?,?,?,?,?)",
  ).run(prior.id, "synthetic", "preserved", "sent", iso());
  const preservedTables = [
    "products",
    "variants",
    "listings",
    "offers",
    "observations",
    "baselines",
    "candidates",
    "notifications",
  ];
  const before = Object.fromEntries(
    preservedTables.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]),
  );
  db.prepare(
    "INSERT INTO queries(normalized,query,category,family) VALUES(?,?,?,?)",
  ).run(queryKey("synthetic old"), "synthetic old", "Test", "custom");
  db.prepare(
    "INSERT INTO search_results(query_id,url,title,description,marketplace,observed_at,expires_at) VALUES(1,?,?,?,?,?,?)",
  ).run(
    url,
    "Legacy title",
    "Legacy description",
    "other",
    iso(),
    new Date(Date.now() + 3600000).toISOString(),
  );
  db.prepare(
    "INSERT INTO usage(provider,occurred_at,cost,outcome) VALUES(?,?,?,?)",
  ).run("brave", iso(), null, "success");
  db.prepare("INSERT INTO cache VALUES(?,?,?)").run(
    queryKey("synthetic old"),
    "[]",
    new Date(Date.now() + 3600000).toISOString(),
  );
  db.prepare("INSERT INTO settings VALUES(?,?)").run("severityThreshold", "82");
  db.prepare("INSERT INTO watchlist(label,query,created_at) VALUES(?,?,?)").run(
    "Keep me",
    "synthetic monitor",
    iso(),
  );
  db.close();
  db = openDb(path);
  for (const table of preservedTables)
    assert.deepEqual(
      db.prepare(`SELECT * FROM ${table}`).all(),
      before[table],
      table,
    );
  assert.equal(
    db.prepare("SELECT title FROM search_results").get().title,
    "Legacy title",
  );
  assert.equal(
    db.prepare("SELECT provider FROM search_results").get().provider,
    "legacy_search",
  );
  assert.equal(
    db.prepare("SELECT source_domain FROM search_results").get().source_domain,
    "shop.example.com",
  );
  assert.equal(
    db.prepare("SELECT provider FROM usage").get().provider,
    "brave",
  );
  assert.equal(
    db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get("severityThreshold").value,
    "82",
  );
  assert.equal(
    db.prepare("SELECT label FROM watchlist").get().label,
    "Keep me",
  );
  assert.ok(enqueue(db, "synthetic old").id);
  assert.match(cacheKey("a", { searchResultLimit: 10 }), /^firecrawl:v2:/);
  db.close();
  db = openDb(path);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n,
    2,
  );
  db.close();
  rmSync(dir, { recursive: true });
});
test("Firecrawl alert is withheld until a fresh matching observation rechecks the offer", async () => {
  const db = configuredDb();
  setSettings(db, {
    alertsEnabled: true,
    severityThreshold: 0,
    confidenceThreshold: 0,
  });
  const first = {
    ...manualInput(),
    url,
    observedAt: new Date(Date.now() - 1000).toISOString(),
  };
  ingest(db, first, {
    provider: "firecrawl",
    reliability: 0.65,
    purchaseStatus: "PRODUCT_PAGE_OBSERVED",
    sourceGroup: "synthetic",
  });
  let c = candidates(db)[0];
  c.result.blocked = false;
  let sends = 0;
  assert.deepEqual(
    await notifyCandidate(db, c, {
      senders: {
        test: async () => {
          sends++;
        },
      },
    }),
    [],
  );
  ingest(
    db,
    { ...first, observedAt: iso() },
    {
      provider: "firecrawl",
      reliability: 0.65,
      purchaseStatus: "PRODUCT_PAGE_OBSERVED",
      sourceGroup: "synthetic",
    },
  );
  c = candidates(db)[0];
  c.result.blocked = false;
  assert.deepEqual(
    await notifyCandidate(db, c, {
      senders: {
        test: async () => {
          sends++;
        },
      },
    }),
    ["test"],
  );
  assert.equal(sends, 1);
  db.close();
});
test("extraction queue recovers after restart, waits without key, and preserves cancellation", async () => {
  const db = configuredDb(),
    queued = enqueueExtraction(db, url);
  db.prepare("UPDATE extraction_jobs SET status='running' WHERE id=?").run(
    queued.id,
  );
  let calls = 0;
  const provider = {
    key: "",
    scrape: async () => {
      calls++;
      return document();
    },
  };
  const scheduler = new Scheduler(db, {
    provider,
    robotsCheck: async () => true,
  });
  scheduler.recover();
  await scheduler.tick();
  assert.equal(calls, 0);
  assert.equal(
    db.prepare("SELECT status FROM extraction_jobs").get().status,
    "retry",
  );
  provider.key = "synthetic";
  await scheduler.tick();
  assert.equal(calls, 1);
  assert.equal(
    db.prepare("SELECT status FROM extraction_jobs").get().status,
    "done",
  );
  const next = enqueueExtraction(db, url, "Recheck", { recheck: true }),
    controller = new AbortController();
  await runExtraction(
    db,
    db.prepare("SELECT * FROM extraction_jobs WHERE id=?").get(next.id),
    provider,
    {
      signal: controller.signal,
      robotsCheck: async () => {
        controller.abort();
        throw new Error("aborted");
      },
    },
  );
  assert.equal(
    db.prepare("SELECT status FROM extraction_jobs WHERE id=?").get(next.id)
      .status,
    "cancelled",
  );
  db.close();
});
test("ambiguous extracted page persists unverified without a price observation", async () => {
  const db = configuredDb(),
    queued = enqueueExtraction(db, url),
    p = product();
  delete p.offers.seller;
  await runExtraction(
    db,
    db.prepare("SELECT * FROM extraction_jobs WHERE id=?").get(queued.id),
    { scrape: async () => document(p) },
    { robotsCheck: async () => true },
  );
  const job = db.prepare("SELECT * FROM extraction_jobs").get();
  assert.equal(job.status, "unverified");
  assert.equal(JSON.parse(job.result).verification, "UNVERIFIED_PAGE");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM observations").get().n, 0);
  db.close();
});
