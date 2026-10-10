# Use Glitch Hunter India

The application uses Node 24+, npm and SQLite. Firecrawl discovers listing leads; prices become evidence only through permitted validated extraction or manual observation. No purchase or checkout is automated.

## Run on your own computer

Extract the source package into a directory named `Glitch-Hunter-Ind`, open a terminal there, then run:

```bash
npm ci
npm run build
```

Create `.env` from `.env.example` without overwriting an existing file. Set `FIRECRAWL_API_KEY` securely, then run:

```bash
npm start
```

Open the application on local port 3000 in your browser. It binds to your own computer’s loopback interface. Keep the terminal running. After frontend edits, run `npm run build` again. After credential changes, restart the server.

In Settings, choose a request budget before enabling scans. A conservative starting policy is 10 attempted requests per day, at least 60 seconds between requests, five results per search and a 360-minute cache. Monetary cost remains unknown until you enter the account’s actual prices; reported credits appear in System health. Firecrawl spend includes failed discovery attempts. Direct public-page price reads have a separate daily collection limit.

## First session

1. Open **Category radar** (`/#radar`). Choose tech/high-value categories and enter exact domains of retailers that permit public product-page reads. Press **Start category radar**. You do not need to type an individual query.
2. Products and price assessments appear automatically. The default focus is standard prices above ₹10,000, with controls to change that floor and the scan/history intervals. The history collector starts recording prices now; past prices are not fabricated.
3. Read the observed price, historical standard, matching seller standard, history counts and anomaly/evidence scores on each card. Possible glitches remain candidates until you confirm checkout yourself. Missing or blocked prices have an explicit status.
4. **Search products** remains available for one-off searches. Permitted price checks use public-page reads by default, not a paid Firecrawl scrape. You can manually request a fresh check from a result.
5. **Watchlist** and advanced evidence entry remain available. Manual input stays unvalidated. Automatic alerts need configured delivery, explicit opt-in and two matching fresh same-offer prices.
6. Use **Pause radar** to stop autonomous discovery and recurring tracking. Already queued page checks can finish. Inspect **Scan activity** or **System health** for actual outcomes.

See [Radar and history](radar.md) for collection budgets, source requirements and cold-start limits.

## Keep your data

SQLite is stored in `data/glitch-hunter.sqlite`. Keep that directory across updates. For a simple backup, stop the application before copying the database, including any remaining SQLite WAL/SHM files. Alternatively use SQLite’s consistent backup API while running. Never copy a live main database alone.

The portable source package intentionally excludes credentials, saved data, dependencies and generated assets. Configure your key on the target machine; a key stored in this cloud environment is not exported. The fresh installation starts with scanning and alerts disabled.

## Hosted access

This onboarding environment provides no browser preview URL. A usable hosted URL requires a host, persistent database storage, TLS reverse proxy, `APP_AUTH_TOKEN` and exact HTTPS `PUBLIC_ORIGIN`. Public binding refuses to start without authentication settings. See the deployment instructions in README. No production deployment is part of the source package.

Telegram/email alerts need your selected destination and channel credentials. Leave alerts disabled until configured. No message has been sent during setup.
