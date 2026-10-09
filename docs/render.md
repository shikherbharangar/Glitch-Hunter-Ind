# Put Glitch Hunter India on Render

The app is ready to deploy from `shikherbharangar/Glitch-Hunter-Ind`. Render will build the Docker image and provide an HTTPS address. You need a Render account and a paid web service with a persistent disk; a free service without persistent storage will lose the SQLite database. Check Render’s current prices before creating it.

## Create the service

1. Sign in at [Render](https://dashboard.render.com/).
2. Choose **New → Web Service**, connect GitHub, and select `shikherbharangar/Glitch-Hunter-Ind`. Grant access to this repository if it is not listed.
3. Use branch **main**. Select **Docker** as the runtime, use the repository root as the build context, and use `./Dockerfile`. Choose a name such as `glitch-hunter-india` and a paid instance type that supports persistent disks. Keep one instance.
4. Add a persistent disk mounted at **`/app/data`**. A small initial disk, such as 1 GB, is enough to get started. Disk and instance charges depend on Render’s current plans.
5. Add the environment variables below. Enter secrets in Render’s environment editor, never in the repository or chat.

| Variable            | What to enter                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIRECRAWL_API_KEY` | Your real Firecrawl API key. The cloud environment’s proxy binding is not transferred to Render.                                               |
| `APP_AUTH_TOKEN`    | A strong random secret you will use to sign in. Generate one with your password manager or `openssl rand -hex 32` on your own computer.        |
| `PUBLIC_ORIGIN`     | Optional on Render. Leave it unset to use Render’s automatically injected `RENDER_EXTERNAL_URL`. Set it only for an exact custom HTTPS domain. |
| `DATABASE_PATH`     | `/app/data/glitch-hunter.sqlite`                                                                                                               |
| `HOST`              | `0.0.0.0`                                                                                                                                      |
| `NODE_ENV`          | `production`                                                                                                                                   |

The Docker image defaults to port 3000 and reads Render’s `PORT` if supplied. Do not set a separate build command or start command: the Dockerfile installs, tests, builds, and starts the app. Use **`/`** as the health-check path.

6. Create/deploy the service. The app automatically accepts Render’s assigned website URL and keeps Secure sign-in cookies. You do not need to copy the dashboard URL or fill `PUBLIC_ORIGIN` for the standard `onrender.com` address. If you previously entered a placeholder or dashboard URL, remove `PUBLIC_ORIGIN` and redeploy.
7. Wait until the deploy succeeds. Open the assigned HTTPS URL and sign in with `APP_AUTH_TOKEN`.

## Start using it

Open **System health**. Firecrawl initially shows configured/unverified until a real request succeeds; it should not pretend to be operational just because a key exists.

In **Settings**, start with:

- Daily request budget: **10**.
- Minimum interval: **60 seconds**.
- Results per search: **5**.
- Cache lifetime: **360 minutes**.
- Scanning enabled; alerts disabled until a destination is configured.

Open **Search products**, enter a product or model, and press **Search**. Results appear immediately after the provider responds; scheduled searches do not need to be enabled. Open a listing to see its current price. Optional background searches and page checks are under **Advanced tools**; you can also add a Watchlist. Paid request credits are visible in System health; failed attempts also consume the local request budget.

A new Render disk starts empty. This cloud instance’s leads, observations, queues and settings are not automatically copied to Render, and real credentials are never included in the repository. Do not upload a live SQLite main file without a consistent backup. If you want the existing cloud database transferred, arrange a consistent backup and keep it private.

Price extraction stays opt-in: review source terms, approve exact domains, and queue product URLs. Ambiguous variants/prices and denied access remain unverified. Search snippets are not validated prices or checkout confirmation. Sparse history may produce no priority candidates.

## Check persistence and updates

Add a Watchlist, restart the Render service, and check that it remains. That confirms the persistent disk is mounted correctly. The entrypoint prepares root-owned disk permissions and then runs the server as the unprivileged `node` user. The database must remain inside `/app/data` for the Docker deployment.

Keep the disk attached when redeploying; never delete it as a routine update. Back up SQLite consistently before upgrades. Run one service instance per database. Sign-in sessions are intentionally reset on restart.

After connecting the repository, Render can redeploy from `main` when new commits are pushed. Add a custom domain through Render’s dashboard if desired, then update `PUBLIC_ORIGIN` to its exact HTTPS origin and redeploy.

The container build, 74 mocked tests, sign-in cookies, font delivery and database retention across restart are checked locally. Render service creation, its public certificate, and a live request on the hosted URL still need to be verified after deployment. The Render documentation site was unavailable from this cloud network, so this guide avoids promising specific prices or account features; consult [Render web services](https://render.com/docs/web-services), [Docker deployment](https://render.com/docs/docker) and [persistent disks](https://render.com/docs/disks) in your browser for current details.

## If you see HOST_NOT_ALLOWED

Open the service’s **Environment** page, remove an incorrect `PUBLIC_ORIGIN`, and save/redeploy the latest commit. The app reads the assigned website URL from Render’s trusted environment, not from arbitrary request headers. The address beginning `https://dashboard.render.com/web/…` is the admin dashboard, not your website. Open the service’s public `https://…onrender.com` link near the service name. Custom domains can still use an explicit exact `PUBLIC_ORIGIN`; unknown hosts and unrelated browser origins remain blocked.

## Price anomaly checks

Search now queues up to three product-page checks on exact domains you have approved in Settings. Each extraction can spend Firecrawl credits and shares the daily request budget and minimum interval with searches. Robots permission is checked before extraction. Cached completed checks are reused; the per-result **Check price** button requests a fresh check.

The result card shows the observed price and its assessment. Search snippets are never treated as prices. A page with missing variant details, blocked access, or conditional prices stays unverified. An observed price needs comparable offers for the same variant or historical observations to establish an anomaly. No external history feed or official Amazon/Flipkart price API is currently connected, so this deployment cannot promise reliable glitch detection across those marketplaces.
