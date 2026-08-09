# Black Tiger Commerce API (Milestone 1)

NestJS 11 mock Commerce API with JWT auth, in-memory persistence (optional Redis idempotency), and contracts aligned with `openapi/*.yaml`.

## Prerequisites

- Node.js 22+
- npm

## Setup

```bash
cp .env.example .env
```

Edit `.env` and set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (use long random strings).

```bash
npm ci
npm run build
npm run start:dev
```

Default URL: `http://localhost:3001`

## Useful endpoints

| Area | Notes |
|------|--------|
| Health | `GET /health`, `GET /ready` (no `/v1` prefix) |
| API | Resource routes under `/v1/...` |
| Swagger | `GET /docs`, `GET /docs-json` |
| Demo login | `demo@blacktiger.com.sa` / `Password1!` (segment `b2c`) |
| Dev OTP | With `USE_MOCK_OTP=true`, OTP code is **`123456`** |

## Docker (API + Redis)

From the `docker` directory (build context is the project root):

```bash
cd docker
docker compose up --build
```

Override JWT secrets via environment variables when starting Compose.

## OpenAPI

M1 specs live in the `openapi/` folder for clients and codegen.

## Scripts

| Command | Description |
|---------|--------------|
| `npm run start:dev` | Watch mode |
| `npm run build` | Production compile |
| `npm run start:prod` | Run `dist/main.js` |
| `npm test` | Unit tests |
| `npm run test:e2e` | E2E smoke (`GET /health`) |
