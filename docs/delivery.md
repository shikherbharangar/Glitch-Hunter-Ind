# Current delivery status

Category radar, VIGIL 0.2 and the free direct public-page price collector are implemented. Selected tech categories are searched automatically through Firecrawl, permitted pages are evaluated, matching offers are compared, and prices/targets are retained in SQLite across restarts. History starts when this collector runs; no pre-existing free history feed or all-time data is claimed. See [radar setup](radar.md) and [model equations](vigil.md).

Validation: 91 automated tests; seven browser checks including desktop/mobile start/pause and product-price cards; synthetic diagnostic backtest and ablations; production build/font audit; Docker build and zero production dependency vulnerabilities; Render-assigned-origin startup, sign-in, Secure cookies, unprivileged runtime and SQLite restart persistence smoke checks. Fixtures are labelled synthetic and tests make no paid live calls.

The current cloud environment cannot resolve direct public DNS or reach the supplied Render hostname through its network path. Consequently live retailer collection and the deployed website were not verified here. Deploy the latest GitHub commit, keep the Render persistent disk, then start Category radar with permitted exact retailer domains. Access failures are visible in each result and Scan activity.

Real-market precision, calibration, detection delay, checkout confirmation and fulfillment remain unmeasured. A page price is not a checkout guarantee; blocked/ambiguous pages remain unverified. Source availability is a prerequisite that mathematics cannot replace.
