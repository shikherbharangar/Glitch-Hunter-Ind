// Search matches never supply price evidence. Only recorded observations are assessed.
export function assessListing(url, { candidates, extractions, settings }) {
  const check = extractions.find((x) => x.url === url);
  const candidate = candidates.find((x) => x.url === url);
  if (check && ["queued", "running", "retry"].includes(check.status))
    return {
      status: "checking",
      label: "Checking price",
      message:
        "Waiting for permitted page access and the request budget. This updates automatically.",
    };
  if (check && check.status !== "done") {
    let reasons = [];
    try {
      reasons = JSON.parse(check.result || "{}").reasons || [];
    } catch {}
    const code = check.error || reasons[0];
    const messages = {
      ROBOTS_DISALLOWED: "This website does not permit this page check.",
      ROBOTS_POLICY_UNAVAILABLE:
        "Could not confirm this website permits page access.",
      AMBIGUOUS_VARIANT:
        "The page does not identify the exact model, configuration and bundle clearly enough to compare prices.",
      NO_STRUCTURED_PRODUCT:
        "No readable structured product price was found on this page.",
      CREDENTIALS_MISSING: "The Firecrawl key is missing.",
      CONDITIONAL_PRICE:
        "The price depends on an offer or condition, so it cannot be compared as a full purchase price.",
      DOMAIN_NOT_APPROVED:
        "This website has not been approved for price checks.",
    };
    return {
      status: "unverified",
      label: "Could not assess",
      message:
        messages[code] ||
        "The page did not provide usable product and price evidence.",
      reason: code,
    };
  }
  if (candidate) {
    const result = candidate.result;
    const credible =
      !result.blocked &&
      candidate.feedback !== "false_positive" &&
      result.severity >= settings.severityThreshold &&
      result.confidence >= settings.confidenceThreshold;
    const reference = result.expectedValue?.referencePaise;
    return {
      status: credible ? "possible_glitch" : "insufficient_evidence",
      label: credible
        ? "Possible price glitch"
        : "Price observed — glitch not established",
      message: credible
        ? "An unusual price with supporting evidence. Check the exact variant and checkout price before buying."
        : reference
          ? "Price evidence exists, but this result does not meet the anomaly and evidence thresholds."
          : "No comparable price for this exact variant yet. Another seller’s matching offer or a price history is needed.",
      pricePaise: candidate.price_paise,
      referencePaise: reference || null,
      savingPaise: result.expectedValue?.savingPaise || null,
      severity: result.severity,
      confidence: result.confidence,
      candidateId: candidate.id,
    };
  }
  const approved = settings.scrapeAllowedDomains.includes(
    new URL(url).hostname,
  );
  return {
    status: "unchecked",
    label: "Price not checked",
    message: approved
      ? "Check this product page to collect a price and evaluate the available evidence."
      : "Price checks are not enabled for this website. Approve its exact domain in Settings only if page access is permitted.",
  };
}
