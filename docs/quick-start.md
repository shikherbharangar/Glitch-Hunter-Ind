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

In Settings, choose a request budget before enabling scans. A conservative starting policy is 10 attempted requests per day, at least 60 seconds between requests, five results per search and a 360-minute cache. Monetary cost remains unknown until you enter the account’s actual prices; reported credits appear in System health. The shared budget includes failed search and extraction attempts.

## First session

1. Open **Results**. Queue a category or exact product model, or use **Queue starter categories** for broad coverage. Leads appear here as searches finish. Scheduled scanning must be enabled in Settings.
2. Use **Watchlist** to monitor a query after cache expiry. Watchlists consume the same daily budget. Pause scans in Settings whenever needed.
3. To record a real price yourself, open **Price evidence** and provide the full INR price in paise, exact variant, seller, availability, source and time. Manual input does not create trusted history or verified checkout.
4. For page extraction, review the source website’s terms and approve its exact domain in Settings. In Discover, enter the exact URL and category, then queue extraction. Readable robots permission and complete, unambiguous product/offer data are required. Many pages will remain explicitly unverified.
5. Choose **Request fresh page** for a recheck. It respects budget and permission controls. A Firecrawl alert requires a second fresh matching same-offer price observation, the existing VIGIL integrity/score gates, and a configured delivery channel.
6. Inspect **System health** for actual outcomes, request usage and credits. A listing lead is not a confirmed pricing error. Sparse evidence may produce no priority candidates; no examples or histories are seeded.

## Keep your data

SQLite is stored in `data/glitch-hunter.sqlite`. Keep that directory across updates. For a simple backup, stop the application before copying the database, including any remaining SQLite WAL/SHM files. Alternatively use SQLite’s consistent backup API while running. Never copy a live main database alone.

The portable source package intentionally excludes credentials, saved data, dependencies and generated assets. Configure your key on the target machine; a key stored in this cloud environment is not exported. The fresh installation starts with scanning and alerts disabled.

## Hosted access

This onboarding environment provides no browser preview URL. A usable hosted URL requires a host, persistent database storage, TLS reverse proxy, `APP_AUTH_TOKEN` and exact HTTPS `PUBLIC_ORIGIN`. Public binding refuses to start without authentication settings. See the deployment instructions in README. No production deployment is part of the source package.

Telegram/email alerts need your selected destination and channel credentials. Leave alerts disabled until configured. No message has been sent during setup.
