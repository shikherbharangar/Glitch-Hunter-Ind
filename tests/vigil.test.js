import test from "node:test";
import assert from "node:assert/strict";
import { score } from "../src/vigil.js";
import { identity, parsePrice, marketplaceUrl } from "../src/identity.js";
import { scenario, attrs } from "./fixtures.js";
test("synthetic 83% underpricing: high severity and separate confidence, no checkout claim", () => {
  const r = score(scenario());
  assert.ok(r.severity >= 80, JSON.stringify(r));
  assert.ok(r.confidence >= 70);
  assert.equal(r.purchaseStatus, "PRODUCT_PAGE_OBSERVED");
  assert.ok(r.reasons.includes("MANUAL_CHECKOUT_REQUIRED"));
  assert.equal(r.expectedValue.savingPaise, 2000000);
});
test("ordinary 15% discount does not pass severity threshold", () => {
  const s = scenario();
  s.current.price_paise = 2550000;
  assert.ok(score(s).severity < 60);
});
for (const key of [
  "model",
  "bundle",
  "capacity",
  "generation",
  "condition",
  "kind",
  "packCount",
])
  test(`identity conflict in ${key} blocks comparison`, () => {
    const x = identity(attrs, { ...attrs, [key]: "different" });
    assert.equal(x.confidence, 0);
    assert.ok(x.blocked);
  });
test("text titles alone cannot establish identity", () => {
  assert.ok(identity({ title: "printer" }, { title: "printer" }).blocked);
});
test("accessory history cannot become a printer baseline", () => {
  const s = scenario();
  s.history = s.history.map((h) => ({
    ...h,
    attributes: { ...attrs, kind: "replacement nozzle" },
  }));
  s.baselines = [];
  s.offers = [];
  const r = score(s);
  assert.equal(r.statistics.n, 0);
  assert.equal(r.expectedValue, null);
});
test("refurbished compared with new is suppressed", () => {
  const s = scenario();
  s.current.attributes.condition = "refurbished";
  assert.ok(score(s).blocked);
  assert.equal(score(s).statistics.n, 0);
});
test("stale snippet cannot qualify for a priority alert", () => {
  const s = scenario();
  s.current.observed_at = new Date(s.now - 86400000).toISOString();
  s.current.purchase_status = "SEARCH_RESULT_OBSERVED";
  const r = score(s);
  assert.ok(r.blocked);
  assert.ok(r.confidence < 25);
});
test("missing history is not zero; integrity alone cannot manufacture severity", () => {
  const { current, now } = scenario();
  const r = score({ current, now });
  assert.equal(r.statistics.trustedLowPaise, null);
  assert.equal(r.expectedValue, null);
  assert.equal(r.severity, 0);
  assert.ok(r.confidence < 30);
});
test("user baseline never becomes a trusted historical low", () => {
  const s = scenario();
  s.baselines[0].validated = 0;
  assert.equal(score(s).statistics.trustedLowPaise, null);
});
test("zero MAD avoids division by zero and reduces rarity support", () => {
  const s = scenario();
  s.history = s.history.map((h) => ({ ...h, price_paise: 3000000 }));
  const r = score(s);
  assert.equal(r.statistics.zr, null);
  assert.ok(Number.isFinite(r.severity));
  assert.ok(r.reasons.includes("ZERO_MAD"));
});
test("repeat polling does not increase history or independent source counts", () => {
  const s = scenario(),
    r = score(s);
  s.history = [...s.history, ...s.history, ...s.history];
  s.offers = [...s.offers, ...s.offers];
  const again = score(s);
  delete again.comparisonAudit;
  const original = { ...r };
  delete original.comparisonAudit;
  assert.deepEqual(again, original);
});
test("future observations cannot leak into history", () => {
  const s = scenario();
  s.history = s.history.map((h) => ({
    ...h,
    observed_at: new Date(s.now + 86400000).toISOString(),
  }));
  assert.equal(score(s).statistics.n, 0);
});
for (const status of ["EXPIRED", "UNAVAILABLE"])
  test(`${status} suppresses alerts`, () => {
    const s = scenario();
    s.current.purchase_status = status;
    assert.ok(score(s).blocked);
  });
test("out of stock and non-full prices are rejected", () => {
  const s = scenario();
  s.current.stock = "out_of_stock";
  s.current.price_type = "emi";
  const r = score(s);
  assert.ok(r.blocked);
  assert.ok(r.reasons.includes("NOT_FULL_PRICE"));
});
test("variant mutation integrity flag suppresses alerts", () => {
  const s = scenario();
  s.current.quality = ["VARIANT_CONFLICT"];
  assert.ok(score(s).blocked);
});
test("INR parser handles Indian grouping and decimals exactly", () => {
  assert.equal(parsePrice("₹1,24,999.50"), 12499950);
  assert.equal(parsePrice("INR 4,999"), 499900);
  assert.equal(parsePrice(1.25), 125);
});
for (const p of ["₹999/month", "$50", "₹12,34", "-5", "₹10 per unit", "₹0"])
  test(`reject unsafe price ${p}`, () => assert.throws(() => parsePrice(p)));
test("listing URL whitelist rejects spoofing and scripts", () => {
  for (const u of [
    "https://amazon.in.evil.com/dp/B000TEST01",
    "javascript:alert(1)",
    "http://amazon.in/dp/B000TEST01",
    "https://x@amazon.in/dp/B000TEST01",
  ])
    assert.equal(marketplaceUrl(u), null);
  assert.equal(
    marketplaceUrl("https://amazon.in/dp/B000TEST01?ref=abc").id,
    "B000TEST01",
  );
});

test("same seller cited by multiple sources counts once", () => {
  const s = scenario();
  s.offers = s.offers.map((o) => ({ ...o, seller: "Same seller" }));
  const r = score(s);
  assert.equal(r.statistics.independentSources, 3);
});
test("zero spread reduces evidence confidence", () => {
  const s = scenario(),
    before = score(s);
  s.history = s.history.map((h) => ({ ...h, price_paise: 3000000 }));
  assert.ok(score(s).confidence < before.confidence);
});
