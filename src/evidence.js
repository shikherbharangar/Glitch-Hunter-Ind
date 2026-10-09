import { z } from "zod";
import { iso, getSettings } from "./db.js";
import { variantKey, normalize } from "./identity.js";
import { listingUrl } from "./urls.js";
import { score } from "./vigil.js";
const text = z.string().trim().min(1).max(250);
export const attributesSchema = z
  .object({
    model: text,
    brand: text.optional(),
    gtin: text.optional(),
    sku: text.optional(),
    bundle: text,
    capacity: text.optional(),
    colour: text.optional(),
    generation: text.optional(),
    condition: z.enum(["new", "used", "refurbished"]),
    kind: text,
    packCount: z.number().int().min(1).max(1000),
  })
  .strict();
export const observationSchema = z
  .object({
    title: text,
    category: text,
    url: z
      .string()
      .url()
      .max(1500)
      .refine((x) => !!listingUrl(x), "Use an exact public HTTPS product URL"),
    seller: text,
    pricePaise: z.number().int().positive().max(1e12),
    currency: z.literal("INR"),
    priceType: z.enum(["full", "emi", "coupon", "pack"]),
    observedAt: z
      .string()
      .datetime()
      .refine(
        (x) => Date.parse(x) <= Date.now() + 60000,
        "Future evidence is not accepted",
      ),
    sourceRef: z.string().url().max(1500),
    stock: z.enum(["in_stock", "out_of_stock", "unknown"]),
    attributes: attributesSchema,
  })
  .strict();
export function decodeObservation(r) {
  return {
    ...r,
    attributes: JSON.parse(r.attributes),
    quality: JSON.parse(r.quality),
  };
}
export function ingest(
  db,
  data,
  {
    provider = "manual",
    reliability = 0.5,
    purchaseStatus = "MANUAL_CHECKOUT_REQUIRED",
    sourceGroup = "user-entered",
  } = {},
) {
  const d = observationSchema.parse(data),
    url = listingUrl(d.url),
    attrs = d.attributes;
  db.exec("BEGIN IMMEDIATE");
  try {
    const productKey = variantKey(
      { model: attrs.model, gtin: attrs.gtin, sku: attrs.sku },
      normalize(attrs.brand || url.marketplace),
    );
    db.prepare(
      "INSERT INTO products(identity_key,title,brand,model,category) VALUES(?,?,?,?,?) ON CONFLICT(identity_key) DO NOTHING",
    ).run(productKey, d.title, attrs.brand || null, attrs.model, d.category);
    const product = db
      .prepare("SELECT id FROM products WHERE identity_key=?")
      .get(productKey);
    // Conservative: unknown configurations are never merged across listings.
    const complete =
      attrs.brand &&
      ["capacity", "colour", "generation"].every((k) => attrs[k]);
    const key = variantKey(
      attrs,
      complete
        ? String(product.id)
        : `${product.id}:${url.marketplace}:${url.id}`,
    );
    db.prepare(
      "INSERT INTO variants(product_id,variant_key,attributes) VALUES(?,?,?) ON CONFLICT(variant_key) DO NOTHING",
    ).run(product.id, key, JSON.stringify(attrs));
    const variant = db
      .prepare("SELECT id FROM variants WHERE variant_key=?")
      .get(key);
    const existing = db
      .prepare(
        "SELECT * FROM listings WHERE marketplace=? AND marketplace_id=?",
      )
      .get(url.marketplace, url.id);
    const conflict = existing && existing.variant_id !== variant.id;
    db.prepare(
      "INSERT INTO listings(variant_id,marketplace,marketplace_id,title,url) VALUES(?,?,?,?,?) ON CONFLICT(marketplace,marketplace_id) DO UPDATE SET title=excluded.title,variant_id=excluded.variant_id",
    ).run(variant.id, url.marketplace, url.id, d.title, url.url);
    const listing = db
      .prepare(
        "SELECT * FROM listings WHERE marketplace=? AND marketplace_id=?",
      )
      .get(url.marketplace, url.id);
    db.prepare(
      "INSERT INTO offers(listing_id,seller) VALUES(?,?) ON CONFLICT DO NOTHING",
    ).run(listing.id, d.seller);
    const offer = db
      .prepare("SELECT id FROM offers WHERE listing_id=? AND seller=?")
      .get(listing.id, d.seller);
    const result = db
      .prepare(
        "INSERT INTO observations(offer_id,variant_id,price_paise,currency,price_type,observed_at,recorded_at,provider,source_ref,source_group,reliability,stock,purchase_status,attributes,quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
      )
      .run(
        offer.id,
        variant.id,
        d.pricePaise,
        d.currency,
        d.priceType,
        d.observedAt,
        iso(),
        provider,
        d.sourceRef,
        sourceGroup,
        reliability,
        d.stock,
        purchaseStatus,
        JSON.stringify(attrs),
        JSON.stringify([
          ...(provider === "manual" ? ["USER_ENTERED_UNVALIDATED"] : []),
          ...(conflict ? ["VARIANT_CONFLICT"] : []),
        ]),
      );
    const row = db
      .prepare(
        "SELECT * FROM observations WHERE offer_id=? AND observed_at=? AND provider=? AND source_ref=?",
      )
      .get(offer.id, d.observedAt, provider, d.sourceRef);
    const candidate = evaluate(db, row.id);
    db.exec("COMMIT");
    return {
      id: candidate.id,
      observationId: row.id,
      duplicate: result.changes === 0,
      result: candidate.result,
    };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function evaluate(db, id) {
  const raw = db
    .prepare(
      "SELECT o.*,s.seller FROM observations o JOIN offers s ON s.id=o.offer_id WHERE o.id=?",
    )
    .get(id);
  if (!raw) throw new Error("NOT_FOUND");
  const current = decodeObservation(raw);
  const history = db
    .prepare(
      "SELECT o.*,s.seller FROM observations o JOIN offers s ON s.id=o.offer_id WHERE o.variant_id=? AND o.id<>? ORDER BY observed_at",
    )
    .all(raw.variant_id, id)
    .map(decodeObservation);
  const baselines = db
    .prepare("SELECT * FROM baselines WHERE variant_id=?")
    .all(raw.variant_id);
  const offers = history.filter((o) => o.offer_id !== raw.offer_id);
  const result = score({
    current,
    history,
    baselines,
    offers,
    weights: getSettings(db).weights,
  });
  db.prepare(
    "INSERT INTO candidates(observation_id,result,created_at) VALUES(?,?,?) ON CONFLICT(observation_id) DO UPDATE SET result=excluded.result",
  ).run(id, JSON.stringify(result), iso());
  const row = db
    .prepare("SELECT * FROM candidates WHERE observation_id=?")
    .get(id);
  return { ...row, result };
}
export function candidates(db) {
  return db
    .prepare(
      `SELECT c.*,o.price_paise,o.observed_at,o.stock,o.provider,o.source_ref,o.purchase_status,o.variant_id,l.title,l.marketplace,l.url,s.seller,p.category FROM candidates c JOIN observations o ON o.id=c.observation_id JOIN offers s ON s.id=o.offer_id JOIN listings l ON l.id=s.listing_id JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id WHERE o.id=(SELECT o2.id FROM observations o2 WHERE o2.offer_id=o.offer_id ORDER BY o2.observed_at DESC,o2.id DESC LIMIT 1) ORDER BY c.id DESC LIMIT 500`,
    )
    .all()
    .map((r) => ({ ...r, result: evaluate(db, r.observation_id).result }));
}
export function detail(db, id) {
  const r = db.prepare("SELECT * FROM candidates WHERE id=?").get(id);
  if (!r) return null;
  const current = db
    .prepare(
      "SELECT o.*,s.seller,l.title,l.marketplace,l.url FROM observations o JOIN offers s ON s.id=o.offer_id JOIN listings l ON l.id=s.listing_id WHERE o.id=?",
    )
    .get(r.observation_id);
  return {
    ...r,
    result: evaluate(db, r.observation_id).result,
    current: decodeObservation(current),
    history: db
      .prepare(
        "SELECT * FROM observations WHERE variant_id=? ORDER BY observed_at",
      )
      .all(current.variant_id)
      .map(decodeObservation),
    baselines: db
      .prepare("SELECT * FROM baselines WHERE variant_id=?")
      .all(current.variant_id),
  };
}
