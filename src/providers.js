import { EnvHttpProxyAgent, fetch as proxyFetch } from "undici";
import { normalizeLead, publicUrl } from "./urls.js";
const dispatcher = new EnvHttpProxyAgent();
export class ProviderError extends Error {
  constructor(code, retryAfter = 0) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
export const registry = (db, { key = process.env.FIRECRAWL_API_KEY } = {}) => {
  const health = db
    ?.prepare("SELECT * FROM provider_health WHERE provider=?")
    .get("firecrawl");
  const recentRequests =
    db
      ?.prepare(
        "SELECT operation,occurred_at,outcome,credits_used FROM usage WHERE provider=? ORDER BY id DESC LIMIT 10",
      )
      .all("firecrawl") || [];
  let status = key ? "configured_unverified" : "credentials_missing";
  if (key && health) {
    if (Date.parse(health.blocked_until) > Date.now())
      status =
        health.block_reason === "QUOTA_EXHAUSTED"
          ? "quota_exhausted"
          : "rate_limited";
    else if (
      health.last_outcome === "success" ||
      (health.last_outcome === "CANCELLED" && health.last_success_at)
    )
      status = "operational";
    else if (
      health.last_outcome &&
      !["pending", "CANCELLED"].includes(health.last_outcome)
    )
      status = "configured_failing";
  }
  return [
    {
      id: "firecrawl",
      name: "Firecrawl",
      status,
      capabilities: ["discovery", "permitted_page_extraction"],
      requirements: ["FIRECRAWL_API_KEY"],
      lastSuccessAt: health?.last_success_at || null,
      lastDiscoveryAt:
        db
          ?.prepare(
            "SELECT MAX(occurred_at) at FROM usage WHERE provider='firecrawl' AND operation='search' AND outcome='success'",
          )
          .get()?.at || null,
      blockedUntil: health?.blocked_until || null,
      recentRequests,
      note: "Bounded v2 web search. Page extraction requires approved domains and robots permission. Search does not verify purchase prices.",
    },
    {
      id: "amazon",
      name: "Amazon Creators API",
      status: "documentation_access_required",
      capabilities: [],
      requirements: [
        "Eligible Amazon affiliate account",
        "Current India API contract and credentials",
      ],
      note: "Official marketplace API boundary; current access remains unverified.",
    },
    {
      id: "flipkart",
      name: "Flipkart Affiliate",
      status: "documentation_access_required",
      capabilities: [],
      requirements: ["Approved affiliate access", "Current API contract"],
      note: "Official marketplace API boundary; current access remains unverified.",
    },
    {
      id: "history",
      name: "External price history",
      status: "not_configured",
      capabilities: [],
      requirements: ["Licensed variant-level historical source"],
      note: "No all-time-low claims without validated provenance.",
    },
  ];
};
export class UnavailableMarketplace {
  constructor(id) {
    this.id = id;
  }
  async search() {
    throw new ProviderError("PROVIDER_DOCUMENTATION_ACCESS_REQUIRED");
  }
  async recheck() {
    throw new ProviderError("MANUAL_CHECKOUT_REQUIRED");
  }
}
export class FirecrawlDiscovery {
  constructor({
    key = process.env.FIRECRAWL_API_KEY,
    fetchImpl = proxyFetch,
  } = {}) {
    this.id = "firecrawl";
    this.key = key;
    this.fetch = fetchImpl;
  }
  async request(path, payload, { timeoutMs = 30000, signal } = {}) {
    if (!this.key) throw new ProviderError("CREDENTIALS_MISSING");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000)
      throw new ProviderError("INVALID_OPTIONS");
    let r;
    try {
      r = await this.fetch(`https://api.firecrawl.dev/v2/${path}`, {
        dispatcher,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.key}`,
        },
        body: JSON.stringify(payload),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs + 5000)])
          : AbortSignal.timeout(timeoutMs + 5000),
        redirect: "error",
      });
    } catch {
      throw new ProviderError(
        signal?.aborted ? "CANCELLED" : "PROVIDER_TIMEOUT_OR_NETWORK",
      );
    }
    if (!r.ok) {
      const h = r.headers.get("retry-after"),
        retry =
          Number(h) || Math.max(0, (Date.parse(h) - Date.now()) / 1000) || 60;
      throw new ProviderError(
        r.status === 429
          ? "RATE_LIMITED"
          : r.status === 402
            ? "QUOTA_EXHAUSTED"
            : [401, 403].includes(r.status)
              ? "PROVIDER_ACCESS_DENIED"
              : r.status >= 500
                ? "PROVIDER_TRANSIENT_ERROR"
                : "PROVIDER_HTTP_ERROR",
        retry,
      );
    }
    let data;
    try {
      data = await r.json();
    } catch {
      throw new ProviderError("PROVIDER_RESPONSE_INVALID");
    }
    if (
      !data ||
      data.success !== true ||
      !data.data ||
      typeof data.data !== "object"
    )
      throw new ProviderError("PROVIDER_RESPONSE_INVALID");
    return data;
  }
  async search(query, { limit = 10, timeoutMs = 30000, signal } = {}) {
    if (typeof query !== "string" || !query.trim() || query.length > 350)
      throw new ProviderError("INVALID_QUERY");
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new ProviderError("INVALID_OPTIONS");
    const response = await this.request(
      "search",
      {
        query,
        sources: ["web"],
        country: "IN",
        limit,
        timeout: timeoutMs,
        ignoreInvalidURLs: true,
      },
      { timeoutMs, signal },
    );
    if (!Array.isArray(response.data.web))
      throw new ProviderError("PROVIDER_RESPONSE_INVALID");
    const seen = new Set(),
      results = [];
    const retrievedAt = new Date().toISOString();
    for (const item of response.data.web.slice(0, limit)) {
      if (!item || typeof item !== "object")
        throw new ProviderError("PROVIDER_RESPONSE_INVALID");
      const lead = normalizeLead(item, { retrievedAt });
      if (lead && !seen.has(lead.url)) {
        seen.add(lead.url);
        results.push(lead);
      }
    }
    // Credits are provider-reported, never inferred from a guessed pricing tier.
    return {
      results,
      creditsUsed:
        Number.isFinite(response.creditsUsed) && response.creditsUsed >= 0
          ? response.creditsUsed
          : null,
    };
  }
  async scrape(url, { timeoutMs = 30000, signal } = {}) {
    const target = publicUrl(url);
    if (!target) throw new ProviderError("INVALID_URL");
    const response = await this.request(
      "scrape",
      {
        url: target.href,
        formats: ["rawHtml", "markdown"],
        onlyMainContent: false,
        proxy: "basic",
        maxAge: 0,
        storeInCache: false,
        timeout: timeoutMs,
      },
      { timeoutMs, signal },
    );
    const d = response.data;
    if (
      typeof d.rawHtml !== "string" ||
      !d.metadata ||
      d.metadata.statusCode !== 200
    )
      throw new ProviderError("PAGE_UNAVAILABLE");
    const source = publicUrl(d.metadata.sourceURL);
    if (!source || source.hostname !== target.hostname)
      throw new ProviderError("REDIRECT_REQUIRES_REVIEW");
    return {
      html: d.rawHtml.slice(0, 2000000),
      markdown:
        typeof d.markdown === "string" ? d.markdown.slice(0, 20000) : null,
      retrievedAt: new Date().toISOString(),
      metadata: { sourceURL: source.href, statusCode: d.metadata.statusCode },
      creditsUsed:
        Number.isFinite(d.metadata.creditsUsed) && d.metadata.creditsUsed >= 0
          ? d.metadata.creditsUsed
          : null,
    };
  }
}
