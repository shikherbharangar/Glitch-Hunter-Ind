import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, setSettings, iso } from "../src/db.js";
import { Scheduler, enqueue } from "../src/discovery.js";
import { planRadar, radarState, categories } from "../src/radar.js";
import { PublicPageReader, publicAddress } from "../src/public-pages.js";
import {
  extractStructuredObservation,
  validatedGTIN,
} from "../src/extraction.js";
import { ingest, candidates } from "../src/evidence.js";
import { attrs, scenario } from "./fixtures.js";
import { score } from "../src/vigil.js";
import { historyForecast } from "../src/robust-model.js";
import { identity } from "../src/identity.js";
const productURL = "https://shop.example.com/expensive-printer";
const product = (price = 99999) => ({
  "@type": "Product",
  name: "Synthetic expensive printer",
  brand: { name: "Synthetic Labs" },
  model: "SYN-300",
  offers: {
    "@type": "Offer",
    price,
    priceCurrency: "INR",
    seller: { name: "Synthetic shop" },
    itemCondition: "https://schema.org/NewCondition",
    availability: "https://schema.org/InStock",
  },
});
const page = (p = product(), url = productURL) => ({
  html: `<script type="application/ld+json">${JSON.stringify(p)}</script>`,
  metadata: { sourceURL: url, statusCode: 200 },
  retrievedAt: iso(),
  creditsUsed: 0,
});
test("category radar searches without a user query, checks prices without a discovery key, and persists history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghi-radar-"));
  const path = join(dir, "prices.sqlite");
  let db = openDb(path),
    searches = 0,
    reads = 0;
  setSettings(db, {
    radarEnabled: true,
    radarCategories: ["fabrication"],
    scrapeAllowedDomains: ["shop.example.com"],
    intervalSeconds: 0,
  });
  const scheduler = new Scheduler(db, {
    provider: {
      key: "test",
      search: async (query) => {
        searches++;
        assert.match(query, /3D printer/);
        return [
          {
            url: productURL,
            title: "Synthetic expensive printer",
            description: "Fixture",
          },
        ];
      },
    },
    pageReader: {
      id: "public_http",
      key: "public",
      scrape: async () => {
        reads++;
        return page();
      },
    },
    robotsCheck: async () => true,
  });
  await scheduler.tick();
  assert.equal(searches, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM extraction_jobs").get().n, 1);
  scheduler.provider.key = "";
  await scheduler.tick();
  assert.equal(reads, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM observations").get().n, 1);
  const observed = candidates(db)[0];
  assert.equal(observed.price_paise, 9999900);
  assert.equal(observed.result.identity.scope, "same_listing_only");
  assert.equal(observed.result.severity, 0);
  assert.equal(radarState(db, candidates(db)).products.length, 1);
  assert.equal(
    db
      .prepare(
        "SELECT SUM(credits_used) credits FROM usage WHERE provider='public_http'",
      )
      .get().credits,
    0,
  );
  db.prepare("UPDATE radar_targets SET next_check=?").run(
    new Date(Date.now() - 1000).toISOString(),
  );
  await scheduler.tick();
  assert.equal(reads, 2);
  db.close();
  db = openDb(path);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM observations").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM radar_targets").get().n, 1);
  db.close();
  rmSync(dir, { recursive: true });
});
test("radar rotates categories on schedule and does not flood the queue", () => {
  const db = openDb(":memory:");
  setSettings(db, {
    radarEnabled: true,
    radarCategories: ["fabrication", "computing"],
    scrapeAllowedDomains: ["shop.example.com"],
  });
  const now = Date.now();
  planRadar(db, enqueue, now);
  planRadar(db, enqueue, now);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM jobs").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM radar_cycles").get().n, 2);
  setSettings(db, { radarEnabled: false });
  planRadar(db, enqueue, now + 86400000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM jobs").get().n, 2);
  db.close();
});
test("public-page collector blocks private addresses and never follows redirects", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("8.8.8.8"), true);
  let options;
  const reader = new PublicPageReader({
    fetchImpl: async (url, o) => {
      options = o;
      return new Response(page().html, {
        headers: { "content-type": "text/html" },
      });
    },
  });
  const doc = await reader.scrape(productURL);
  assert.equal(options.redirect, "error");
  assert.equal(doc.creditsUsed, 0);
  assert.match(doc.html, /Product/);
});
test("incomplete product variants can use own history, never a different listing", () => {
  const observed = extractStructuredObservation(page(), {
    url: productURL,
    allowListingHistory: true,
  });
  assert.ok(observed.observation);
  assert.equal(observed.observation.attributes.bundle, "unknown");
  assert.equal(observed.observation.attributes.packCount, 0);
  const attrs = observed.observation.attributes;
  assert.equal(identity(attrs, attrs).blocked, false);
  assert.equal(
    identity(attrs, { ...attrs, listingScope: "another listing" }).blocked,
    true,
  );
  assert.equal(
    extractStructuredObservation(page(), { url: productURL }).status,
    "unverified",
  );
});
test("valid GTIN permits matching catalog comparisons while bad identifiers do not", () => {
  assert.equal(validatedGTIN("4006381333931"), "04006381333931");
  assert.equal(validatedGTIN("4006381333932"), null);
  const p = product();
  p.gtin13 = "4006381333931";
  const first = extractStructuredObservation(page(p), {
    url: productURL,
    allowListingHistory: true,
  });
  const otherURL = "https://another.example.com/same-product";
  const second = extractStructuredObservation(page(p, otherURL), {
    url: otherURL,
    allowListingHistory: true,
  });
  assert.equal(
    identity(first.observation.attributes, second.observation.attributes)
      .blocked,
    false,
  );
  const db = openDb(":memory:");
  ingest(db, first.observation, {
    provider: "public_http",
    reliability: 0.65,
    purchaseStatus: "PRODUCT_PAGE_OBSERVED",
    sourceGroup: "seller:first",
  });
  ingest(
    db,
    { ...second.observation, seller: "Second seller" },
    {
      provider: "public_http",
      reliability: 0.65,
      purchaseStatus: "PRODUCT_PAGE_OBSERVED",
      sourceGroup: "seller:second",
    },
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM variants").get().n, 1);
  db.close();
});
test("robust forecast resists isolated spikes and normal price drift", () => {
  const s = scenario();
  const reference = historyForecast(s.history, s.now);
  s.history[12].price_paise *= 100;
  const outlier = historyForecast(s.history, s.now);
  assert.ok(Math.abs(outlier.typicalPaise / reference.typicalPaise - 1) < 0.1);
  const history = Array.from({ length: 30 }, (_, i) => ({
    ...s.current,
    price_paise: Math.round(3000000 * Math.exp(-0.01 * i)),
    observed_at: new Date(s.now - (30 - i) * 86400000).toISOString(),
  }));
  const result = score({
    current: {
      ...s.current,
      price_paise: Math.round(3000000 * Math.exp(-0.01 * 30)),
    },
    history,
    now: s.now,
  });
  assert.ok(result.severity < 40, JSON.stringify(result));
  assert.ok(result.mathematics.forecast.trendPerDay < 0);
});
test("a real collector reliability can qualify a large supported anomaly without a paid history source", () => {
  const s = scenario();
  s.baselines = [];
  s.current.reliability = 0.65;
  s.current.provider = "public_http";
  const result = score(s);
  assert.ok(result.severity >= 75, JSON.stringify(result));
  assert.ok(result.confidence >= 70);
  assert.equal(result.statistics.trustedLowPaise, null);
  assert.equal(result.purchaseStatus, "PRODUCT_PAGE_OBSERVED");
  assert.notEqual(result.mathematics.lowerTailRank, null);
});
test("free-page budget is bounded independently from Firecrawl spend", async () => {
  const db = openDb(":memory:");
  let reads = 0;
  setSettings(db, {
    radarEnabled: true,
    radarCategories: ["fabrication"],
    scrapeAllowedDomains: ["shop.example.com"],
    intervalSeconds: 0,
    historyDailyBudget: 0,
  });
  const scheduler = new Scheduler(db, {
    provider: {
      key: "test",
      search: async () => [
        { url: productURL, title: "Synthetic printer", description: "Fixture" },
      ],
    },
    pageReader: {
      id: "public_http",
      key: "public",
      scrape: async () => {
        reads++;
        return page();
      },
    },
    robotsCheck: async () => true,
  });
  await scheduler.tick();
  scheduler.provider.key = "";
  await scheduler.tick();
  assert.equal(reads, 0);
  db.close();
});

test("matching live GTIN offers can establish a supported anomaly before history exists", () => {
  const db = openDb(":memory:");
  for (const [index, price] of [9999, 99999, 99999].entries()) {
    const url = `https://seller-${index}.example.com/product`;
    const p = product(price);
    p.gtin13 = "4006381333931";
    p.offers.seller = { name: `Independent seller ${index}` };
    const extracted = extractStructuredObservation(page(p, url), {
      url,
      allowListingHistory: true,
    });
    ingest(db, extracted.observation, {
      provider: "public_http",
      reliability: 0.65,
      purchaseStatus: "PRODUCT_PAGE_OBSERVED",
      sourceGroup: `seller:${index}`,
    });
  }
  const cheap = candidates(db).find((c) => c.price_paise === 999900);
  assert.equal(cheap.result.statistics.n, 0);
  assert.ok(cheap.result.severity >= 75, JSON.stringify(cheap.result));
  assert.ok(cheap.result.confidence >= 70, JSON.stringify(cheap.result));
  assert.equal(
    cheap.result.expectedValue.provenance,
    "independent_market_median",
  );
  assert.equal(cheap.result.expectedValue.referencePaise, 9999900);
  db.close();
});
