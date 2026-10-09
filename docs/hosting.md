# Hosted deployment

Deployment assets are prepared for one application instance with persistent SQLite storage. A live URL requires an actual hosting account/server and hostname. The user selected Render; see [the step-by-step Render guide](render.md). The cloud onboarding workspace is not itself a public hosting service.

## Docker and HTTPS on a VPS

Required: Docker Engine with Compose, a domain resolving to the server, and incoming ports 80/443 available. The app’s port 3000 remains internal; Caddy terminates HTTPS and obtains/renews certificates for the configured domain.

1. Transfer the source package to the server and extract it.
2. Copy `deploy/.env.example` to `deploy/.env`. Set `APP_DOMAIN` to your real hostname, `APP_AUTH_TOKEN` to a strong random sign-in secret, and `FIRECRAWL_API_KEY` to your credential. Enter values securely on the server; do not commit them or use cloud proxy placeholder values outside their bound environment.
3. From the `deploy` directory, run:

```bash
docker compose build
docker compose up -d
docker compose ps
```

4. Open your domain over HTTPS and sign in with `APP_AUTH_TOKEN`. Check System health, then choose a bounded scan policy before enabling scans. A fresh deployment defaults to scans/alerts off. Configure 10 daily requests, a 60-second interval, five search results and a 360-minute cache as a conservative starting point.
5. Queue a search in Discover. Confirm an actual successful outcome rather than relying only on the container health check.

The application process runs as the `node` user after the entrypoint prepares disk ownership and requires `PUBLIC_ORIGIN` and `APP_AUTH_TOKEN` for public binding. The Compose file derives the exact HTTPS origin from `APP_DOMAIN`. No Firecrawl key, authentication token, saved data or environment file is embedded in the image. Application dependencies are installed from the lockfile; the build runs the production asset build and mocked test suite.

Three named volumes retain SQLite and Caddy certificate/configuration data. Do not run `docker compose down -v` unless you deliberately intend to delete all of these. Run only one app process per database. Stop the app before copying the SQLite volume, or use a consistent SQLite backup; back up data before replacing/upgrading the image. Restarting the app clears sign-in sessions; sign in again.

## Managed hosting

Render/Railway or another Docker-capable host can use the same Dockerfile. Supply `APP_AUTH_TOKEN`, `PUBLIC_ORIGIN` matching the issued/custom HTTPS domain, and `FIRECRAWL_API_KEY` through its secure environment editor. Set a persistent volume mount at `/app/data` writable by the image’s non-root user; configure one instance without replicas. Configure the provider’s assigned `PORT` if it differs from 3000. Health checks can use `/`; test authenticated `/api/state` through the UI after deployment.

Persistent disks, platform availability and pricing depend on your hosting account. No free persistent storage is assumed. A host that only supports ephemeral filesystems is unsuitable for this SQLite deployment without additional persistence work.

The Docker image build, all 72 tests inside the image, authentication/secure-cookie checks, non-root runtime, bundled font, and database preservation through a container restart are verified. Compose and Caddy configuration validation also pass. These local checks do not establish a public URL or a publicly trusted certificate for a real domain.

In this cloud environment, container builds additionally need the configured outbound proxy hostname mapping and an optional `proxy_ca` BuildKit secret for the platform trust certificate. Normal hosts with direct Internet access can use the standard build commands above. No TLS verification was disabled and no platform proxy settings/certificate are embedded in the runtime image.

The user authorized pushing this application to GitHub for Render deployment. Hosting credentials and the final service URL are still needed to perform and verify deployment. No hosting account is created automatically.

## Collection and alerts

Review source terms and approve exact extraction domains in Settings. Page access/robots denial and incomplete product details remain unverified. Search leads are not checkout prices. Optional Telegram/email requires a destination, channel credentials and explicit alert enablement; it is not enabled by deploying the app.
