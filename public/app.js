const $ = (s) => document.querySelector(s),
  main = $("#main");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (p) =>
  p == null
    ? "—"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }).format(p / 100);
const stamp = (d) =>
  d
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }).format(new Date(d)) + " IST"
    : "Never";
const human = (s) => String(s).replaceAll("_", " ").toLowerCase();
const tag = (s, style = "") =>
  `<span class="tag ${style}">${esc(human(s))}</span>`;
let state,
  view = "radar",
  filter = { text: "", market: "all", sort: "confidence" },
  toastTimer;
let searchDraft = "",
  selectedQueryId = null;
const expandedPanels = new Set();
async function api(path, method = "GET", body) {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) {
    if (r.status === 401) {
      login();
      throw new Error("Sign in to open the workspace.");
    }
    throw new Error(
      data.issues?.map((x) => x.path.join(".") + ": " + x.message).join("; ") ||
        data.error ||
        "Something went wrong. Please try again.",
    );
  }
  return data;
}
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 6000);
}
function heading(kicker, title, description, action = "") {
  return `<div class="eyebrow">${esc(kicker)}</div><div class="view-heading"><div><h1>${esc(title)}</h1><p class="subtitle">${esc(description)}</p></div>${action}</div>`;
}
const button = (text, action, cls = "") =>
  `<button class="button ${cls}" data-action="${action}">${text}</button>`;
function empty(title, description) {
  return `<div class="empty-simple"><h3>${esc(title)}</h3><p>${esc(description)}</p></div>`;
}
function providers() {
  return state.providers
    .map(
      (p) =>
        `<div class="provider-row"><span>${esc(p.name)}</span>${tag(p.status, p.status === "operational" ? "good" : "warning")}</div>`,
    )
    .join("");
}
function radar() {
  const radar = state.radar || {
    categories: [],
    products: [],
    trackedProducts: 0,
    collectedPrices: 0,
  };
  const s = state.settings;
  const possible = radar.products.filter(
    (p) => p.assessment.status === "possible_glitch",
  ).length;
  return (
    heading(
      "AUTOMATIC PRODUCT DISCOVERY",
      "Category radar.",
      "Choose categories once. The radar finds products, collects prices, and ranks unusual drops against matching evidence.",
      button("Refresh", "refresh-results"),
    ) +
    `<div class="summary-strip"><div class="readout"><small>Possible glitches</small><strong>${possible}</strong><em>Price and evidence thresholds met</em></div><div class="readout"><small>Tracked products</small><strong>${radar.trackedProducts}</strong><em>Prices collected over time</em></div><div class="readout"><small>Price observations</small><strong>${radar.collectedPrices}</strong><em>Saved on the persistent disk</em></div><div class="readout"><small>Radar</small><strong class="radar-status">${s.radarEnabled ? "ON" : "OFF"}</strong><em>${s.radarEnabled ? "Updates automatically" : "Choose categories to start"}</em></div></div>
    <details id="radar-setup" class="panel" ${s.radarEnabled ? "" : "open"}><summary>Categories & price sources</summary><form id="radar-form"><fieldset><legend>Tech and high-value equipment</legend><div class="category-choices">${radar.categories.map((c) => `<label><input type="checkbox" name="categories" value="${esc(c.id)}" ${s.radarCategories.includes(c.id) ? "checked" : ""}> ${esc(c.label)}</label>`).join("")}</div></fieldset><label>Permitted websites (exact domains, comma separated)<input name="domains" value="${esc(s.scrapeAllowedDomains.join(", "))}" placeholder="e.g. a retailer that permits public page access" required></label><p class="footnote">Only add websites whose terms permit these reads. Robots exclusions are respected. Blocked pages stay unverified.</p><div class="form-grid"><label>Focus on standard prices above ₹<input name="minPrice" type="number" min="0" max="100000000" value="${s.radarMinPricePaise / 100}" required></label><label>Scan categories every (minutes)<input name="cycle" type="number" min="30" max="10080" value="${s.radarCycleMinutes}" required></label><label>Collect product prices every (minutes)<input name="historyInterval" type="number" min="30" max="10080" value="${s.historyIntervalMinutes}" required></label><label>Direct page reads per day<input name="historyBudget" type="number" min="1" max="1000" value="${s.historyDailyBudget}" required></label></div><p class="footnote">Direct page reads need no history subscription. Discovery uses your Firecrawl credits, up to ${s.dailyBudget} requests per day. Prices are collected only while this app is running.</p><button class="button primary" type="submit">${s.radarEnabled ? "Save & scan categories" : "Start category radar"}</button> ${s.radarEnabled ? button("Pause radar", "pause-radar") : ""}</form></details>
    <div class="section-line"><h2>Products the radar found</h2><span>${radar.products.length} PRODUCTS / ${possible} POSSIBLE GLITCHES</span></div>
    <p class="footnote">Standard price means a matching seller comparison or a robust historical estimate—not MRP. New products start by collecting evidence; a search result alone is never a glitch.</p>
    ${radar.products.length ? `<div class="radar-grid">${radar.products.map((p) => `<article class="panel radar-card"><div class="meta">${esc(p.category)}</div><h2>${esc(p.title)}</h2>${priceAssessment({ assessment: p.assessment })}<dl><dt>Historical standard</dt><dd>${money(p.history?.typicalPaise)}</dd><dt>Matching seller standard</dt><dd>${money(p.marketPricePaise)}</dd><dt>History collected</dt><dd>${p.historyPoints} source-days</dd>${p.dropFraction != null ? `<dt>Below comparison price</dt><dd>${Math.round(p.dropFraction * 100)}%</dd>` : ""}${p.assessment.severity != null ? `<dt>Anomaly / evidence</dt><dd>${p.assessment.severity}/100 · ${p.assessment.confidence}/100</dd>` : ""}</dl><div class="row-actions"><a class="button primary small" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">View product ↗</a></div></article>`).join("")}</div>` : empty(s.radarEnabled ? "Finding products in your categories…" : "Your radar is ready to start.", s.radarEnabled ? "Discovery and permitted price checks run in the background. This page updates automatically; failures are visible in scan activity below." : "Select categories and permitted price sources above. No specific search query is needed.")}
    <details id="radar-activity" class="panel"><summary>Scan activity & unavailable prices</summary>${jobs()}${extractions()}</details>
    <details id="model-notes" class="panel"><summary>How the mathematical model works</summary><p>VIGIL 0.2 fits a robust trend to log prices using a time-weighted Theil–Sen slope and median absolute deviation. It combines unusual historical drops, independent seller prices and recent price changes. Scores measure anomaly strength and evidence support; they are not probabilities of an error.</p><p>At least eight independent source-days are needed for historical modelling. Listings with incomplete variant information are compared only against their own history. Identical variants can be compared across sellers. Estimated standard prices are labelled by their source, and checkout still needs your confirmation.</p></details>`
  );
}
function candidateTable() {
  const rows = state.candidates
    .filter(
      (c) =>
        (filter.market === "all" || c.marketplace === filter.market) &&
        `${c.title} ${c.category}`
          .toLowerCase()
          .includes(filter.text.toLowerCase()),
    )
    .sort((a, b) =>
      filter.sort === "freshness"
        ? b.observed_at.localeCompare(a.observed_at)
        : b.result[filter.sort] - a.result[filter.sort],
    );
  const header =
    '<div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable evidence table"><table><thead><tr><th>Product / source</th><th class="numeric">Observed</th><th class="numeric">Trusted low</th><th class="numeric">Typical</th><th class="numeric">Difference</th><th class="numeric">Severity</th><th class="numeric">Evidence</th><th>Purchase state</th></tr></thead><tbody>';
  if (!rows.length)
    return (
      header +
      "</tbody></table></div>" +
      `<div class="empty-state"><div class="radar-glyph" aria-hidden="true"></div><div><div class="eyebrow">${state.candidates.length ? "NO MATCHING CANDIDATES" : "AWAITING CREDIBLE EVIDENCE"}</div><h2>${state.candidates.length ? "Nothing matches these filters." : "A quiet radar is an honest radar."}</h2><p>${state.candidates.length ? "Adjust the marketplace or product filter." : "No observed prices yet. Connect a permitted search provider to discover listing leads, or record your own price observation for review. We never fill this ledger with sample deals."}</p><a class="button signal" href="#evidence">Record an observation <span>↗</span></a></div></div>`
    );
  return (
    header +
    rows
      .map(
        (c) =>
          `<tr><td class="product-title"><a href="#candidate/${c.id}">${esc(c.title)}</a><small>${esc(c.marketplace.toUpperCase())} / ${esc(c.category)}<br>${esc(stamp(c.observed_at))}</small></td><td class="numeric">${money(c.price_paise)}</td><td class="numeric">${money(c.result.statistics.trustedLowPaise)}</td><td class="numeric">${money(c.result.statistics.typicalPaise)}</td><td class="numeric">${c.result.expectedValue ? Math.round((c.price_paise / c.result.expectedValue.referencePaise - 1) * 100) + "%" : "—"}</td><td class="numeric">${c.result.severity}<small> / 100</small></td><td class="numeric">${c.result.confidence}<small> / 100</small></td><td>${tag(c.result.purchaseStatus, c.result.blocked ? "warning" : "")}${c.result.blocked ? "<br><small>ALERT SUPPRESSED</small>" : ""}${c.feedback === "false_positive" ? "<br><small>REJECTED BY USER</small>" : ""}</td></tr>`,
      )
      .join("") +
    "</tbody></table></div>"
  );
}
function queryForm(id = "query-form") {
  return `<form id="${id}" class="panel inline-form"><label>${id === "watch-form" ? "Product to monitor" : "What are you looking for?"}<input name="query" required minlength="3" maxlength="300" value="${id === "query-form" ? esc(searchDraft) : ""}" placeholder="e.g. 3D printer India"></label>${id === "watch-form" ? '<label>Label<input name="category" required maxlength="80" placeholder="Your research area"></label>' : ""}<button class="button primary" type="submit">${id === "watch-form" ? "Add monitor +" : "Search"}</button><p id="search-status" role="status" class="footnote"></p></form>`;
}
function priceAssessment(r) {
  const a = r.assessment || {
    label: "Price not checked",
    message: "No price evidence collected yet.",
  };
  return `<div class="notice ${a.status === "possible_glitch" ? "good" : ""}"><div><strong>${esc(a.label)}</strong><p>${esc(a.message)}</p>${a.pricePaise ? `<p>Observed price: <strong>${money(a.pricePaise)}</strong>${a.referencePaise ? ` · Comparison price: ${money(a.referencePaise)}` : ""}</p>` : ""}${a.candidateId ? `<a href="#candidate/${a.candidateId}">See price evidence ↗</a>` : ""}</div></div>`;
}
function discover() {
  const seen = new Set();
  const results = state.discoveries.filter((r) => {
    if (selectedQueryId !== null && r.query_id !== selectedQueryId)
      return false;
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
  const pending = state.jobs.filter((j) =>
    ["queued", "running", "retry"].includes(j.status),
  ).length;
  return (
    heading(
      "PRODUCT SEARCH",
      "Search results.",
      "Search for a product. Permitted product pages are checked for prices and compared against available evidence.",
      button("Refresh results ↻", "refresh-results"),
    ) +
    queryForm() +
    `<section id="search-results" aria-label="Search results"><div class="section-line"><h2>${results.length} ${results.length === 1 ? "result" : "results"}</h2><span>${selectedQueryId !== null ? "YOUR SEARCH" : "SAVED RESULTS"}</span></div>
    <p class="footnote">Up to three results from approved websites are checked automatically. A possible glitch needs matching price evidence; search snippets are not purchase prices.</p>${!state.settings.scrapeAllowedDomains.length ? '<div class="notice warning"><div><strong>Price checks need a permitted source</strong><p>No websites are approved for product-page access. Searches will return links until you add permitted exact domains in Settings. No external price history is connected.</p><a href="#settings">Set up price sources ↗</a></div></div>' : ""}
    ${results.length ? results.map((r) => `<article class="result-row"><div><div class="meta">${esc(r.source_domain || "Unknown website")} / ${esc(r.marketplace === "other" ? "Public website" : r.marketplace.toUpperCase())}</div><h3><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)} ↗</a></h3><p>${esc(r.description)}</p><div class="meta muted">Found ${esc(stamp(r.observed_at))}</div>${priceAssessment(r)}</div><div class="row-actions"><a class="button primary small" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Open listing ↗</a><button class="button small" data-action="check-price" data-id="${r.id}">Check price</button><button class="button small" data-action="watch-result" data-id="${r.id}">Monitor</button></div></article>`).join("") : empty("No results yet.", selectedQueryId !== null ? "Try a different brand or model. This search returned no matches." : "Enter a product above and press Search.")}
    </section>
    <details id="advanced-search" class="panel"><summary>Advanced tools</summary>
    <p>Optional background searches and price checks. Manual searches above work even when scheduled searches are off.</p>${button("Queue starter categories +", "seed")}
    <details id="price-check" class="panel"><summary>Check a product page for price evidence</summary><p>Review the website’s terms and approve its exact domain in Settings first. Ambiguous prices or variants stay unverified.</p><form id="url-form" class="inline-form"><label>Exact product URL<input name="url" type="url" required placeholder="Public HTTPS listing URL"></label><label>Category<input name="category" required maxlength="80"></label><label>Fresh recheck<select name="recheck"><option value="false">Use recent record</option><option value="true">Request fresh page</option></select></label><button class="button">Queue permitted extraction ↗</button></form></details>
    <details id="search-activity" class="panel"><summary>Search activity · ${pending} pending</summary><p class="footnote">Queries, retries and cancellations. Results are shown above.</p>${jobs()}</details>
    <details id="extraction-activity" class="panel"><summary>Page extraction activity</summary>${extractions()}</details></details>`
  );
}
function jobs() {
  return state.jobs.length
    ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable evidence table"><table><thead><tr><th>Query</th><th>Family</th><th>Status</th><th>Attempts</th><th>Next attempt</th><th>Action</th></tr></thead><tbody>${state.jobs.map((j) => `<tr><td class="product-title">${esc(j.query)}<small>${esc(j.category)}</small></td><td>${esc(j.family)}</td><td>${tag(j.status, j.error ? "warning" : "")}<br><small>${esc(j.error ? human(j.error) : "")}</small></td><td>${j.attempts}</td><td>${esc(stamp(j.run_at))}</td><td>${["queued", "retry", "running"].includes(j.status) ? `<button class="button small" data-action="cancel" data-id="${j.id}">Cancel</button>` : "—"}</td></tr>`).join("")}</tbody></table></div>`
    : empty("Queue is empty.", "Add a search on the Results page.");
}
function extractions() {
  return (
    '<div class="section-line"><h2>Page extraction queue</h2><span>NO CART OR CHECKOUT AUTOMATION</span></div>' +
    (state.extractions?.length
      ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Extraction status table"><table><thead><tr><th>URL</th><th>State</th><th>Evidence</th><th>Action</th></tr></thead><tbody>${state.extractions
          .map((x) => {
            let result;
            try {
              result = JSON.parse(x.result || "{}");
            } catch {
              result = {};
            }
            return `<tr><td class="product-title">${esc(x.url)}</td><td>${tag(x.status)}</td><td>${esc(human(x.error || result.reasons?.join(", ") || result.verification || "Awaiting extraction"))}</td><td>${["queued", "retry", "running"].includes(x.status) ? `<button class="button small" data-action="cancel-extraction" data-id="${x.id}">Cancel extraction</button>` : "—"}</td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : empty(
          "No page extraction requested.",
          "Manual evidence remains usable without a provider key.",
        ))
  );
}
function evidence() {
  return (
    heading(
      "03 / THE SOURCE RECORD",
      "Price evidence.",
      "Every observation has a variant, a timestamp and a source.",
    ) +
    `<div class="notice warning"><span>Manual observations remain unvalidated. They cannot create trusted historical lows or verified checkout claims.</span></div><div class="section-line"><h2>Observation register</h2><span>${state.coverage.observations} PERSISTED OBSERVATIONS</span></div>${state.candidates.length ? state.candidates.map((c) => `<div class="result-row"><div><a href="#candidate/${c.id}">${esc(c.title)}</a><p>${money(c.price_paise)} / ${esc(c.provider)} / ${esc(stamp(c.observed_at))}</p></div>${tag(c.result.purchaseStatus)}</div>`).join("") : empty("The evidence register is empty.", "Record a real observation below. Synthetic examples are restricted to automated tests.")}<form id="observation-form" class="panel"><h2>Record a price you observed</h2><p>Use the full INR price in paise (₹1 = 100 paise). Include exact configuration and source; incomplete identity suppresses alerts.</p><div class="form-grid"><label class="wide">Product title<input name="title" required maxlength="250"></label><label>Product URL<input name="url" type="url" required placeholder="Exact public HTTPS product URL"></label><label>Source reference URL<input name="sourceRef" type="url" required></label><label>Category<input name="category" required maxlength="250"></label><label>Seller<input name="seller" required maxlength="250"></label><label>Price (paise)<input name="pricePaise" type="number" min="1" step="1" required></label><label>Observed time (UTC ISO 8601)<input name="observedAt" required placeholder="YYYY-MM-DDTHH:mm:ss.sssZ"></label><label>Brand<input name="brand" maxlength="250"></label><label>Exact model<input name="model" required maxlength="250"></label><label>Bundle contents<input name="bundle" required maxlength="250"></label><label>Product kind<input name="kind" required placeholder="Complete printer / nozzle / battery"></label><label>Capacity / size<input name="capacity" maxlength="250"></label><label>Colour<input name="colour" maxlength="250"></label><label>Generation<input name="generation" maxlength="250"></label><label>Pack count<input name="packCount" type="number" min="1" step="1" value="1" required></label><label>Condition<select name="condition"><option value="new">New</option><option value="used">Used</option><option value="refurbished">Refurbished</option></select></label><label>Stock<select name="stock"><option value="unknown">Unknown</option><option value="in_stock">In stock</option><option value="out_of_stock">Out of stock</option></select></label><label>Price type<select name="priceType"><option value="full">Full price</option><option value="emi">EMI instalment</option><option value="coupon">Conditional coupon</option><option value="pack">Pack price</option></select></label><div class="wide"><button class="button primary">Save observation +</button></div></div></form>`
  );
}
function watchlist() {
  return (
    heading(
      "04 / RECURRING RESEARCH",
      "Keep watch.",
      "Monitor product models or categories within the same search budget.",
    ) +
    queryForm("watch-form") +
    `<div class="section-line"><h2>Active monitors</h2><span>${state.watchlist.length} SAVED</span></div>${state.watchlist.length ? state.watchlist.map((w) => `<div class="result-row"><div><h3>${esc(w.label)}</h3><p>${esc(w.query)}</p><small class="muted">Requeued after cache expiry while scanning is enabled.</small></div><button class="button small" data-action="remove-watch" data-id="${w.id}">Remove</button></div>`).join("") : empty("No monitors yet.", "Add a category or exact model. Monitoring only runs when scanning is enabled.")}`
  );
}
function health() {
  return (
    heading(
      "05 / DIAGNOSTICS",
      "System health.",
      "Observed capabilities, request costs and failures.",
    ) +
    `<div class="section-line"><h2>Provider capability registry</h2><span>NO SILENT FALLBACKS</span></div>${state.providers.map((p) => `<section class="panel"><div class="section-line"><h2>${esc(p.name)}</h2>${tag(p.status, "warning")}</div><p>${esc(p.note)}</p><dl><dt>Capabilities</dt><dd>${esc(p.capabilities.join(", ") || "Unavailable")}</dd><dt>Requirements</dt><dd>${esc(p.requirements.join(" · "))}</dd>${p.id === "firecrawl" ? `<dt>Last successful discovery</dt><dd>${esc(stamp(p.lastDiscoveryAt))}</dd><dt>Last successful request</dt><dd>${esc(stamp(p.lastSuccessAt))}</dd><dt>Provider pause until</dt><dd>${esc(stamp(p.blockedUntil))}</dd>` : ""}</dl>${p.recentRequests?.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Provider request history"><table><thead><tr><th>Time</th><th>Operation</th><th>Outcome</th><th>Reported credits</th></tr></thead><tbody>${p.recentRequests.map((r) => `<tr><td>${esc(stamp(r.occurred_at))}</td><td>${esc(r.operation)}</td><td>${esc(human(r.outcome))}</td><td>${r.credits_used ?? "Unknown"}</td></tr>`).join("")}</tbody></table></div>` : ""}</section>`).join("")}<div class="below-grid"><div><h2>Measured coverage</h2><dl>${Object.entries(
      state.coverage,
    )
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`)
      .join(
        "",
      )}<dt>Requests today</dt><dd>${state.usage.requests}</dd><dt>Provider-reported credits</dt><dd>${state.usage.reportedCredits ?? "Unknown"}${state.usage.unknownCreditRequests ? " / some requests unreported" : ""}</dd><dt>Estimated API cost</dt><dd>${state.usage.unknownCostRequests ? "Unknown for " + state.usage.unknownCostRequests + " requests" : state.usage.knownCost == null ? "No requests" : state.usage.knownCost.toFixed(4) + " (configured currency)"}</dd></dl></div><div><h2>Notification delivery</h2><dl><dt>Telegram</dt><dd>${tag(state.notifications.telegram)}</dd><dt>Email</dt><dd>${tag(state.notifications.email)}</dd><dt>Alerts enabled</dt><dd>${state.settings.alertsEnabled ? "Yes" : "No"}</dd></dl><p class="footnote">Only candidates above both thresholds qualify. Nothing is sent without configured credentials and enabled alerts.</p>${button("Process eligible alerts", "notify")}</div></div><h2>Recent jobs</h2>${jobs()}`
  );
}
function settings() {
  const s = state.settings;
  return (
    heading(
      "06 / CONFIGURATION",
      "Set the boundaries.",
      "Control spend, evidence thresholds and notification behaviour.",
    ) +
    `<section class="panel"><h2>Provider credentials</h2><p>Set <code>FIRECRAWL_API_KEY</code> securely in environment settings or the local .env file, then restart the server. Credentials are never returned to the browser.</p><p>Firecrawl search discovers leads. Page extraction requires approved domains and robots permission. Check your plan’s rate, quota, cost and storage permissions. Amazon and Flipkart adapters are unavailable until current official contracts and access are verified.</p>${providers()}</section><form id="settings-form" class="panel"><h2>Search & alert policy</h2><div class="form-grid"><label>Daily request budget<input name="dailyBudget" type="number" min="1" max="10000" value="${s.dailyBudget}" required></label><label>Request timeout (milliseconds)<input name="requestTimeoutMs" type="number" min="1000" max="120000" value="${s.requestTimeoutMs}" required></label><label>Results per search (1–20)<input name="searchResultLimit" type="number" min="1" max="20" value="${s.searchResultLimit}" required></label><label class="wide">Approved extraction domains (comma separated)<input name="scrapeAllowedDomains" value="${esc(s.scrapeAllowedDomains.join(", "))}" placeholder="Empty disables page extraction"></label><label>Estimated cost per extraction<input name="costPerScrape" type="number" min="0" max="100" step="0.000001" value="${s.costPerScrape ?? ""}" placeholder="Unknown until configured"></label><label>Minimum request interval (seconds)<input name="intervalSeconds" type="number" min="2" max="86400" value="${s.intervalSeconds}" required></label><label>Cache lifetime (minutes)<input name="cacheMinutes" type="number" min="5" max="10080" value="${s.cacheMinutes}" required></label><label>Cost per request (plan currency)<input name="costPerSearch" type="number" min="0" max="100" step="0.000001" value="${s.costPerSearch ?? ""}" placeholder="Unknown until configured"></label><label>Minimum severity / 100<input name="severityThreshold" type="number" min="50" max="100" value="${s.severityThreshold}" required></label><label>Minimum evidence / 100<input name="confidenceThreshold" type="number" min="50" max="100" value="${s.confidenceThreshold}" required></label><label><input name="scanEnabled" type="checkbox" ${s.scanEnabled ? "checked" : ""}> Enable scheduled searches</label><label><input name="alertsEnabled" type="checkbox" ${s.alertsEnabled ? "checked" : ""}> Enable outbound alerts</label></div><details><summary>VIGIL signal weights / provisional, uncalibrated</summary><div class="form-grid">${Object.entries(
      s.weights,
    )
      .map(
        ([k, v]) =>
          `<label>${k} weight<input name="weight${k}" type="number" min="0" max="${k === "R" ? 0.1 : 1}" step="0.01" value="${v}" required></label>`,
      )
      .join(
        "",
      )}</div></details><button class="button primary">Save policy</button></form><div class="panel"><h2>Notification configuration</h2><p>Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID. Email: SMTP_HOST, SMTP_USER, SMTP_PASSWORD, ALERT_EMAIL_FROM, ALERT_EMAIL_TO (TLS port 465).</p><p>Credentials alone do not send messages. Enable alerts above after configuring your own destination.</p></div>`
  );
}
function chart(history, baselines, currentId) {
  if (!history.length)
    return empty("No historical observations.", "No curve is inferred.");
  const prices = [
      ...history.map((h) => h.price_paise),
      ...baselines.map((b) => b.price_paise),
    ],
    max = Math.max(...prices) * 1.1,
    times = history.map((h) => Date.parse(h.observed_at)),
    minT = Math.min(...times),
    maxT = Math.max(...times),
    x = (t) => 90 + ((t - minT) / (maxT - minT || 1)) * 600,
    y = (p) => 220 - (p / max) * 190;
  return `<div class="chart-wrap" tabindex="0" role="region" aria-label="Scrollable price history chart"><svg class="chart" viewBox="0 0 750 280" role="img" aria-label="Actual price observations as points, with a zero-based INR axis; no interpolation"><line x1="90" x2="700" y1="220" y2="220"/>${[0, 0.5, 1].map((f) => `<line x1="90" x2="700" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="0" y="${y(max * f) + 4}">${esc(money(Math.round(max * f)))}</text>`).join("")}${baselines.map((b) => `<line class="baseline" x1="90" x2="700" y1="${y(b.price_paise)}" y2="${y(b.price_paise)}"><title>${esc(b.kind)} / ${esc(b.source_ref)}</title></line>`).join("")}${history.map((h) => `<circle cx="${x(Date.parse(h.observed_at))}" cy="${y(h.price_paise)}" r="${h.id === currentId ? 6 : 4}" class="${h.id === currentId ? "current-point" : ""}"><title>${h.id === currentId ? "Candidate observation / " : ""}${esc(money(h.price_paise))} / ${esc(stamp(h.observed_at))} / ${esc(h.provider)}</title></circle>`).join("")}<text x="90" y="255">${esc(new Date(minT).toISOString().slice(0, 10))}</text><text x="610" y="255">${esc(new Date(maxT).toISOString().slice(0, 10))}</text></svg></div>`;
}
async function candidate(id) {
  main.innerHTML =
    '<div class="loading" role="status">Loading candidate evidence…</div>';
  const d = await api("/candidates/" + id);
  if (location.hash !== `#candidate/${id}`) return;
  const r = d.result,
    c = d.current;
  main.innerHTML = `<div class="eyebrow"><a href="#radar">← RADAR</a> / CANDIDATE ${d.id}</div><div class="view-heading"><div><h1 class="detail-title">${esc(c.title)}</h1><p class="subtitle">${esc(c.marketplace.toUpperCase())} / ${esc(c.seller)} / ${esc(stamp(c.observed_at))}</p></div><a class="button primary" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Open listing ↗</a></div><div class="notice warning"><span>${r.blocked ? "ALERT SUPPRESSED / This evidence fails an integrity or freshness gate." : "PENDING MANUAL VERIFICATION / A severe anomaly does not establish buyability."}</span>${tag(r.purchaseStatus)}</div><div class="summary-strip"><div class="readout"><small>Observed price</small><strong>${money(c.price_paise)}</strong><em>${esc(c.stock)}</em></div><div class="readout"><small>Anomaly severity</small><strong>${r.severity} / 100</strong><em>Provisional ranking score</em></div><div class="readout"><small>Evidence confidence</small><strong>${r.confidence} / 100</strong><em>Identity ${Math.round(r.identity.confidence * 100)} / 100</em></div><div class="readout"><small>Potential saving</small><strong>${money(r.expectedValue?.savingPaise)}</strong><em>${esc(r.expectedValue?.provenance || "No trustworthy baseline")}</em></div></div><div class="section-line"><h2>Observed price history</h2><span>POINTS ONLY / NO INFERRED INTERVALS</span></div>${chart(d.history, d.baselines, c.id)}<p class="footnote">Outlined point: candidate observation. Detected ${esc(stamp(d.created_at))}. No connecting line is drawn across unobserved intervals. Dashed reference lines retain the provenance listed below. A scanner low is not an all-time low.</p><div class="below-grid"><section><h2>VIGIL signal decomposition</h2><dl>${Object.entries(
    r.signals,
  )
    .map(
      ([k, v]) =>
        `<dt>${k} / ${{ H: "Historical rarity", L: "Trusted low breach", M: "Market disagreement", T: "Temporal change", R: "Listing integrity" }[k]}</dt><dd>${v == null ? "Unavailable" : v.toFixed(3)} · weight ${r.weights[k]}</dd>`,
    )
    .join(
      "",
    )}<dt>Comparable history</dt><dd>${r.statistics.n} source-days</dd><dt>Scanner low</dt><dd>${money(r.statistics.scannerLowPaise)}</dd><dt>Trusted low</dt><dd>${money(r.statistics.trustedLowPaise)}</dd></dl></section><section><h2>Exact variant</h2><dl>${Object.entries(
    c.attributes,
  )
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
    .join(
      "",
    )}</dl></section></div><details><summary>Comparison integrity audit / matches, conflicts and missing attributes</summary><div class="table-wrap" tabindex="0" role="region" aria-label="Identity comparison table"><table><thead><tr><th>Evidence</th><th>Identity</th><th>Matching</th><th>Conflicting</th><th>Missing</th></tr></thead><tbody>${r.comparisonAudit.map((a) => `<tr><td>${esc(a.kind)} / ${esc(stamp(a.observedAt))}</td><td>${Math.round(a.confidence * 100)} / 100</td><td>${esc(a.matches.join(", "))}</td><td>${esc(a.conflicts.join(", ") || "None")}</td><td>${esc(a.missing.join(", ") || "None")}</td></tr>`).join("")}</tbody></table></div></details><div class="reasons">${[...r.reasons, ...c.quality].map((x) => tag(x, "warning")).join("")}</div><div class="panel"><h2>Review actions</h2><p>Check the listing yourself. This application does not open carts or complete purchases. A manual action here cannot manufacture verified checkout evidence.</p><div class="row-actions"><button class="button" data-action="expire" data-id="${d.id}">Price disappeared</button><button class="button" data-action="unavailable" data-id="${d.id}">Unavailable</button><button class="button" data-action="reject" data-id="${d.id}">Mark false positive</button><button class="button" data-action="useful" data-id="${d.id}">Mark useful evidence</button></div><p>Review: ${esc(d.feedback || "pending")}</p></div><div class="section-line"><h2>Source ledger</h2><span>ALL RECORDED OBSERVATIONS</span></div><div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable evidence table"><table><thead><tr><th>Time</th><th>Price</th><th>Provider</th><th>Source</th><th>Quality</th></tr></thead><tbody>${d.history.map((h) => `<tr><td>${esc(stamp(h.observed_at))}</td><td>${money(h.price_paise)}</td><td>${esc(h.provider)}</td><td class="product-title">${esc(h.source_ref)}</td><td>${esc(h.quality.join(", "))}</td></tr>`).join("")}</tbody></table></div><h2>Baseline provenance</h2>${d.baselines.length ? d.baselines.map((b) => `<p class="footnote">${esc(b.kind)} / ${money(b.price_paise)} / ${esc(b.source_ref)} / ${esc(stamp(b.observed_at))}</p>`).join("") : empty("No baseline has been recorded.", "Missing values remain missing; they are never substituted with MRP.")}<form id="baseline-form" class="panel" data-variant="${c.variant_id}"><h2>Add a reference for review</h2><p>User-entered references stay unvalidated and do not influence trusted-low scoring.</p><div class="form-grid"><label>Reference price (paise)<input name="pricePaise" type="number" min="1" step="1" required></label><label>Source URL<input name="sourceRef" type="url" required></label><label>Source timestamp (UTC ISO 8601)<input name="observedAt" required placeholder="YYYY-MM-DDTHH:mm:ss.sssZ"></label><div><button class="button">Save unvalidated reference</button></div></div></form>`;
}
function login() {
  main.innerHTML =
    heading(
      "ACCESS CONTROL",
      "Open your workspace.",
      "Enter the deployment token set by the owner.",
    ) +
    '<form id="login-form" class="panel inline-form"><label>Access token<input type="password" name="token" autocomplete="current-password" required></label><button class="button primary">Sign in</button></form>';
}
async function render() {
  view = location.hash.slice(1) || "radar";
  document.querySelectorAll("nav a").forEach((a) => {
    const active =
      a.dataset.view === view ||
      (view.startsWith("candidate/") && a.dataset.view === "radar");
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (!state) return;
  if (view.startsWith("candidate/")) return candidate(view.split("/")[1]);
  const renderer = { radar, discover, evidence, watchlist, health, settings }[
    view
  ];
  main.innerHTML = renderer
    ? renderer()
    : empty("View not found.", "Use the workspace navigation.");
  main.querySelectorAll("details[id]").forEach((panel) => {
    if (panel.id !== "radar-setup" || expandedPanels.has(panel.id))
      panel.open = expandedPanels.has(panel.id);
  });
}
async function load(requestedHash = location.hash) {
  state = await api("/state");
  $("#connection").textContent =
    state.providers[0].status === "operational"
      ? state.settings.scanEnabled || state.settings.radarEnabled
        ? "SCANNER ENABLED"
        : "SCANNER PAUSED"
      : human(state.providers[0].status).toUpperCase();
  $("#updated").textContent =
    "UPDATED " +
    new Intl.DateTimeFormat("en-IN", {
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    }).format(new Date(state.now)) +
    " IST";
  if (location.hash === requestedHash) await render();
}
main.addEventListener(
  "toggle",
  (e) => {
    if (e.target.matches("details[id]")) {
      if (e.target.open) expandedPanels.add(e.target.id);
      else expandedPanels.delete(e.target.id);
    }
  },
  true,
);
main.addEventListener("input", (e) => {
  if (e.target.id === "filter") {
    filter.text = e.target.value;
    $("#candidate-table").innerHTML = candidateTable();
  }
});
main.addEventListener("input", (e) => {
  if (e.target.closest("#query-form") && e.target.name === "query")
    searchDraft = e.target.value;
});
main.addEventListener("change", (e) => {
  if (e.target.id === "market" || e.target.id === "sort") {
    filter[e.target.id] = e.target.value;
    $("#candidate-table").innerHTML = candidateTable();
  }
});
main.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const mutationHash = location.hash;
  el.disabled = true;
  try {
    const id = el.dataset.id;
    switch (el.dataset.action) {
      case "pause-radar":
        await api("/radar", "POST", { radarEnabled: false });
        toast("Radar paused. Already queued price checks may finish.");
        break;
      case "check-price": {
        const result = state.discoveries.find((x) => x.id === Number(id));
        if (
          !state.settings.scrapeAllowedDomains.includes(
            new URL(result.url).hostname,
          )
        ) {
          toast(
            "Approve this website’s exact domain in Settings only if page access is permitted.",
          );
          location.hash = "settings";
          return;
        }
        await api("/extractions", "POST", {
          url: result.url,
          category: "Search price check",
          recheck: true,
        });
        toast("Price check requested. The result updates automatically.");
        break;
      }
      case "refresh-results":
        break;
      case "seed":
        await api("/jobs/seed", "POST", {});
        toast(
          "Starter categories queued. Scanning follows Settings and provider availability.",
        );
        break;
      case "cancel":
        await api(`/jobs/${id}/cancel`, "POST", {});
        toast("Job cancelled.");
        break;
      case "remove-watch":
        await api(`/watchlist/${id}`, "DELETE", {});
        toast("Monitor removed.");
        break;
      case "cancel-extraction":
        await api(`/extractions/${id}/cancel`, "POST", {});
        toast("Extraction cancelled.");
        break;
      case "extract-result": {
        const r = state.discoveries.find((x) => x.id === Number(id));
        await api("/extractions", "POST", {
          url: r.url,
          category: "Observed product",
        });
        toast(
          "Extraction queued; approved domains, credentials and budget apply.",
        );
        break;
      }
      case "watch-result": {
        const r = state.discoveries.find((x) => x.id === Number(id));
        await api("/watchlist", "POST", {
          query: r.title.slice(0, 290),
          category: "Observed product",
        });
        toast("Listing title added to monitors.");
        break;
      }
      case "expire":
      case "unavailable":
        await api(`/candidates/${id}/verification`, "POST", {
          status: el.dataset.action === "expire" ? "EXPIRED" : "UNAVAILABLE",
        });
        toast("Verification state updated.");
        break;
      case "reject":
      case "useful":
        await api(`/candidates/${id}/feedback`, "POST", {
          feedback:
            el.dataset.action === "reject" ? "false_positive" : "useful",
        });
        toast("Feedback saved.");
        break;
      case "notify": {
        const r = await api("/notifications/send", "POST", {});
        toast(
          `${r.results.reduce((n, x) => n + x.channels.length, 0)} notifications sent. Eligibility, channel setup and cooldowns apply.`,
        );
        break;
      }
    }
    await load(mutationHash);
  } catch (err) {
    toast(err.message);
  } finally {
    el.disabled = false;
  }
});
main.addEventListener("submit", async (e) => {
  e.preventDefault();
  let mutationHash = location.hash;
  const form = e.target,
    data = Object.fromEntries(new FormData(form)),
    submit = form.querySelector("button[type=submit],button:not([type])");
  if (submit) submit.disabled = true;
  try {
    if (form.id === "radar-form") {
      const checked = [
        ...form.querySelectorAll('[name="categories"]:checked'),
      ].map((el) => el.value);
      if (!checked.length) throw new Error("Select at least one category.");
      await api("/radar", "POST", {
        radarEnabled: true,
        radarCategories: checked,
        scrapeAllowedDomains: data.domains
          .split(",")
          .map((v) => v.trim().toLowerCase())
          .filter(Boolean),
        radarMinPricePaise: Math.round(Number(data.minPrice) * 100),
        radarCycleMinutes: Number(data.cycle),
        historyIntervalMinutes: Number(data.historyInterval),
        historyDailyBudget: Number(data.historyBudget),
      });
      expandedPanels.delete("radar-setup");
      toast("Radar started. Finding products and collecting price evidence.");
    }
    if (form.id === "login-form") {
      await api("/login", "POST", data);
      await load();
      return;
    }
    if (form.id === "query-form" || form.id === "watch-form") {
      if (form.id === "query-form") {
        searchDraft = data.query;
        submit.textContent = "Searching…";
        $("#search-status").textContent = "Finding product listings…";
      }
      const r = await api(
        form.id === "query-form" ? "/search" : "/watchlist",
        "POST",
        data,
      );
      if (form.id === "query-form") selectedQueryId = r.queryId;
      toast(
        r.cached
          ? "Cached query; no request spent."
          : r.deduplicated
            ? "This query is already queued."
            : form.id === "query-form"
              ? "Search complete."
              : "Saved.",
      );
    }
    if (form.id === "url-form") {
      const r = await api("/extractions", "POST", {
        ...data,
        recheck: data.recheck === "true",
      });
      toast(
        r.cached
          ? "Using recent extraction record."
          : "Extraction queued; credentials and budget apply.",
      );
    }
    if (form.id === "baseline-form") {
      await api("/baselines", "POST", {
        variantId: Number(form.dataset.variant),
        pricePaise: Number(data.pricePaise),
        sourceRef: data.sourceRef,
        observedAt: data.observedAt,
      });
      toast("Reference saved as unvalidated evidence.");
    }
    if (form.id === "settings-form") {
      const values = {};
      for (const k of [
        "dailyBudget",
        "requestTimeoutMs",
        "searchResultLimit",
        "intervalSeconds",
        "cacheMinutes",
        "severityThreshold",
        "confidenceThreshold",
      ])
        values[k] = Number(data[k]);
      values.costPerSearch =
        data.costPerSearch === "" ? null : Number(data.costPerSearch);
      values.costPerScrape =
        data.costPerScrape === "" ? null : Number(data.costPerScrape);
      values.scrapeAllowedDomains = data.scrapeAllowedDomains
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean);
      values.scanEnabled = data.scanEnabled === "on";
      values.alertsEnabled = data.alertsEnabled === "on";
      values.weights = Object.fromEntries(
        ["H", "L", "M", "T", "R"].map((k) => [k, Number(data["weight" + k])]),
      );
      await api("/settings", "PATCH", values);
      toast("Policy saved.");
    }
    if (form.id === "observation-form") {
      const attributes = {};
      for (const k of [
        "model",
        "brand",
        "bundle",
        "kind",
        "capacity",
        "colour",
        "generation",
        "condition",
      ])
        if (data[k]) attributes[k] = data[k];
      attributes.packCount = Number(data.packCount);
      const body = {
        attributes,
        currency: "INR",
        pricePaise: Number(data.pricePaise),
      };
      for (const k of [
        "title",
        "category",
        "url",
        "sourceRef",
        "seller",
        "observedAt",
        "stock",
        "priceType",
      ])
        body[k] = data[k];
      const r = await api("/observations", "POST", body);
      toast(
        r.duplicate
          ? "Observation already recorded."
          : "Observation saved as unvalidated evidence.",
      );
      location.hash = "candidate/" + r.id;
      mutationHash = location.hash;
    }
    await load(mutationHash);
  } catch (err) {
    toast(err.message);
    if (form.id === "query-form" && $("#search-status"))
      $("#search-status").textContent = err.message;
  } finally {
    if (submit) {
      submit.disabled = false;
      if (form.id === "query-form") submit.textContent = "Search";
    }
  }
});
window.addEventListener("hashchange", () =>
  render().catch((e) => toast(e.message)),
);
try {
  await document.fonts.load('400 13px "Paper Mono"');
  await document.fonts.ready;
  if (!document.fonts.check('400 13px "Paper Mono"')) throw new Error();
} catch {
  $("#font-warning").hidden = false;
}
load().catch((e) => {
  if (!$("#login-form"))
    main.innerHTML = `<div class="error-state"><h1>Connection interrupted.</h1><p>${esc(e.message)}</p><button class="button" id="retry">Retry connection</button></div>`;
});
document.addEventListener("click", (e) => {
  if (e.target.id === "retry") load().catch((err) => toast(err.message));
});
setInterval(() => {
  if (
    state &&
    !["settings", "evidence", "watchlist", "discover"].includes(view) &&
    !main.contains(document.activeElement)
  )
    load().catch(() => {
      $("#connection").textContent = "CONNECTION LOST";
    });
}, 30000);

document.querySelector(".skip").addEventListener("click", (e) => {
  e.preventDefault();
  main.focus();
});

setInterval(() => {
  if (
    state &&
    view === "discover" &&
    !main.contains(document.activeElement) &&
    state.extractions?.some((x) =>
      ["queued", "running", "retry"].includes(x.status),
    )
  )
    load().catch(() => {});
}, 5000);

setInterval(() => {
  if (
    state &&
    view === "radar" &&
    state.settings.radarEnabled &&
    !main.contains(document.activeElement)
  )
    load().catch(() => {});
}, 10000);
