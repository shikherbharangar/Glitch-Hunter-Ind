import { request as httpRequest } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openDb } from "../src/db.js";
import { createApp, configuredOrigins } from "../src/server.js";
import { manualInput } from "./fixtures.js";
async function server(fn, options = {}) {
  const db = openDb(":memory:"),
    { app, scheduler } = createApp({ db, ...options }),
    s = app.listen(0, "127.0.0.1");
  await once(s, "listening");
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    await fn(
      (path, method = "GET", body, headers = {}) =>
        new Promise((resolve, reject) => {
          const req = httpRequest(
            base + path,
            {
              method,
              headers: { "Content-Type": "application/json", ...headers },
            },
            (res) => {
              let raw = "";
              res.on("data", (c) => (raw += c));
              res.on("end", () =>
                resolve({
                  status: res.statusCode,
                  headers: {
                    get: (k) =>
                      Array.isArray(res.headers[k])
                        ? res.headers[k].join(";")
                        : res.headers[k],
                  },
                  json: async () => JSON.parse(raw),
                }),
              );
            },
          );
          req.on("error", reject);
          if (body !== undefined) req.write(JSON.stringify(body));
          req.end();
        }),
      { db, scheduler },
    );
  } finally {
    s.close();
    await once(s, "close");
    db.close();
  }
}
test("API validation, real empty state, observation and expiration workflow", () =>
  server(async (request) => {
    const state = await (await request("/api/state")).json();
    assert.equal(state.candidates.length, 0);
    assert.equal((await request("/api/observations", "POST", {})).status, 400);
    const r = await (
      await request("/api/observations", "POST", manualInput())
    ).json();
    assert.ok(r.id);
    let detail = await (await request(`/api/candidates/${r.id}`)).json();
    assert.equal(detail.current.provider, "manual");
    assert.equal(
      (
        await request(`/api/candidates/${r.id}/verification`, "POST", {
          status: "CHECKOUT_VERIFIED",
        })
      ).status,
      400,
    );
    detail = await (
      await request(`/api/candidates/${r.id}/verification`, "POST", {
        status: "EXPIRED",
      })
    ).json();
    assert.ok(detail.result.blocked);
    assert.equal(
      (await request("/api/settings", "PATCH", { severityThreshold: -10 }))
        .status,
      400,
    );
  }));
test("origin and host protections block cross-site mutations", () =>
  server(async (request) => {
    assert.equal(
      (
        await request(
          "/api/jobs",
          "POST",
          { query: "test query" },
          { Origin: "https://evil.invalid" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/api/state", "GET", undefined, { Host: "evil.invalid" }))
        .status,
      403,
    );
  }));
test("configured auth protects API and accepts session login", () =>
  server(
    async (request) => {
      assert.equal((await request("/api/state")).status, 401);
      assert.equal(
        (await request("/api/login", "POST", { token: "wrong" })).status,
        401,
      );
      const r = await request("/api/login", "POST", {
        token: "synthetic-test-token",
      });
      assert.equal(r.status, 200);
      const cookie = r.headers.get("set-cookie");
      assert.match(cookie, /HttpOnly/);
      assert.equal(
        (
          await request("/api/state", "GET", undefined, {
            Cookie: cookie.split(";")[0],
          })
        ).status,
        200,
      );
    },
    { authToken: "synthetic-test-token" },
  ));
test("user baselines stay unvalidated and missing resources return 404", () =>
  server(async (request) => {
    const a = await (
      await request("/api/observations", "POST", manualInput())
    ).json();
    const d = await (await request(`/api/candidates/${a.id}`)).json();
    const b = await (
      await request("/api/baselines", "POST", {
        variantId: d.current.variant_id,
        pricePaise: 2499900,
        sourceRef: "https://synthetic.invalid/history",
        observedAt: new Date(Date.now() - 10000).toISOString(),
      })
    ).json();
    assert.equal(b.kind, "user_entered_unvalidated");
    assert.equal((await request("/api/candidates/99999")).status, 404);
  }));
test("Firecrawl policy validates settings and extraction remains explicit with missing credentials", () =>
  server(async (request) => {
    for (const body of [
      { searchResultLimit: 21 },
      { requestTimeoutMs: 1 },
      { scrapeAllowedDomains: ["localhost"] },
      { scrapeAllowedDomains: ["https://shop.example.com"] },
    ])
      assert.equal((await request("/api/settings", "PATCH", body)).status, 400);
    assert.equal(
      (
        await request("/api/extractions", "POST", {
          url: "https://shop.example.com/product",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/settings", "PATCH", {
          scrapeAllowedDomains: ["shop.example.com"],
          searchResultLimit: 5,
          requestTimeoutMs: 10000,
          costPerScrape: null,
        })
      ).status,
      200,
    );
    const queued = await (
      await request("/api/extractions", "POST", {
        url: "https://shop.example.com/product",
        category: "Synthetic",
        recheck: true,
      })
    ).json();
    assert.ok(queued.id);
    assert.equal(
      (await request(`/api/extractions/${queued.id}/cancel`, "POST", {}))
        .status,
      200,
    );
    const state = await (await request("/api/state")).json();
    assert.equal(state.extractions[0].status, "cancelled");
    assert.equal(state.candidates.length, 0);
    assert.equal(state.providers[0].id, "firecrawl");
    assert.deepEqual(state.providers[0].requirements, ["FIRECRAWL_API_KEY"]);
  }));
test("Render-assigned hostname and origin work alongside an explicit domain, with Secure sign-in cookies", () =>
  server(
    async (request) => {
      const headers = {
        Host: "ghi-real.onrender.com",
        Origin: "https://ghi-real.onrender.com",
      };
      assert.equal(
        (await request("/api/auth", "GET", undefined, headers)).status,
        200,
      );
      const login = await request(
        "/api/login",
        "POST",
        { token: "synthetic-render-token" },
        headers,
      );
      assert.equal(login.status, 200);
      assert.match(login.headers.get("set-cookie"), /Secure/);
      const cookie = login.headers.get("set-cookie").split(";")[0];
      assert.equal(
        (
          await request("/api/state", "GET", undefined, {
            ...headers,
            Cookie: cookie,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request("/api/auth", "GET", undefined, {
            Host: "your-service-name.onrender.com",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request("/api/auth", "GET", undefined, {
            Host: "another.onrender.com",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            "/api/login",
            "POST",
            { token: "synthetic-render-token" },
            { Host: "ghi-real.onrender.com", Origin: "https://evil.invalid" },
          )
        ).status,
        403,
      );
    },
    {
      authToken: "synthetic-render-token",
      publicOrigin: "https://your-service-name.onrender.com/",
      renderOrigin: "https://ghi-real.onrender.com",
    },
  ));
test("Render URL alone configures hosting; origin values are normalized and validated", () => {
  assert.deepEqual(
    configuredOrigins({
      publicOrigin: undefined,
      renderOrigin: "https://ghi-real.onrender.com/",
    }),
    ["https://ghi-real.onrender.com"],
  );
  assert.deepEqual(
    configuredOrigins({
      publicOrigin: " https://my.example.com/ ",
      renderOrigin: undefined,
    }),
    ["https://my.example.com"],
  );
  for (const publicOrigin of [
    "https://user:secret@example.com",
    "http://public.example.com",
    "https://example.com/path",
    "https://example.com?x=1",
    "not-a-url",
  ])
    assert.throws(
      () => configuredOrigins({ publicOrigin, renderOrigin: undefined }),
      /Invalid deployment origin/,
    );
});

test("radar API requires permitted sources, schedules chosen categories, exposes state and pauses", () =>
  server(async (request, { db }) => {
    const missing = await request("/api/radar", "POST", { radarEnabled: true });
    assert.equal(missing.status, 400);
    assert.equal(
      (
        await request("/api/radar", "POST", {
          radarEnabled: true,
          radarCategories: ["not-a-category"],
          scrapeAllowedDomains: ["shop.example.com"],
        })
      ).status,
      400,
    );
    const response = await request("/api/radar", "POST", {
      radarEnabled: true,
      radarCategories: ["computing"],
      scrapeAllowedDomains: ["shop.example.com"],
      radarMinPricePaise: 1000000,
    });
    assert.equal(response.status, 200);
    const state = await (await request("/api/state")).json();
    assert.equal(state.radar.enabled, true);
    assert.deepEqual(state.radar.selected, ["computing"]);
    assert.match(state.jobs[0].query, /mini PC/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM usage").get().n, 0);
    assert.equal(
      (await request("/api/radar", "POST", { radarEnabled: false })).status,
      200,
    );
    assert.equal(
      db.prepare("SELECT status FROM jobs").get().status,
      "cancelled",
    );
  }));
