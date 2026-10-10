import { createHash } from "node:crypto";
export const normalize = (x) =>
  String(x ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export const critical = [
  "model",
  "gtin",
  "sku",
  "bundle",
  "capacity",
  "colour",
  "generation",
  "condition",
  "kind",
  "packCount",
];
export function identity(left, right) {
  const matches = [],
    conflicts = [],
    missing = [];
  for (const k of critical) {
    if (
      left[k] == null ||
      right[k] == null ||
      normalize(left[k]) === "unknown" ||
      normalize(right[k]) === "unknown" ||
      (k === "packCount" && (!left[k] || !right[k]))
    ) {
      missing.push(k);
      continue;
    }
    (normalize(left[k]) === normalize(right[k]) ? matches : conflicts).push(k);
  }
  if (
    left.brand &&
    right.brand &&
    normalize(left.brand) !== normalize(right.brand)
  )
    conflicts.push("brand");
  const scoped = left.listingScope && left.listingScope === right.listingScope;
  const catalog = left.catalogScope && left.catalogScope === right.catalogScope;
  if (
    left.listingScope ||
    right.listingScope ||
    left.catalogScope ||
    right.catalogScope
  ) {
    const confidence =
      !conflicts.length &&
      (scoped || catalog) &&
      left.brand &&
      right.brand &&
      left.condition === right.condition &&
      (left.condition === "new" || (scoped && left.condition === "unknown"))
        ? catalog
          ? 0.95
          : 0.85
        : 0;
    return {
      confidence,
      matches,
      conflicts,
      missing,
      blocked: confidence < 0.8,
      scope: catalog ? "catalog_variant" : "same_listing_only",
    };
  }
  const exact = ["model", "gtin", "sku"].some((k) => matches.includes(k));
  const required = ["model", "bundle", "condition", "kind", "packCount"];
  let confidence = exact
    ? 0.7 + (0.3 * matches.length) / critical.length
    : 0.15;
  if (required.some((k) => missing.includes(k)))
    confidence = Math.min(confidence, 0.6);
  if (conflicts.length) confidence = 0;
  return {
    confidence,
    matches,
    conflicts,
    missing,
    blocked: conflicts.length > 0 || confidence < 0.8,
  };
}
export function variantKey(attrs, scope = "") {
  return createHash("sha256")
    .update(
      JSON.stringify([
        scope,
        critical.map((k) => [k, normalize(attrs[k])]),
        ...(attrs.listingScope || attrs.catalogScope
          ? [attrs.listingScope || attrs.catalogScope]
          : []),
      ]),
    )
    .digest("hex");
}
export function marketplaceUrl(input) {
  try {
    const u = new URL(input);
    if (u.protocol !== "https:" || u.username || u.password || u.port)
      return null;
    const host = u.hostname.toLowerCase();
    if (["amazon.in", "www.amazon.in"].includes(host)) {
      const id = u.pathname.match(
        /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i,
      )?.[1];
      return id
        ? {
            marketplace: "amazon",
            id: id.toUpperCase(),
            url: `https://www.amazon.in/dp/${id.toUpperCase()}`,
          }
        : null;
    }
    if (
      ["flipkart.com", "www.flipkart.com"].includes(host) &&
      u.pathname.includes("/p/")
    ) {
      const id = u.searchParams.get("pid");
      return id && /^[A-Z0-9]{8,32}$/i.test(id)
        ? {
            marketplace: "flipkart",
            id,
            url: `https://www.flipkart.com${u.pathname}?pid=${id}`,
          }
        : null;
    }
  } catch {}
  return null;
}
export function parsePrice(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) throw new Error("INVALID_PRICE");
    return Math.round(value * 100);
  }
  const s = String(value).trim();
  if (/emi|month|instal|usd|\$|per\s*(piece|unit)|\/\s*(mo|month)/i.test(s))
    throw new Error("NOT_FULL_INR_PRICE");
  const raw = s.replace(/^(₹|INR|Rs\.?)\s*/i, "");
  if (
    !/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(
      raw,
    )
  )
    throw new Error("INVALID_PRICE");
  const p = Math.round(Number(raw.replaceAll(",", "")) * 100);
  if (!Number.isSafeInteger(p) || p <= 0) throw new Error("INVALID_PRICE");
  return p;
}
