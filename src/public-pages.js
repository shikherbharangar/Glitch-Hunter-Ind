import { lookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch } from "undici";
import { publicUrl } from "./urls.js";
import { ProviderError } from "./providers.js";
import { robotsAllowed } from "./extraction.js";
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  return (
    isIP(address) === 6 &&
    /^[23]/i.test(address) &&
    !/^2001:db8:/i.test(address)
  );
}
// Pin the connection to the addresses we validated, including every address
// used by Node's automatic family selection. Never follow redirects.
export function publicLookup(hostname, options, callback) {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((x) => !publicAddress(x.address)))
      return callback(new Error("PRIVATE_ADDRESS_BLOCKED"));
    const eligible = addresses.filter(
      (x) => !options.family || x.family === options.family,
    );
    if (!eligible.length) return callback(new Error("ADDRESS_UNAVAILABLE"));
    if (options.all) callback(null, eligible);
    else callback(null, eligible[0].address, eligible[0].family);
  });
}
const dispatcher = new Agent({
  connect: { lookup: publicLookup },
  connections: 2,
});
export async function publicFetch(url, options = {}) {
  if (!publicUrl(String(url))) throw new ProviderError("INVALID_URL");
  return fetch(url, { ...options, dispatcher, redirect: "error" });
}
export class PublicPageReader {
  constructor({ fetchImpl = publicFetch } = {}) {
    this.id = "public_http";
    this.key = "public";
    this.fetchImpl = fetchImpl;
  }
  async robotsCheck(url, options) {
    return robotsAllowed(url, {
      ...options,
      fetchImpl: this.fetchImpl,
      userAgents: ["GlitchHunterIndia"],
    });
  }
  async scrape(url, { signal, timeoutMs = 10000 } = {}) {
    const timeout = AbortSignal.timeout(Math.min(timeoutMs, 15000));
    let response;
    try {
      response = await this.fetchImpl(url, {
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          "User-Agent": "GlitchHunterIndia",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch {
      throw new ProviderError(
        signal?.aborted ? "CANCELLED" : "PAGE_UNAVAILABLE",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(
        response.status === 429 ? "RATE_LIMITED" : "PAGE_UNAVAILABLE",
        300,
      );
    }
    if (
      !/text\/html|application\/xhtml\+xml/i.test(
        response.headers.get("content-type") || "",
      )
    ) {
      await response.body?.cancel();
      throw new ProviderError("NO_PRODUCT_HTML");
    }
    let html = "",
      size = 0;
    const decoder = new TextDecoder();
    for await (const part of response.body) {
      size += part.byteLength;
      if (size > 2000000) throw new ProviderError("PAGE_TOO_LARGE");
      html += decoder.decode(part, { stream: true });
    }
    html += decoder.decode();
    return {
      html,
      metadata: { sourceURL: url, statusCode: response.status },
      retrievedAt: new Date().toISOString(),
      creditsUsed: 0,
    };
  }
}
