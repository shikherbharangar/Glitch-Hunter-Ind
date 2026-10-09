// SYNTHETIC TEST FIXTURES ONLY. Never imported by production application code.
export const attrs = {
  brand: "Synthetic Labs",
  model: "SYN-300",
  bundle: "complete printer only",
  capacity: "300mm",
  colour: "black",
  generation: "3",
  condition: "new",
  kind: "complete printer",
  packCount: 1,
};
export function scenario(now = Date.now()) {
  const current = {
    price_paise: 499900,
    currency: "INR",
    price_type: "full",
    observed_at: new Date(now).toISOString(),
    source_group: "merchant-current",
    seller: "Synthetic current seller",
    provider: "synthetic-test",
    reliability: 0.95,
    stock: "in_stock",
    purchase_status: "PRODUCT_PAGE_OBSERVED",
    attributes: { ...attrs },
    quality: [],
  };
  const history = Array.from({ length: 30 }, (_, i) => ({
    ...current,
    attributes: { ...attrs },
    price_paise: (28000 + (i % 7) * 500) * 100,
    observed_at: new Date(now - (30 - i) * 86400000).toISOString(),
    source_group: "history-vendor",
    seller: current.seller,
  }));
  const baselines = [
    {
      kind: "trusted_external_low",
      validated: 1,
      quality: 0.95,
      price_paise: 2499900,
      observed_at: new Date(now - 86400000).toISOString(),
      source_ref: "https://synthetic.invalid/history",
    },
  ];
  const offers = [1, 2, 3].map((n) => ({
    ...current,
    attributes: { ...attrs },
    price_paise: (29000 + n * 500) * 100,
    source_group: `merchant-${n}`,
    seller: `Synthetic independent ${n}`,
  }));
  return { current, history, baselines, offers, now };
}
export function manualInput(now = Date.now()) {
  return {
    title: "SYNTHETIC TEST printer",
    category: "Synthetic fabrication",
    url: "https://www.amazon.in/dp/B000TEST01",
    seller: "Synthetic seller",
    pricePaise: 499900,
    currency: "INR",
    priceType: "full",
    observedAt: new Date(now).toISOString(),
    sourceRef: "https://synthetic.invalid/source",
    stock: "in_stock",
    attributes: { ...attrs },
  };
}
