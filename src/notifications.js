import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { fetch, EnvHttpProxyAgent } from "undici";
import { getSettings, iso } from "./db.js";
const dispatcher = new EnvHttpProxyAgent();
const inr = (p) =>
  p == null
    ? "missing"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
      }).format(p / 100);
export function alertText(c) {
  const r = c.result;
  return [
    `Glitch Hunter India — candidate (not a confirmed error)`,
    c.title,
    `${c.marketplace} | ${inr(c.price_paise)}`,
    `Reference: ${inr(r.expectedValue?.referencePaise)} (${r.expectedValue?.provenance || "missing"})`,
    `Trusted historical low: ${inr(r.statistics.trustedLowPaise)}`,
    `Severity ${r.severity}/100 | Evidence ${r.confidence}/100 | Identity ${Math.round(r.identity.confidence * 100)}/100`,
    `Seller: ${c.seller} | Stock: ${c.stock}`,
    `Observed: ${c.observed_at}`,
    `Verification: ${r.purchaseStatus}`,
    `Reasons: ${r.reasons.join(", ")}`,
    c.url,
  ].join("\n");
}
export function fingerprint(c) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        c.variant_id,
        c.marketplace,
        c.seller,
        Math.round(
          c.price_paise /
            Math.max(c.result.expectedValue?.referencePaise * 0.02 || 1, 1),
        ),
        c.result.purchaseStatus,
      ]),
    )
    .digest("hex");
}
export function notificationStatus() {
  return {
    telegram:
      process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
        ? "configured"
        : "credentials_missing",
    email:
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASSWORD &&
      process.env.ALERT_EMAIL_TO &&
      process.env.ALERT_EMAIL_FROM
        ? "configured"
        : "credentials_missing",
  };
}
export async function notifyCandidate(db, c, { senders } = {}) {
  const settings = getSettings(db);
  if (
    !settings.alertsEnabled ||
    c.result.blocked ||
    c.result.severity < settings.severityThreshold ||
    c.result.confidence < settings.confidenceThreshold ||
    c.feedback === "false_positive"
  )
    return [];
  // A successful page fetch is not a checkout check. Firecrawl alerts need a
  // second matching, fresh observation of the same offer and exact variant.
  if (c.provider === "firecrawl") {
    const current = db
      .prepare("SELECT * FROM observations WHERE id=?")
      .get(c.observation_id);
    const cutoff = new Date(Date.now() - 15 * 60000).toISOString();
    if (
      !current ||
      current.stock !== "in_stock" ||
      current.purchase_status !== "PRODUCT_PAGE_OBSERVED" ||
      current.observed_at < cutoff ||
      !db
        .prepare(
          "SELECT 1 FROM observations WHERE offer_id=? AND variant_id=? AND provider='firecrawl' AND price_paise=? AND stock='in_stock' AND purchase_status='PRODUCT_PAGE_OBSERVED' AND observed_at>=? AND observed_at<? AND id<>? LIMIT 1",
        )
        .get(
          current.offer_id,
          current.variant_id,
          current.price_paise,
          cutoff,
          current.observed_at,
          current.id,
        )
    )
      return [];
  }
  const status = notificationStatus();
  const channels = senders || {
    ...(status.telegram === "configured"
      ? {
          telegram: async (text) => {
            const r = await fetch(
              `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
              {
                dispatcher,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: process.env.TELEGRAM_CHAT_ID,
                  text,
                }),
                signal: AbortSignal.timeout(15000),
              },
            );
            if (!r.ok || !(await r.json()).ok)
              throw new Error("DELIVERY_FAILED");
          },
        }
      : {}),
    ...(status.email === "configured"
      ? {
          email: async (text) => {
            const transport = nodemailer.createTransport({
              host: process.env.SMTP_HOST,
              port: Number(process.env.SMTP_PORT || 465),
              secure: true,
              auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASSWORD,
              },
              connectionTimeout: 15000,
            });
            await transport.sendMail({
              from: process.env.ALERT_EMAIL_FROM,
              to: process.env.ALERT_EMAIL_TO,
              subject: "Glitch Hunter India: price evidence candidate",
              text,
            });
            transport.close();
          },
        }
      : {}),
  };
  const sent = [];
  for (const [channel, send] of Object.entries(channels)) {
    const key = fingerprint(c),
      existing = db
        .prepare(
          "SELECT * FROM notifications WHERE channel=? AND fingerprint=?",
        )
        .get(channel, key);
    if (existing && Date.now() - Date.parse(existing.created_at) < 86400000)
      continue;
    db.prepare(
      "INSERT INTO notifications(candidate_id,channel,fingerprint,status,created_at) VALUES(?,?,?,?,?) ON CONFLICT(channel,fingerprint) DO UPDATE SET candidate_id=excluded.candidate_id,status=excluded.status,created_at=excluded.created_at,error=NULL",
    ).run(c.id, channel, key, "pending", iso());
    try {
      await send(alertText(c));
      db.prepare(
        "UPDATE notifications SET status='sent' WHERE channel=? AND fingerprint=?",
      ).run(channel, key);
      sent.push(channel);
    } catch {
      db.prepare(
        "UPDATE notifications SET status='failed',error='DELIVERY_FAILED' WHERE channel=? AND fingerprint=?",
      ).run(channel, key);
    }
  }
  return sent;
}
