# HoloBid

A Pokémon card auction platform with a live TCGdex catalog, simulated wallets, real-time bidding, and publicly verifiable bid history.

Auctioneers publish and manage lots. Bidders reserve funds when leading an auction and receive a shareable receipt when they win. Visitors can browse auctions, receipts, and audit results without an account.

[Open the application](https://holobid.vercel.app) · [API health](https://holobid--meiraitt--fmvj6fdxbbcx.code.run/api/v1/health/live)

## Contents

- [Try the demo](#try-the-demo)
- [Run locally](#run-locally)
- [Architecture](#architecture)
- [Auction rules and audit](#auction-rules-and-audit)
- [API overview](#api-overview)
- [Testing](#testing)
- [Deployment](#deployment)
- [Development](#development)

## Try the demo

All money is simulated. There are no real charges, withdrawals, or payments.

| Role       | Email                          | Initial seed balance |
| ---------- | ------------------------------ | -------------------- |
| Auctioneer | `auctioneer@demo.holobid.test` | R$ 0.00              |
| Bidder A   | `bidder1@demo.holobid.test`    | R$ 500.00            |
| Bidder B   | `bidder2@demo.holobid.test`    | R$ 500.00            |

**Password for all three demo accounts:** `HoloBidDemo123!`

These credentials are intentionally public and only belong to the demo. Current balances may differ after other visitors use the app. Bidders can add simulated funds in the wallet. Public registration creates a **bidder**; use the seeded account to evaluate auctioneer features.

### Suggested walkthrough

1. Sign in as the auctioneer, open **Meus lotes**, and publish a card from TCGdex. Choose an immediate start, a R$ 100.00 starting bid, a R$ 10.00 increment, and an end time a few minutes ahead.
2. Open two independent browser sessions for bidders A and B. Check their wallets and add simulated funds if needed.
3. Open the same auction in both sessions. Bid R$ 100.00 as A, then R$ 110.00 as B. Watch the leader, bid history, and wallet reservations update without a reload.
4. Wait for settlement. A bid in the last two minutes extends the deadline to two minutes after that bid. Settlement happens on the server, even with every browser closed.
5. Check the winner's debit, the auctioneer's credit, and the receipt under **Meus lances → Arrematados**. Open the receipt and auction audit in a signed-out session.
6. Publish another lot without bids and cancel it from the auctioneer dashboard. It disappears from the public listing while its audit remains available.

With `DEMO_MODE=true`, an idempotent seed provisions the accounts and sample lots. A renewable lot is created at most once per UTC day, after the previous one settles. Startup recovers missed settlement work without resetting balances, bids, receipts, or passwords. For a quick evaluation, publish a separate short auction instead of waiting for the daily lot.

## Run locally

### Requirements

- **Node.js 24.22.1**, pinned in [.nvmrc](.nvmrc).
- **npm 11.21.1**, pinned in [package.json](package.json).
- **Docker**, for local PostgreSQL and isolated integration tests.

No global Prisma or PostgreSQL installation is required. If using nvm, run `nvm install` and `nvm use` from the repository root.

### Setup

```sh
git clone https://github.com/Meiraitt/holobid.git
cd holobid
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

In `apps/api/.env`, keep the local database URLs and `WEB_ORIGIN=http://127.0.0.1:5173`. Set `DEMO_MODE=true` to enable the demo accounts. Generate **three independent keys**, running this command once for each of `JWT_SECRET`, `AUDIT_HMAC_SECRET`, and `AUDIT_PSEUDONYM_SECRET`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Paste the values into the corresponding variables. Keep `AUDIT_KEY_ID=v1` and preserve these keys between restarts. The frontend environment contains only public API and WebSocket origins.

Start PostgreSQL, apply migrations, and seed the data:

```sh
docker compose up -d --wait postgres
npm run db:release
npm run db:seed
```

Run each application in its own terminal, from the repository root:

```sh
npm run dev:api
```

```sh
npm run dev:web
```

Open **http://127.0.0.1:5173**. The API is available at **http://127.0.0.1:3000/api/v1**. Use `127.0.0.1` consistently: `localhost` is a different origin. Vite proxies authentication requests so the refresh cookie stays on the frontend origin.

`docker compose stop postgres` preserves the database volume. The API loads `apps/api/.env`; process environment variables take precedence. `npm ci` generates Prisma clients without connecting to a database.

### Environment reference

The complete templates are [apps/api/.env.example](apps/api/.env.example) and [apps/web/.env.example](apps/web/.env.example).

| Variables                                                   | Purpose                                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `NODE_ENV`, `PORT`                                          | Runtime mode and HTTP port; use `production` and `3000` on the deployed API.      |
| `WEB_ORIGIN`                                                | Exact frontend origin, without a trailing slash; HTTPS in production.             |
| `DATABASE_URL`, `AUDIT_DATABASE_URL`                        | Main database and independent audit database connections.                         |
| `DIRECT_DATABASE_URL`, `DIRECT_AUDIT_DATABASE_URL`          | Optional direct connections for migrations when runtime connections use a pooler. |
| `JWT_SECRET`, `AUDIT_HMAC_SECRET`, `AUDIT_PSEUDONYM_SECRET` | Distinct private keys, each containing 32–64 random bytes encoded as base64url.   |
| `AUDIT_KEY_ID`                                              | Audit key identifier; defaults to `v1`.                                           |
| `DEMO_MODE`                                                 | Enables public demo accounts and renewable lots; defaults to `false`.             |
| `VITE_API_URL`, `VITE_SOCKET_URL`                           | Public backend origins used by the frontend. Never place secrets in `VITE_*`.     |

Prisma and TCGdex do not require API keys for this setup. Never commit `.env` files or reuse local database credentials in a deployment.

## Architecture

| Layer            | Stack and responsibilities                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend         | React, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS, and shadcn/Base UI components. Views compose reusable components; HTTP services and session state are separate. |
| Backend          | NestJS and TypeScript. Controllers validate requests, services enforce business rules and transactions, and repositories access persistence.                                         |
| Persistence      | Prisma and PostgreSQL. Money is stored as integer cents; balances, reservations, bids, and settlement are transactional.                                                             |
| Realtime         | Socket.IO sends notifications; HTTP remains the source of truth for commands and queries. Clients refetch after reconnecting.                                                        |
| Authentication   | Argon2id passwords, 15-minute JWTs held in browser memory, and rotating refresh tokens in an HttpOnly cookie. Logout revokes the session.                                            |
| External catalog | TCGdex supplies card data and images. Published lots retain snapshots and image bytes, so existing auctions remain usable during an upstream outage.                                 |

```text
apps/api/
  src/modules/       # Controllers, services, repositories, and domain rules
  prisma/            # Main and audit schemas, plus SQL migrations
  test/              # Unit and database integration tests
  scripts/           # Isolated HTTP, browser, and release checks
apps/web/
  src/views/         # Complete routed screens
  src/components/    # Shared UI and layout components
  src/services/      # HTTP clients and API integration
packages/contracts/  # Shared HTTP and Socket.IO types
```

The monorepo has **independent frontend and backend deployments**. A single API instance owns scheduling and in-memory Socket.IO delivery; PostgreSQL persists deadlines and operations for recovery after restart. Redis and a message queue are deliberately outside this scope. Multiple API replicas would require coordination for timers and notifications.

## Auction rules and audit

- The API enforces auction times, permissions, minimum bids, and increments. Only an auctioneer can publish or cancel their own lot; cancellation requires no accepted bids.
- Leading bids reserve wallet funds. An outbid bidder's reservation is released atomically. The current leader cannot raise their own bid.
- Accepted bids in the final two minutes extend the deadline to two minutes after acceptance. The server clock is authoritative.
- Settlement runs automatically and exactly once. It debits the winner, credits the auctioneer, releases the reservation, and issues a public receipt. No-bid auctions close without a receipt.
- Deposits, publication, and bids use idempotency keys. Retrying an uncertain request reuses its original key; a `202` means audit confirmation is still pending, not permission to repeat the operation with a new key.

### Tamper detection

Each accepted bid belongs to an HMAC-authenticated chain. An independent audit database stores anchors so verification can detect changed or removed bids, including removal of the latest bid or restoration of an older valid history. Public output uses per-auction pseudonyms instead of bidder emails or private identifiers.

Verification fails closed when integrity cannot be established. The design does not protect against an attacker controlling both databases **and** the signing keys. Keep audit storage and keys separate; changing keys without a migration plan makes historical verification fail.

Run the destructive tamper demonstration only against the disposable databases created by the test runner:

```sh
npm run audit:tamper-demo
```

It modifies and restores isolated test records to demonstrate detection; never point destructive tests at the public demo.

## API overview

Base URL: `https://holobid--meiraitt--fmvj6fdxbbcx.code.run/api/v1`.

| Method and path                                                   | Access         | Purpose                                       |
| ----------------------------------------------------------------- | -------------- | --------------------------------------------- |
| `POST /auth/register`, `POST /auth/login`                         | Public         | Create a bidder account or start a session.   |
| `POST /auth/refresh`, `POST /auth/logout`                         | Session cookie | Rotate the session token or sign out.         |
| `GET /auth/me`                                                    | Authenticated  | Current user and role.                        |
| `GET /wallet`                                                     | Authenticated  | Total, reserved, and available balance.       |
| `POST /wallet/deposits`                                           | Bidder         | Add simulated funds.                          |
| `GET /catalog/items`, `GET /catalog/items/:externalId`            | Auctioneer     | Search and inspect TCGdex cards.              |
| `GET /auctions`, `GET /auctions/:auctionId`                       | Public         | Browse lots and view auction details.         |
| `POST /auctions`                                                  | Auctioneer     | Publish a lot from the external catalog.      |
| `POST /auctions/:auctionId/cancel`                                | Owner          | Cancel a lot without bids.                    |
| `POST /auctions/:auctionId/bids`                                  | Bidder         | Place a bid and reserve funds.                |
| `GET /auctions/:auctionId/me`, `GET /me/participations`           | Bidder         | Personal position and participation history.  |
| `GET /auctioneer/auctions`, `GET /auctioneer/summary`             | Auctioneer     | Owned lots and financial summary.             |
| `GET /auctions/:auctionId/bids`, `GET /auctions/:auctionId/audit` | Public         | Bid history and integrity verification.       |
| `GET /receipts/:publicCode`, `GET /media/:assetId`                | Public         | Shareable receipts and persisted card images. |
| `GET /health/live`, `GET /health/ready`                           | Public         | Process liveness and database readiness.      |

Protected routes use `Authorization: Bearer <accessToken>`. Authentication POST requests require the allowed `Origin`, JSON, and `X-CSRF-Protection: 1`; refresh/logout send `{}`. Deposits, bids, publication, and cancellation require an `Idempotency-Key` UUID. Errors include a stable code and request ID. Request and response types live in [packages/contracts/src](packages/contracts/src); validation and route handlers live in [API modules](apps/api/src/modules).

Socket.IO uses the same backend origin at `/socket.io`. Public auction notifications and private wallet/session notifications trigger HTTP refetches. Identity is derived from the verified session; clients cannot choose another user's private room.

## Testing

Run the complete pre-commit gate:

```sh
npm run check
```

This checks formatting, lint, types, builds, unit tests, PostgreSQL integration, cURL acceptance, authentication, auction flows, and real Socket.IO clients. Database suites create disposable databases and never use the caller's Neon URL. External catalog failures and time boundaries are controlled in isolated tests.

| Command                                                                 | Scope                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run test:web` / `npm run test:api`                                 | Frontend / backend unit tests.                                      |
| `npm run test:db`                                                       | Transactional rules, concurrency, persistence, and audit integrity. |
| `npm run test:http`                                                     | cURL requests against the compiled API and real PostgreSQL.         |
| `npm run test:auth` / `npm run test:auctions` / `npm run test:realtime` | Integrated HTTP and WebSocket scenarios.                            |
| `npm run test:e2e`                                                      | Chromium journeys against an isolated local stack.                  |
| `npm run check:container`                                               | The Docker checks stage used by Northflank.                         |

Install Chromium once before browser tests:

```sh
npx playwright install chromium
```

For a **read-only** check of the published frontend, routing, CORS, and public WebSocket:

```sh
npm run test:web:deploy -- --web https://holobid.vercel.app
```

The following is an explicit **write-enabled** release check. It creates two demo bidders, deposits, bids, and one auction using the real catalog and settlement clock. Records remain in the demo history; allow several minutes:

```sh
npm run test:web:release -- --web https://holobid.vercel.app --allow-write
```

Reports and screenshots are saved under ignored test-results directories. Release checks are manual and are not run automatically against production by CI. A previous passing run is not proof that a newer deployment was tested.

## Deployment

### API: Northflank and Neon

The existing deployment uses one free Northflank service and two Neon databases in separate projects. Keep usage within the providers' free quotas.

- Build context: repository root; Dockerfile: [apps/api/Dockerfile](apps/api/Dockerfile); target: `runtime`.
- The versioned `checks` stage runs `npm run check` against temporary PostgreSQL processes. The runtime image depends on successful checks; tests and databases do not enter the final image.
- Configure runtime variables from the API template. Use `NODE_ENV=production`, `PORT=3000`, `WEB_ORIGIN=https://holobid.vercel.app`, and `DEMO_MODE=true` for the demo.
- Keep database URLs and signing keys in runtime secrets, never build arguments. Preserve keys and database storage between releases.
- Expose HTTP port `3000`. Use `/api/v1/health/live` for routine probes and `/api/v1/health/ready` during release validation; readiness queries both databases and can wake an idle Neon instance.
- Keep CI enabled and deployments manual so migrations can run before promoting an image. No additional service, autoscaling, or paid keep-alive is needed.

Build the application and the separate migration target:

```sh
docker build -f apps/api/Dockerfile -t holobid-api .
docker build -f apps/api/Dockerfile --target migrations -t holobid-migrations .
docker run --rm --env-file /secure/path/runtime.env holobid-migrations
```

The migration image runs `npm run db:release`: audit migrations first, then main migrations. Migrations never run during image build or ordinary API startup. Use versioned SQL migrations, not `prisma db push`, because database constraints include handwritten SQL.

The runtime runs as a non-root user with compiled code and production dependencies. Roll back only to an image compatible with the current schema; do not reset databases or rotate audit keys as part of a rollback.

### Frontend: Vercel

Use the existing Vercel Hobby project, repository root, Node.js 24.x, and the `main` production branch. [vercel.json](vercel.json) builds contracts and the web app, publishes `apps/web/dist`, and routes deep links to the SPA.

```sh
npm run build:web:deploy
```

The build derives public API/WebSocket origins from the versioned authentication rewrite. `/api/v1/auth/*` is forwarded to the API before the SPA fallback, keeping refresh cookies HttpOnly, Secure, and on the frontend origin. Other HTTP requests and Socket.IO connect directly to the backend.

The backend accepts the exact `WEB_ORIGIN`; arbitrary Vercel preview URLs cannot authenticate against production. A frontend deployment does not deploy the API or run database migrations. The GitHub repository can remain private during development.

## Development

```sh
npm run format        # Apply ESLint fixes and Prettier formatting
npm run format:check  # Check formatting without changing files
npm run lint          # Check lint rules
```

Formatting, import groups, and spacing are defined in [prettier.config.mjs](prettier.config.mjs), [eslint.config.mjs](eslint.config.mjs), and [.editorconfig](.editorconfig).

Use one branch and PR per task, with English commit messages and PR descriptions. Run the checks before committing. `README.md` and safe `.env.example` templates are versioned; planning documents, real environment files, generated clients, dependencies, and test artifacts remain ignored.
