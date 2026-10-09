import robotsParser from "robots-parser";
import { EnvHttpProxyAgent, fetch as proxyFetch } from "undici";
import { publicUrl, listingUrl } from "./urls.js";
import { parsePrice } from "./identity.js";
import { ingest } from "./evidence.js";
import { getSettings, iso } from "./db.js";
import { ProviderError } from "./providers.js";
import {
  requestAllowed,
  beginRequest,
  finishRequest,
} from "./provider-state.js";
const dispatcher = new EnvHttpProxyAgent();
export async function robotsAllowed(
  url,
  { fetchImpl = proxyFetch, signal, timeoutMs = 10000 } = {},
) {
  const target = publicUrl(url);
  if (!target) throw new ProviderError("INVALID_URL");
  const robotsURL = new URL("/robots.txt", target).href;
  let response;
  try {
    response = await fetchImpl(robotsURL, {
      dispatcher,
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "GlitchHunterIndia" },
    });
  } catch {
    throw new ProviderError("ROBOTS_POLICY_UNAVAILABLE");
  }
  if (response.status === 404) return true;
  if (response.status !== 200)
    throw new ProviderError("ROBOTS_POLICY_UNAVAILABLE");
  const text = await response.text();
  if (text.length > 500000)
    throw new ProviderError("ROBOTS_POLICY_UNAVAILABLE");
  const rules = robotsParser(robotsURL, text);
  for (const ua of ["GlitchHunterIndia", "FirecrawlBot", "FirecrawlAgent", "*"])
    if (rules.isAllowed(target.href, ua) === false)
      throw new ProviderError("ROBOTS_DISALLOWED");
  return true;
}
export function extractStructuredObservation(
  document,
  { url, category = "Extracted listing" } = {},
) {
  const source = listingUrl(document.metadata?.sourceURL),
    target = listingUrl(url);
  if (!source || !target || source.url !== target.url)
    return { status: "unverified", reasons: ["VARIANT_URL_MISMATCH"] };
  if (
    /(?:robot check|verify you are human|captcha challenge|access denied)/i.test(
      document.html,
    )
  )
    return { status: "unverified", reasons: ["ACCESS_CONTROL_PAGE"] };
  const records = [];
  let malformed = false;
  const collect = (x) => {
    if (Array.isArray(x)) x.forEach(collect);
    else if (x && typeof x === "object") {
      records.push(x);
      if (Array.isArray(x["@graph"])) x["@graph"].forEach(collect);
    }
  };
  for (const match of document.html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    try {
      collect(JSON.parse(match[1]));
    } catch {
      malformed = true;
    }
  }
  if (malformed)
    return { status: "unverified", reasons: ["MALFORMED_STRUCTURED_DATA"] };
  const products = records.filter((x) =>
    [x["@type"]]
      .flat()
      .some((t) => t === "Product" || t === "https://schema.org/Product"),
  );
  if (products.length !== 1)
    return {
      status: "unverified",
      reasons: [
        products.length ? "AMBIGUOUS_PRODUCT" : "NO_STRUCTURED_PRODUCT",
      ],
    };
  const p = products[0],
    offers = [p.offers].flat().filter(Boolean);
  if (
    offers.length !== 1 ||
    !["Offer", "https://schema.org/Offer"].includes(offers[0]["@type"])
  )
    return { status: "unverified", reasons: ["AMBIGUOUS_OFFER"] };
  const offer = offers[0],
    props = Object.fromEntries(
      [p.additionalProperty]
        .flat()
        .filter((x) => x && typeof x.name === "string")
        .map((x) => [x.name.toLowerCase(), x.value]),
    );
  const names = [p.additionalProperty]
    .flat()
    .filter((x) => x && typeof x.name === "string")
    .map((x) => x.name.toLowerCase());
  if (
    new Set(names).size !== names.length ||
    (p.url && listingUrl(p.url)?.url !== target.url)
  )
    return { status: "unverified", reasons: ["AMBIGUOUS_VARIANT"] };
  const attributes = {
    brand: typeof p.brand === "string" ? p.brand : p.brand?.name,
    model: p.model,
    bundle: props.bundle,
    capacity: props.capacity,
    colour: p.color || props.colour,
    generation: props.generation,
    kind: props.kind,
    packCount: Number(props.packcount),
    condition:
      offer.itemCondition === "https://schema.org/NewCondition"
        ? "new"
        : offer.itemCondition === "https://schema.org/UsedCondition"
          ? "used"
          : offer.itemCondition === "https://schema.org/RefurbishedCondition"
            ? "refurbished"
            : undefined,
  };
  if (
    [
      "model",
      "bundle",
      "capacity",
      "colour",
      "generation",
      "condition",
      "kind",
      "brand",
    ].some((k) => typeof attributes[k] !== "string" || !attributes[k].trim()) ||
    !Number.isInteger(attributes.packCount) ||
    attributes.packCount < 1
  )
    return { status: "unverified", reasons: ["AMBIGUOUS_VARIANT"] };
  if (offer.priceCurrency !== "INR")
    return { status: "unverified", reasons: ["CURRENCY_MISMATCH"] };
  if (offer.priceValidUntil && Date.parse(offer.priceValidUntil) < Date.now())
    return { status: "unverified", reasons: ["EXPIRED_OFFER"] };
  if (offer.url && listingUrl(offer.url)?.url !== target.url)
    return { status: "unverified", reasons: ["VARIANT_URL_MISMATCH"] };
  if (
    offer.priceSpecification ||
    offer.priceType ||
    offer.eligibleQuantity ||
    offer.eligibleCustomerType ||
    /(?:emi|instalment|installment|coupon|cashback|exchange|subscription)/i.test(
      String(offer.name || ""),
    )
  )
    return { status: "unverified", reasons: ["CONDITIONAL_PRICE"] };
  let price;
  try {
    price = parsePrice(offer.price);
  } catch {
    return { status: "unverified", reasons: ["INVALID_FULL_PRICE"] };
  }
  const seller =
    typeof offer.seller === "string" ? offer.seller : offer.seller?.name;
  if (!seller) return { status: "unverified", reasons: ["SELLER_UNKNOWN"] };
  const stock =
    offer.availability === "https://schema.org/InStock"
      ? "in_stock"
      : offer.availability === "https://schema.org/OutOfStock"
        ? "out_of_stock"
        : null;
  if (!stock)
    return { status: "unverified", reasons: ["AVAILABILITY_UNKNOWN"] };
  return {
    status: "product_page_observed",
    observation: {
      title: p.name,
      category,
      url: target.url,
      seller,
      pricePaise: price,
      currency: "INR",
      priceType: "full",
      observedAt: document.retrievedAt,
      sourceRef: source.url,
      stock,
      attributes,
    },
  };
}
export function enqueueExtraction(
  db,
  url,
  category = "Manual URL",
  { recheck = false } = {},
) {
  const target = publicUrl(url);
  if (!target) throw new ProviderError("INVALID_URL");
  if (!getSettings(db).scrapeAllowedDomains.includes(target.hostname))
    throw new ProviderError("DOMAIN_NOT_APPROVED");
  const canonical = listingUrl(target.href)?.url || target.href;
  const job = db
    .prepare(
      "SELECT id FROM extraction_jobs WHERE url=? AND status IN ('queued','running','retry')",
    )
    .get(canonical);
  if (job) return { id: job.id, deduplicated: true };
  const cached = db
    .prepare(
      "SELECT id FROM extraction_jobs WHERE url=? AND status IN ('done','unverified') AND finished_at>? ORDER BY id DESC LIMIT 1",
    )
    .get(
      canonical,
      new Date(Date.now() - getSettings(db).cacheMinutes * 60000).toISOString(),
    );
  if (cached && !recheck) return { id: cached.id, cached: true };
  if (
    db
      .prepare(
        "SELECT COUNT(*) n FROM extraction_jobs WHERE status IN ('queued','running','retry')",
      )
      .get().n >= 50
  )
    throw new ProviderError("QUEUE_FULL");
  const r = db
    .prepare(
      "INSERT INTO extraction_jobs(url,category,run_at,created_at) VALUES(?,?,?,?)",
    )
    .run(canonical, category, iso(), iso());
  return { id: Number(r.lastInsertRowid) };
}
export async function runExtraction(
  db,
  job,
  provider,
  { signal, robotsCheck = robotsAllowed } = {},
) {
  const settings = getSettings(db);
  let usage;
  try {
    const target = publicUrl(job.url);
    if (!target || !settings.scrapeAllowedDomains.includes(target.hostname))
      throw new ProviderError("DOMAIN_NOT_APPROVED");
    db.prepare(
      "UPDATE extraction_jobs SET status='running',attempts=attempts+1 WHERE id=?",
    ).run(job.id);
    await robotsCheck(job.url, {
      signal,
      timeoutMs: Math.min(settings.requestTimeoutMs, 10000),
    });
    if (signal?.aborted) throw new ProviderError("CANCELLED");
    if (!requestAllowed(db)) {
      db.prepare("UPDATE extraction_jobs SET status='queued' WHERE id=?").run(
        job.id,
      );
      return;
    }
    usage = beginRequest(db, "scrape");
    const document = await provider.scrape(job.url, {
      signal,
      timeoutMs: settings.requestTimeoutMs,
    });
    if (signal?.aborted) throw new ProviderError("CANCELLED");
    const extracted = extractStructuredObservation(document, {
      url: job.url,
      category: job.category,
    });
    let observationId = null;
    if (extracted.observation) {
      try {
        const saved = ingest(db, extracted.observation, {
          provider: "firecrawl",
          reliability: 0.65,
          purchaseStatus: "PRODUCT_PAGE_OBSERVED",
          sourceGroup: `seller:${target.hostname}:${extracted.observation.seller.toLowerCase().trim()}`,
        });
        observationId = saved.observationId;
      } catch {
        extracted.status = "unverified";
        extracted.reasons = ["INVALID_LISTING_DETAILS"];
      }
    }
    finishRequest(db, usage, "success", document.creditsUsed);
    db.prepare(
      "UPDATE extraction_jobs SET status=?,result=?,observation_id=?,finished_at=?,error=NULL WHERE id=?",
    ).run(
      observationId ? "done" : "unverified",
      JSON.stringify({
        status: extracted.status,
        reasons: extracted.reasons || [],
        sourceURL: document.metadata.sourceURL,
        retrievedAt: document.retrievedAt,
        provider: "firecrawl",
        verification: observationId
          ? "PRODUCT_PAGE_OBSERVED"
          : "UNVERIFIED_PAGE",
      }),
      observationId,
      iso(),
      job.id,
    );
  } catch (e) {
    const code = signal?.aborted ? "CANCELLED" : e.code || "EXTRACTION_FAILED";
    if (usage) finishRequest(db, usage, code, null, e);
    const retry =
      [
        "RATE_LIMITED",
        "PROVIDER_TIMEOUT_OR_NETWORK",
        "PROVIDER_TRANSIENT_ERROR",
      ].includes(code) && job.attempts < 2;
    const seconds = Math.max(e.retryAfter || 0, 30 * 2 ** job.attempts);
    db.prepare(
      "UPDATE extraction_jobs SET status=?,error=?,run_at=?,finished_at=? WHERE id=?",
    ).run(
      code === "CANCELLED" ? "cancelled" : retry ? "retry" : "unverified",
      code,
      new Date(Date.now() + seconds * 1000).toISOString(),
      retry ? null : iso(),
      job.id,
    );
  }
}

// Bound automated follow-up to three approved pages; the worker enforces robots,
// request spacing and the shared daily budget before every paid extraction.
export function enqueueSearchPriceChecks(db, queryId, limit = 3) {
  const settings = getSettings(db);
  const results = db
    .prepare(
      "SELECT url FROM search_results WHERE query_id=? AND expires_at>? ORDER BY observed_at DESC,id DESC",
    )
    .all(queryId, iso());
  const checks = [];
  for (const row of results) {
    if (checks.length >= limit) break;
    if (!settings.scrapeAllowedDomains.includes(new URL(row.url).hostname))
      continue;
    try {
      checks.push(enqueueExtraction(db, row.url, "Search price check"));
    } catch (e) {
      if (e.code !== "QUEUE_FULL") throw e;
      break;
    }
  }
  return checks;
}
