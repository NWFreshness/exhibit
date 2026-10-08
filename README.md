# Exhibit — district AI tool file & policy draft (phase 1, AI council)

Board-ready answer to "which AI tools do we allow, and what is our policy?"
Not a chatbot, tutor, LMS, chat-over-policy, or analytics.

## Stack
Next.js App Router + TypeScript + Prisma + Postgres (Neon / Vercel Postgres;
local docker for dev) + Auth.js magic link + Vercel Blob. One OpenAI-compatible
client (`lib/llm.ts`, base URL + key from env). Assembler and review run in
server actions — no worker, no queue.

## Run locally
Requires the dev database (docker Postgres on host port 5433):

  docker run -d --name exhibit-pg -e POSTGRES_PASSWORD=exhibit \
    -e POSTGRES_USER=exhibit -e POSTGRES_DB=exhibit -p 5433:5432 postgres:16-alpine
  cp .env.example .env
  npm install
  npx prisma migrate deploy
  npx tsx prisma/seed.ts
  npm run dev            # http://localhost:3000

Sample logins (magic link; with no SMTP the link is shown on screen):
owner `director@cedarridge.example`, curriculum `curriculum@cedarridge.example`,
sped `sped@cedarridge.example`, viewer `board@cedarridge.example`.

## Verify (definition of done)
  bash scripts/check.sh     # prisma validate + generate, tsc --noEmit, vitest run

Tests run with the model stubbed (`LLM_STUB=1`): tenancy, rubric, assembler,
snapshot immutability, training packet, CSV guard. See `progress.md`.

## Deploy on Vercel
Set `DATABASE_URL` (Neon / Vercel Postgres), `AUTH_SECRET`, `AUTH_URL`,
SMTP_* for magic links (or leave empty for dev pickup), `LLM_BASE_URL` +
`LLM_API_KEY` for real prose (else stub text), `BLOB_READ_WRITE_TOKEN`
(else local-disk fallback, dev only).

Out of scope: cron, Clever/SIS sync, billing, privacy-policy watching,
Microsoft login, ESD parent tenants.
