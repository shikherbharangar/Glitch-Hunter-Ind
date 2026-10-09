import test from "node:test";
import assert from "node:assert/strict";
import { assessListing } from "../src/assessment.js";
import { enqueueSearchPriceChecks } from "../src/extraction.js";
import { Scheduler } from "../src/discovery.js";
import { openDb, setSettings } from "../src/db.js";
const url = "https://shop.example.com/item";
const context = {
  candidates: [],
  extractions: [],
  settings: {
    scrapeAllowedDomains: [],
    confidenceThreshold: 70,
    severityThreshold: 75,
  },
};
test("an indexed listing never becomes a glitch without price evidence", () => {
  assert.equal(assessListing(url, context).status, "unchecked");
  assert.match(assessListing(url, context).message, /not enabled/);
});
test("price evidence below thresholds remains explicitly inconclusive", () => {
  const candidate = {
    id: 1,
    url,
    price_paise: 10000,
    result: { confidence: 30, severity: 90, blocked: false },
  };
  const assessment = assessListing(url, {
    ...context,
    candidates: [candidate],
  });
  assert.equal(assessment.status, "insufficient_evidence");
  assert.match(assessment.message, /No comparable price/);
  assert.equal(assessment.pricePaise, 10000);
  candidate.result.confidence = 80;
  assert.equal(
    assessListing(url, { ...context, candidates: [candidate] }).status,
    "possible_glitch",
  );
  candidate.result.blocked = true;
  assert.equal(
    assessListing(url, { ...context, candidates: [candidate] }).status,
    "insufficient_evidence",
  );
});
test("failed fresh checks override previously observed prices", () => {
  const assessment = assessListing(url, {
    ...context,
    extractions: [{ url, status: "unverified", error: "ROBOTS_DISALLOWED" }],
    candidates: [{ url, result: {} }],
  });
  assert.equal(assessment.status, "unverified");
  assert.match(assessment.message, /does not permit/);
});
test("search follow-up is bounded, only checks approved domains, and reuses queued checks", async () => {
  const db = openDb(":memory:");
  const scheduler = new Scheduler(db, {
    provider: {
      key: "test",
      search: async () =>
        Array.from({ length: 6 }, (_, i) => ({
          title: "Synthetic product",
          url: `https://${i === 0 ? "other" : "shop"}.example.com/item-${i}`,
          description: "Fixture",
        })),
    },
  });
  const search = await scheduler.searchNow("synthetic product India");
  assert.equal(enqueueSearchPriceChecks(db, search.queryId).length, 0);
  setSettings(db, { scrapeAllowedDomains: ["shop.example.com"] });
  assert.equal(enqueueSearchPriceChecks(db, search.queryId).length, 3);
  enqueueSearchPriceChecks(db, search.queryId);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM extraction_jobs").get().n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM usage").get().n, 1);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM extraction_jobs WHERE url LIKE '%other.example.com%'",
      )
      .get().n,
    0,
  );
  db.close();
});
