# AGENTS.md — Exhibit (phase 1, AI council)

## What this is
Multi-tenant inventory + AI policy drafter for a K-12 district AI council.
Not a chatbot, tutor, LMS, SCORM, chat-over-policy, or analytics. No queues/workers;
assembler and review resolution run in server actions.

## Hard bans (never violate; add a test before touching these areas)
1. No field, upload, or prompt may hold student records, rosters, grades, IEPs,
   504s, discipline notes, or pasted student work. Uploads: contracts/district docs only.
2. The model writes ONLY the purpose paragraph and the family letter, and only via
   `lib/llm.ts`. Every other section is clause ids + variables or live tables.
3. Discipline, data-privacy, tool-approval, staff-use sections are clause ids.
   Free text never enters adopted text unless the owner promotes it to the clause library.
4. Tenant isolation: every district-owned table has `district_id`; every query is
   scoped via `lib/tenancy.ts`. No schema-per-tenant. Covered by a test.
5. Never invent vendor facts. Unknown is a valid exhibit state.
6. Out of scope this session: cron, Clever/SIS sync, billing, privacy-policy
   watching, Microsoft login, ESD parent tenants.

## Verify (definition of done for any feature)
`bash scripts/check.sh` — prisma validate + generate, `tsc --noEmit`, `vitest run`.
Tests run with the model stubbed (`LLM_STUB=1`). A feature is done only when its
test passes; never mark done because a page renders.
Record the command output and the single next action in `progress.md`.
See `feature_list.json` for the 9-slice plan and statuses.

## Module map
- `prisma/schema.prisma` — CatalogTool, DistrictTool, DecisionEvent, Agreement,
  ReviewSeat, Clause, QuestionnaireAnswer, Comment, Draft, AdoptedSnapshot, User, District
- `prisma/seed.ts` — 15 real catalog tools (exhibit unknown), clause library
  (common + WA), Cedar Ridge sample district + 8 tools
- `lib/tenancy.ts` — session→district scoping, `scoped()` query guard
- `lib/rubric.ts` — pure decision rubric (visible in UI)
- `lib/assembler.ts` — eight-section draft from answers + clauses + live tool table
- `lib/llm.ts` — the ONE OpenAI-compatible client (base URL + key from env)
- `lib/seats.ts` — required/optional review seats, sign + owner override
- `lib/store.ts` — Vercel Blob with local-disk fallback (dev only)
- `app/*` — Home, Catalog, Inventory, Tool detail, Questionnaire, Draft,
  Review packets, Snapshot, Training packet, Export
- `app/actions/*` — server actions: import, decisions, answers, comments,
  seats, adopt
- `lib/*.test.ts` — tenancy, rubric, assembler, snapshot tests

## Phase 2 — district sign-in (Google first, Microsoft Entra second)
- Enabled per provider env vars only: `GOOGLE_CLIENT_ID/SECRET`,
  `MICROSOFT_ENTRA_CLIENT_ID/SECRET` (+ optional `TENANT_ID`). No secrets in repo.
- Per district: owner saves `allowedDomains` on the Council screen; one primary
  domain is required before district sign-in works for that district.
- OAuth callback URLs to register (Google Cloud + Entra app registrations):
  production `https://<app>.vercel.app/api/auth/callback/<provider>`,
  previews `https://<branch>-<org>.vercel.app/api/auth/callback/<provider>`
  (Vercel preview domain pattern), local `http://localhost:3000/api/auth/callback/<provider>`.
  `<provider>` is `google` or `microsoft-entra-id`.
- Gate lives in `auth.ts` `signIn` via `lib/domain.ts` `resolveLogin`:
  invite > existing user > allowed domain; anything else (incl. Gmail etc.)
  is rejected before a session exists. Sessions are database sessions;
  the tool table never goes in a token.

## Phase 2 — renewal pass (monthly cron, no crawler)
- `lib/renewals.ts` `runRenewalPass` flags ends-soon (90d), expired, still-hold
  as `RenewalFlag` rows and forces expired approvals/limiteds to hold.
  No outbound HTTP anywhere in this workstream.
- Vercel cron: `vercel.json` runs `GET /api/cron/renewals` monthly (1st, 09:00)
  with `Authorization: Bearer $CRON_SECRET`. Same header is the test hook.
- Restart dev after every migration, or the old Prisma client serves stale code.
