import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { marketplaceUrl } from "./identity.js";
export function publicUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      isIP(host) ||
      host.includes(":") ||
      !host.includes(".") ||
      host === "localhost" ||
      /\.(?:localhost|local|internal|test|invalid)$/.test(host)
    )
      return null;
    if (!/^[a-z0-9.-]+$/.test(host) || /^[\d.]+$/.test(host)) return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (/^utm_|^(gclid|fbclid)$/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    return u;
  } catch {
    return null;
  }
}
export function listingUrl(value) {
  const url = publicUrl(value);
  if (!url) return null;
  const market = marketplaceUrl(url.href);
  if (market) return market;
  // Preserve strict marketplace ID matching; malformed marketplace URLs remain leads only.
  if (/(^|\.)(amazon\.in|flipkart\.com)$/.test(url.hostname)) return null;
  return {
    marketplace: "other",
    id: createHash("sha256").update(url.href).digest("hex"),
    url: url.href,
  };
}
export function normalizeLead(
  item,
  { provider = "firecrawl", retrievedAt = new Date().toISOString() } = {},
) {
  const rawOriginal = item.originalUrl || item.url || item.metadata?.sourceURL;
  const original = publicUrl(rawOriginal);
  if (!original) return null;
  const listing = listingUrl(original.href);
  return {
    url: listing?.url || original.href,
    id: listing?.id || null,
    marketplace: listing?.marketplace || "other",
    originalUrl: new URL(rawOriginal).href,
    sourceDomain: original.hostname,
    provider,
    retrievedAt,
    title: String(
      item.title || item.metadata?.title || original.hostname,
    ).slice(0, 500),
    description: String(
      item.description || item.metadata?.description || "",
    ).slice(0, 1500),
    content:
      typeof item.markdown === "string" ? item.markdown.slice(0, 20000) : null,
    metadata: {
      ...(Number.isInteger(item.position ?? item.metadata?.position)
        ? { position: item.position ?? item.metadata.position }
        : {}),
      ...(typeof (item.category ?? item.metadata?.category) === "string"
        ? { category: (item.category ?? item.metadata.category).slice(0, 100) }
        : {}),
      ...(Number.isInteger(item.metadata?.statusCode)
        ? { statusCode: item.metadata.statusCode }
        : {}),
      ...(publicUrl(item.metadata?.sourceURL)
        ? { sourceURL: publicUrl(item.metadata.sourceURL).href }
        : {}),
    },
  };
}
