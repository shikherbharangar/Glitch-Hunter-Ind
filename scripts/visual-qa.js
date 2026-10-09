import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { openDb } from "../src/db.js";
import { createApp } from "../src/server.js";
import { manualInput } from "../tests/fixtures.js";
mkdirSync("artifacts", { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "ghi-visual-")),
  db = openDb(join(dir, "visual.sqlite")),
  { app } = createApp({ db }),
  server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const checks = [],
  errors = [],
  network = [];
try {
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", async (r) => {
      if (r.request().method() !== "GET")
        network.push({
          url: r.url(),
          status: r.status(),
          body: await r.text(),
        });
    });
    await page.goto(origin + "/#radar");
    await page.getByRole("heading", { name: "Price radar." }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.className),
      "skip",
    );
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement.id), "main");
    assert.equal(await page.locator("#font-warning").isVisible(), false);
    assert.equal(
      await page.evaluate(() => document.fonts.check('400 13px "Paper Mono"')),
      true,
    );
    const fonts = await page
      .locator("body,button,input,select,textarea,h1,h2,a")
      .evaluateAll((els) => [
        ...new Set(els.map((e) => getComputedStyle(e).fontFamily)),
      ]);
    assert.ok(
      fonts.every((f) => f === '"Paper Mono", monospace'),
      JSON.stringify(fonts),
    );
    const session = await page.context().newCDPSession(page);
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "h1",
    });
    const used = await session.send("CSS.getPlatformFontsForNode", { nodeId });
    assert.ok(
      used.fonts.some(
        (f) => f.isCustomFont && f.familyName.includes("Paper Mono"),
      ),
    );
    await page.evaluate(
      readFileSync("node_modules/axe-core/axe.min.js", "utf8"),
    );
    const audit = await page.evaluate(() =>
      axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] }),
    );
    assert.deepEqual(
      audit.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
      [],
    );
    await page.screenshot({
      path: `artifacts/${name}-radar.png`,
      fullPage: true,
    });
    for (const view of [
      "discover",
      "evidence",
      "watchlist",
      "health",
      "settings",
    ]) {
      await page.locator(`nav a[data-view="${view}"]`).click();
      await page
        .getByRole("heading", {
          name: {
            discover: "Search results.",
            evidence: "Price evidence.",
            watchlist: "Keep watch.",
            health: "System health.",
            settings: "Set the boundaries.",
          }[view],
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${name}/${view} overflow`,
      );
      await page.screenshot({
        path: `artifacts/${name}-${view}.png`,
        fullPage: true,
      });
    }
    await page.locator('[name="dailyBudget"]').fill("25");
    await page
      .locator('[name="scrapeAllowedDomains"]')
      .fill("shop.example.com");
    await page.getByRole("button", { name: "Save policy" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "Policy saved." })
      .waitFor();
    await page.locator('nav a[data-view="watchlist"]').click();
    await page.locator("#watch-form").waitFor();
    await page.locator('form [name="query"]').fill("Synthetic QA model");
    await page
      .locator('#query-form [name="category"], #watch-form [name="category"]')
      .fill("SYNTHETIC QA");
    await page.getByRole("button", { name: "Add monitor +" }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.locator('nav a[data-view="discover"]').click();
    await page.locator("#query-form").waitFor();
    await page.locator('form [name="query"]').fill("Synthetic QA printer");
    await page
      .locator('#query-form [name="category"], #watch-form [name="category"]')
      .fill("SYNTHETIC QA");
    await page.getByRole("button", { name: "Queue search ↗" }).click();
    await page.locator("#search-activity summary").click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Cancel", exact: true })
      .waitFor({ state: "hidden" });
    await page
      .getByText("Check a product page for price evidence", { exact: true })
      .click();
    await page
      .locator('#url-form [name="url"]')
      .fill("https://shop.example.com/products/synthetic");
    await page.locator('#url-form [name="category"]').fill("SYNTHETIC QA");
    await page.locator('#url-form [name="recheck"]').selectOption("true");
    await page
      .getByRole("button", { name: "Queue permitted extraction ↗" })
      .click();
    await page.locator("#extraction-activity summary").click();
    await page.getByRole("button", { name: "Cancel extraction" }).click();
    await page
      .getByRole("cell", { name: "cancelled", exact: true })
      .first()
      .waitFor();
    checks.push({
      extractionQueueCancellation: true,
      viewport: name,
      fontLoaded: true,
      actualFont: used.fonts,
      overflow: false,
      navigation: true,
      settings: true,
      watchlist: true,
      queueCancellation: true,
    });
    await page.close();
  }
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/#evidence");
  await page.getByRole("heading", { name: "Price evidence." }).waitFor();
  const input = manualInput();
  for (const [k, v] of Object.entries({ ...input, ...input.attributes })) {
    const target = page.locator(`#observation-form [name="${k}"]`);
    if (await target.count()) {
      if ((await target.evaluate((e) => e.tagName)) === "SELECT")
        await target.selectOption(String(v));
      else await target.fill(String(v));
    }
  }
  await page.getByRole("button", { name: "Save observation +" }).click();
  await page.getByRole("heading", { name: "SYNTHETIC TEST printer" }).waitFor();
  await page.locator('#baseline-form [name="pricePaise"]').fill("2499900");
  await page
    .locator('#baseline-form [name="sourceRef"]')
    .fill("https://synthetic.invalid/history");
  await page
    .locator('#baseline-form [name="observedAt"]')
    .fill(new Date(Date.now() - 86400000).toISOString());
  await page
    .getByRole("button", { name: "Save unvalidated reference" })
    .click();
  await page.getByText(/user_entered_unvalidated \/ ₹24,999/).waitFor();
  await page.screenshot({
    path: "artifacts/desktop-synthetic-candidate.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "artifacts/mobile-synthetic-candidate.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Price disappeared" }).click();
  await page.getByText("expired", { exact: true }).first().waitFor();
  checks.push({
    observationForm: true,
    candidateDetail: true,
    expireAction: true,
    fixture: "SYNTHETIC isolated temporary database",
  });
  await page.close();
  for (const width of [1440, 390]) {
    const resultsPage = await browser.newPage({
      viewport: { width, height: 900 },
    });
    resultsPage.on("pageerror", (e) => errors.push(e.message));
    await resultsPage.route("**/api/state", async (route) => {
      const upstream = await route.fetch(),
        data = await upstream.json();
      const lead = {
        id: 999,
        url: "https://shop.example.com/products/telescope",
        title: "SYNTHETIC QA telescope",
        description: "Synthetic listing link for browser validation only.",
        source_domain: "shop.example.com",
        marketplace: "other",
        observed_at: data.now,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };
      data.discoveries = [lead, { ...lead, id: 1000 }];
      data.coverage.listings = 1;
      await route.fulfill({ response: upstream, json: data });
    });
    await resultsPage.goto(origin);
    await resultsPage
      .getByRole("heading", { name: "Search results.", exact: true })
      .waitFor();
    assert.equal(
      await resultsPage.locator("#search-results article").count(),
      1,
    );
    assert.equal(
      await resultsPage
        .getByRole("link", { name: "Open listing ↗" })
        .getAttribute("href"),
      "https://shop.example.com/products/telescope",
    );
    const position = await resultsPage.evaluate(() => ({
      result: document.querySelector("#search-results").getBoundingClientRect()
        .top,
      form: document.querySelector("#query-form").getBoundingClientRect().top,
    }));
    assert.ok(position.result < position.form);
    assert.equal(
      await resultsPage.locator("#search-activity").getAttribute("open"),
      null,
    );
    await resultsPage.screenshot({
      path: `artifacts/${width}-search-results.png`,
      fullPage: true,
    });
    await resultsPage.close();
  }
  checks.push({
    resultsFirst: true,
    listingLink: true,
    deduplicated: true,
    viewports: 2,
    fixture: "SYNTHETIC mocked search leads",
  });
  for (const status of [
    "credentials_missing",
    "configured_unverified",
    "operational",
    "configured_failing",
    "rate_limited",
    "quota_exhausted",
  ]) {
    const healthPage = await browser.newPage();
    healthPage.on("pageerror", (e) => errors.push(e.message));
    await healthPage.route("**/api/state", async (route) => {
      const upstream = await route.fetch();
      const data = await upstream.json();
      data.providers[0].status = status;
      data.providers[0].lastDiscoveryAt =
        status === "operational" ? data.now : null;
      data.providers[0].recentRequests = [
        {
          operation: "search",
          occurred_at: data.now,
          outcome:
            status === "operational" ? "success" : "PROVIDER_ACCESS_DENIED",
          credits_used: null,
        },
      ];
      await route.fulfill({ response: upstream, json: data });
    });
    await healthPage.goto(origin + "/#health");
    await healthPage.getByRole("heading", { name: "System health." }).waitFor();
    await healthPage
      .locator(".tag")
      .filter({ hasText: status.replaceAll("_", " ") })
      .first()
      .waitFor();
    assert.match(
      await healthPage.locator("main").innerText(),
      /Last successful discovery/,
    );
    await healthPage.close();
  }
  checks.push({ providerStates: 6, fixture: "SYNTHETIC mocked UI state only" });
  const failure = await browser.newPage();
  await failure.route("**/api/state", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "TEST_SERVICE_UNAVAILABLE" }),
    }),
  );
  await failure.goto(origin);
  await failure
    .getByRole("heading", { name: "Connection interrupted." })
    .waitFor();
  await failure.screenshot({ path: "artifacts/error-state.png" });
  await failure.close();
  const fontFailure = await browser.newPage();
  await fontFailure.route("**/fonts/PaperMono.woff2", (r) => r.abort());
  await fontFailure.goto(origin);
  await fontFailure.locator("#font-warning").waitFor({ state: "visible" });
  await fontFailure.close();
  const loading = await browser.newPage();
  let release;
  const gate = new Promise((r) => (release = r));
  await loading.route("**/api/state", async (r) => {
    await gate;
    await r.continue();
  });
  await loading.goto(origin, { waitUntil: "domcontentloaded" });
  assert.match(
    await loading.locator("main").innerText(),
    /Loading evidence workspace/,
  );
  await loading.screenshot({ path: "artifacts/loading-state.png" });
  release();
  await loading.close();
  checks.push({
    apiFailure: true,
    fontFailureWarning: true,
    loadingState: true,
  });
  assert.deepEqual(errors, []);
  writeFileSync(
    "artifacts/visual-qa.json",
    JSON.stringify(
      { completedAt: new Date().toISOString(), checks, pageErrors: errors },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      checks: checks.length,
      pageErrors: errors,
      screenshots: "artifacts/",
    }),
  );
} catch (e) {
  for (const [i, p] of browser
    .contexts()
    .flatMap((c) => c.pages())
    .entries()) {
    await p.screenshot({ path: `artifacts/failure-${i}.png`, fullPage: true });
    console.log((await p.locator("body").innerText()).slice(-4000));
  }
  console.log(JSON.stringify(network));
  throw e;
} finally {
  await browser.close();
  server.close();
  await once(server, "close");
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
