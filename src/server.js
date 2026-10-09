import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { openDb, iso, getSettings, setSettings, budgetDayStart } from "./db.js";
import { enqueueExtraction } from "./extraction.js";
import { publicUrl } from "./urls.js";
import { registry } from "./providers.js";
import { ingest, candidates, detail } from "./evidence.js";
import { enqueue, Scheduler, seeds, pruneCache } from "./discovery.js";
import { notificationStatus, notifyCandidate } from "./notifications.js";
const settingsSchema = z
  .object({
    severityThreshold: z.number().min(50).max(100),
    confidenceThreshold: z.number().min(50).max(100),
    dailyBudget: z.number().int().min(1).max(10000),
    intervalSeconds: z.number().int().min(2).max(86400),
    cacheMinutes: z.number().int().min(5).max(10080),
    scanEnabled: z.boolean(),
    requestTimeoutMs: z.number().int().min(1000).max(120000),
    searchResultLimit: z.number().int().min(1).max(20),
    scrapeAllowedDomains: z
      .array(
        z
          .string()
          .max(253)
          .refine(
            (v) => publicUrl("https://" + v)?.hostname === v,
            "Use a public DNS hostname",
          ),
      )
      .max(30),
    costPerScrape: z.number().min(0).max(100).nullable(),
    alertsEnabled: z.boolean(),
    costPerSearch: z.number().min(0).max(100).nullable(),
    weights: z
      .object({
        H: z.number().min(0).max(1),
        L: z.number().min(0).max(1),
        M: z.number().min(0).max(1),
        T: z.number().min(0).max(1),
        R: z.number().min(0).max(0.1),
      })
      .refine(
        (w) => w.H + w.L + w.M + w.T > 0,
        "At least one price signal is required",
      ),
  })
  .partial()
  .strict();
const querySchema = z
  .object({
    query: z.string().trim().min(3).max(300),
    category: z.string().trim().min(1).max(80).default("Custom"),
  })
  .strict();
export function configuredOrigins({
  publicOrigin = process.env.PUBLIC_ORIGIN,
  renderOrigin = process.env.RENDER_EXTERNAL_URL,
} = {}) {
  return [
    ...new Set(
      [publicOrigin, renderOrigin].filter(Boolean).map((value) => {
        let url;
        try {
          url = new URL(value.trim());
        } catch {
          throw new Error(
            "Invalid deployment origin: use an exact HTTPS website URL.",
          );
        }
        const local = ["localhost", "127.0.0.1", "[::1]"].includes(
          url.hostname,
        );
        if (
          (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        )
          throw new Error(
            "Invalid deployment origin: use an exact HTTPS website URL.",
          );
        return url.origin;
      }),
    ),
  ];
}
export function createApp({
  db = openDb(),
  scheduler = new Scheduler(db),
  authToken = process.env.APP_AUTH_TOKEN,
  publicOrigin = process.env.PUBLIC_ORIGIN,
  renderOrigin = process.env.RENDER_EXTERNAL_URL,
} = {}) {
  const origins = configuredOrigins({ publicOrigin, renderOrigin });
  const allowed = new Set([
    "localhost",
    "127.0.0.1",
    "[::1]",
    ...origins.map((origin) => new URL(origin).hostname),
  ]);
  const app = express(),
    sessions = new Map(),
    loginAttempts = new Map();
  app.disable("x-powered-by");
  const authDigest = (x) => createHash("sha256").update(x).digest();
  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    });
    if (!allowed.has(req.hostname))
      return res.status(403).json({ error: "HOST_NOT_ALLOWED" });
    if (req.headers.origin) {
      const expected = origins.length
        ? origins
        : [`${req.protocol}://${req.headers.host}`];
      if (!expected.includes(req.headers.origin))
        return res.status(403).json({ error: "ORIGIN_NOT_ALLOWED" });
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.is("application/json")
    )
      return res.status(415).json({ error: "JSON_REQUIRED" });
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.get("/api/auth", (_req, res) => res.json({ required: !!authToken }));
  app.post("/api/login", (req, res) => {
    if (!authToken) return res.json({ ok: true });
    const key = req.ip,
      record = loginAttempts.get(key) || { count: 0, at: Date.now() };
    if (Date.now() - record.at > 60000) {
      record.count = 0;
      record.at = Date.now();
    }
    record.count++;
    loginAttempts.set(key, record);
    if (record.count > 10)
      return res.status(429).json({ error: "LOGIN_RATE_LIMITED" });
    if (
      typeof req.body.token !== "string" ||
      !timingSafeEqual(authDigest(req.body.token), authDigest(authToken))
    )
      return res.status(401).json({ error: "AUTHENTICATION_FAILED" });
    for (const [k, v] of sessions) if (v < Date.now()) sessions.delete(k);
    const token = randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + 8 * 3600000);
    res.setHeader(
      "Set-Cookie",
      `ghi_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${origins.some((origin) => origin.startsWith("https:")) ? "; Secure" : ""}`,
    );
    res.json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    const session = req.headers.cookie?.match(
      /(?:^|; )ghi_session=([a-f0-9]+)/,
    )?.[1];
    if (authToken && !(sessions.get(session) > Date.now()))
      return res.status(401).json({ error: "LOGIN_REQUIRED" });
    next();
  });
  app.get("/api/state", (_req, res) => {
    pruneCache(db);
    const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    const usage = db
      .prepare(
        "SELECT COUNT(*) requests,SUM(cost) knownCost,SUM(CASE WHEN cost IS NULL THEN 1 ELSE 0 END) unknownCostRequests,SUM(credits_used) reportedCredits,SUM(CASE WHEN credits_used IS NULL THEN 1 ELSE 0 END) unknownCreditRequests FROM usage WHERE provider='firecrawl' AND occurred_at>=?",
      )
      .get(budgetDayStart());
    res.json({
      settings: getSettings(db),
      providers: registry(db, { key: scheduler.provider.key }),
      notifications: notificationStatus(),
      coverage: {
        products: count("products"),
        variants: count("variants"),
        observations: count("observations"),
        listings: db
          .prepare(
            "SELECT COUNT(DISTINCT url) n FROM search_results WHERE expires_at>?",
          )
          .get(iso()).n,
        queries: count("queries"),
      },
      usage,
      candidates: candidates(db),
      jobs: db
        .prepare(
          "SELECT j.*,q.query,q.category,q.family FROM jobs j JOIN queries q ON q.id=j.query_id ORDER BY j.id DESC LIMIT 100",
        )
        .all(),
      queries: db
        .prepare("SELECT * FROM queries ORDER BY id DESC LIMIT 100")
        .all(),
      discoveries: db
        .prepare(
          "SELECT * FROM search_results WHERE expires_at>? ORDER BY observed_at DESC LIMIT 200",
        )
        .all(iso()),
      watchlist: db.prepare("SELECT * FROM watchlist ORDER BY id DESC").all(),
      extractions: db
        .prepare("SELECT * FROM extraction_jobs ORDER BY id DESC LIMIT 100")
        .all(),
      recentNotifications: db
        .prepare("SELECT * FROM notifications ORDER BY id DESC LIMIT 20")
        .all(),
      now: iso(),
    });
  });
  app.get("/api/candidates/:id", (req, res) => {
    const d = detail(db, Number(req.params.id));
    return d ? res.json(d) : res.status(404).json({ error: "NOT_FOUND" });
  });
  app.post("/api/observations", (req, res) =>
    res.status(201).json(ingest(db, req.body)),
  );
  app.post("/api/baselines", (req, res) => {
    const s = z
      .object({
        variantId: z.number().int().positive(),
        pricePaise: z.number().int().positive(),
        sourceRef: z.string().url().max(1500),
        observedAt: z
          .string()
          .datetime()
          .refine((x) => Date.parse(x) <= Date.now()),
      })
      .strict()
      .parse(req.body);
    if (!db.prepare("SELECT 1 FROM variants WHERE id=?").get(s.variantId))
      return res.status(404).json({ error: "VARIANT_NOT_FOUND" });
    const r = db
      .prepare(
        "INSERT INTO baselines(variant_id,kind,price_paise,source_ref,observed_at,quality,validated) VALUES(?,?,?,?,?,0.3,0)",
      )
      .run(
        s.variantId,
        "user_entered_unvalidated",
        s.pricePaise,
        s.sourceRef,
        s.observedAt,
      );
    res.status(201).json({
      id: Number(r.lastInsertRowid),
      kind: "user_entered_unvalidated",
    });
  });
  app.post("/api/candidates/:id/feedback", (req, res) => {
    const s = z
      .object({
        feedback: z.enum(["false_positive", "useful", "pending"]),
        queryId: z.number().int().positive().optional(),
      })
      .strict()
      .parse(req.body);
    const c = db
      .prepare("SELECT * FROM candidates WHERE id=?")
      .get(Number(req.params.id));
    if (!c) return res.status(404).json({ error: "NOT_FOUND" });
    db.prepare("UPDATE candidates SET feedback=? WHERE id=?").run(
      s.feedback,
      c.id,
    );
    if (c.feedback !== s.feedback) {
      const candidate = detail(db, c.id);
      const linked = db
        .prepare("SELECT DISTINCT query_id FROM search_results WHERE url=?")
        .all(candidate.current.url);
      for (const q of linked) {
        if (s.queryId && q.query_id !== s.queryId) continue;
        const delta = s.feedback === "useful" ? 1 : 0,
          prev = c.feedback === "useful" ? 1 : 0,
          bad = s.feedback === "false_positive" ? 1 : 0,
          oldBad = c.feedback === "false_positive" ? 1 : 0;
        db.prepare(
          "UPDATE queries SET useful=MAX(0,useful+?),false_positives=MAX(0,false_positives+?) WHERE id=?",
        ).run(delta - prev, bad - oldBad, q.query_id);
      }
    }
    res.json({ ok: true });
  });
  app.post("/api/candidates/:id/verification", (req, res) => {
    const d = detail(db, Number(req.params.id));
    if (!d) return res.status(404).json({ error: "NOT_FOUND" });
    const s = z
      .object({
        status: z.enum(["MANUAL_CHECKOUT_REQUIRED", "EXPIRED", "UNAVAILABLE"]),
      })
      .strict()
      .parse(req.body);
    db.prepare("UPDATE observations SET purchase_status=? WHERE id=?").run(
      s.status,
      d.current.id,
    );
    res.json(detail(db, d.id));
  });
  app.post("/api/jobs", (req, res) => {
    const d = querySchema.parse(req.body);
    res.status(201).json(enqueue(db, d.query, d.category));
  });
  app.post("/api/jobs/seed", (_req, res) =>
    res.json(seeds.map(([cat, q]) => enqueue(db, q, cat, "seed"))),
  );
  app.post("/api/jobs/:id/cancel", (req, res) => {
    scheduler.cancel(Number(req.params.id));
    res.json({ ok: true });
  });
  app.post("/api/extractions", (req, res) => {
    const data = z
      .object({
        url: z.string().url().max(1500),
        category: z.string().trim().min(1).max(80).default("Manual URL"),
        recheck: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(
      enqueueExtraction(db, data.url, data.category, {
        recheck: data.recheck,
      }),
    );
  });
  app.post("/api/extractions/:id/cancel", (req, res) => {
    const id = Number(req.params.id);
    db.prepare(
      "UPDATE extraction_jobs SET status='cancelled',finished_at=? WHERE id=? AND status IN ('queued','running','retry')",
    ).run(iso(), id);
    if (scheduler.active?.kind === "extraction" && scheduler.active.id === id)
      scheduler.active.controller.abort();
    res.json({ ok: true });
  });
  app.post("/api/watchlist", (req, res) => {
    const d = querySchema.parse(req.body);
    db.prepare(
      "INSERT INTO watchlist(label,query,created_at) VALUES(?,?,?) ON CONFLICT(query) DO NOTHING",
    ).run(d.category, d.query, iso());
    res.status(201).json({ ok: true });
  });
  app.delete("/api/watchlist/:id", (req, res) => {
    db.prepare("DELETE FROM watchlist WHERE id=?").run(Number(req.params.id));
    res.json({ ok: true });
  });
  app.patch("/api/settings", (req, res) =>
    res.json(setSettings(db, settingsSchema.parse(req.body))),
  );
  app.post("/api/notifications/send", async (_req, res) => {
    const results = [];
    for (const c of candidates(db))
      results.push({ id: c.id, channels: await notifyCandidate(db, c) });
    res.json({ results });
  });
  app.use(
    express.static(resolve(existsSync("dist/index.html") ? "dist" : "public"), {
      etag: true,
      maxAge: 0,
    }),
  );
  app.use("/api", (_req, res) => res.status(404).json({ error: "NOT_FOUND" }));
  app.use((err, _req, res, _next) => {
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: "VALIDATION_FAILED",
        issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    if (
      [
        "INVALID_QUERY",
        "QUEUE_FULL",
        "INVALID_URL",
        "DOMAIN_NOT_APPROVED",
      ].includes(err.message)
    )
      return res.status(400).json({ error: err.message });
    if (err.type === "entity.parse.failed" || err.type === "entity.too.large")
      return res.status(400).json({ error: "INVALID_JSON_BODY" });
    console.error(
      JSON.stringify({ event: "request_failed", code: "INTERNAL_ERROR" }),
    );
    res.status(500).json({ error: "INTERNAL_ERROR" });
  });
  return { app, db, scheduler };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const host = process.env.HOST || "127.0.0.1";
  if (
    !["localhost", "127.0.0.1", "::1"].includes(host) &&
    (!process.env.APP_AUTH_TOKEN ||
      !configuredOrigins().some((origin) => origin.startsWith("https:")))
  )
    throw new Error(
      "Public binding requires APP_AUTH_TOKEN and an HTTPS PUBLIC_ORIGIN or Render-assigned URL; terminate HTTPS at a reverse proxy.",
    );
  const { app, db, scheduler } = createApp();
  const server = app.listen(Number(process.env.PORT || 3000), host, () => {
    console.log(
      JSON.stringify({
        event: "server_started",
        host,
        port: Number(process.env.PORT || 3000),
      }),
    );
    scheduler.start();
  });
  let notifying = false;
  const timer = setInterval(async () => {
    if (notifying) return;
    notifying = true;
    try {
      for (const c of candidates(db)) await notifyCandidate(db, c);
    } catch {
      console.error(JSON.stringify({ event: "notification_worker_error" }));
    } finally {
      notifying = false;
    }
  }, 60000);
  timer.unref();
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      clearInterval(timer);
      await scheduler.stop();
      server.close(() => {
        db.close();
        process.exit(0);
      });
    });
}
