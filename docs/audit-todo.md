# Audit to-do

From the whole-repo audit on 2026-10-12 (branch `feat/4.4-public-adopted-list`).
Tick a box when the fix is in and `bash scripts/check.sh` exits 0.

Before starting: the test database on `localhost:5433` was down during the
audit, so 14 of 19 test files failed with `Can't reach database server`.
Start it first, or no fix below can be verified.

- [x] 0. Start the test database and get `bash scripts/check.sh` to exit 0 on the current code.

## Must fix

- [x] 1. **Dev magic-link pickup is open when mail is not set up** — `app/api/dev-link/route.ts:6`
  - Problem: the only switch is `SMTP_HOST`. With it empty in production, anyone can fetch the sign-in link for any email.
  - Fix: also return null unless `process.env.NODE_ENV !== "production"`. Remove the "or leave empty for dev pickup" line from `README.md`.
  - Done: route and sign-in page both check `NODE_ENV`. Test: `app/api/dev-link/route.test.ts`.

- [x] 2. **One district can rewrite every district's clause text** — `app/actions/policy.ts:119-132`, `lib/assembler.ts:209-214`
  - Problem: `Clause` has no district. `promoteProposal` adds a new version that the assembler then picks for every district.
  - Fix: add a nullable `districtId` to `Clause`. Promoted rows carry it. The assembler picks `districtId in [mine, null]`. Add a test with two districts.
  - Done: migration `20261012120000_clause_district`, `clauseScope` in `lib/tenancy.ts`, promotion moved to `lib/clauses.ts`. Test: `lib/clauses.test.ts`.
  - Left open: clause versions promoted before this change have no district and stay shared. Check production for them by hand.

- [x] 3. **An owner can pull another district's people into their own** — `lib/domain.ts:30-36,48-49`, `auth.ts:74-78`, `app/actions/council.ts:10-17`
  - Problem: an invite beats an existing account and the upsert overwrites district and role. An owner can also list another district's domain.
  - Fix: in `sendInvite`, refuse an email that belongs to a user in another district. In `setDomains`, refuse a domain another district already lists. Add a test for each.
  - Done differently: the invite rule lives in `resolveLogin`, not `sendInvite`. An invite from another district is ignored for an existing user, so invites already in the database are covered too. `setDomains` refuses a claimed domain. Tests: `lib/domain.test.ts`.
  - Left open: the owner gets no message when they invite someone who belongs elsewhere; the invite just never applies. A user can no longer be moved between districts by invite.

- [x] 4. **Every page load calls the model** — `lib/assembler.ts:231`, `app/page.tsx:25`, `app/training/page.tsx:19`, `lib/llm.ts:72`
  - Problem: `assemble()` calls the model for the purpose paragraph, and pages call it only to compare hashes. No timeout. A model outage breaks the home page.
  - Fix: move the two hash computations into a function with no model call and use it on home and training. Add `signal: AbortSignal.timeout(20000)` to the fetch.
  - Done: `assemble(db, id, { prose: false })` skips the model. Used on home, training, and the three export pages that only read the gate. Test: `lib/assembler.test.ts`.
  - Left open: draft, review, and board export still call the model on each view, because they show the paragraph.

- [x] 5. **Anonymous requests change what staff see** — `lib/requests.ts:79-92`, `lib/assembler.ts:279`, `lib/training.ts:41,63`
  - Problem: no rate limit. Each public request marks the adopted packet stale, and its name and note print on the teacher card after the next adoption. The status link shows the live decision for any tool name.
  - Fix: hash and snapshot only `inUse` rows. Do not copy the note into `DistrictTool.notes`. Cap open public requests per district per day.
  - Done differently: the hash, snapshot, and diff skip open requests (`source = request` and `decision = hold`), not all rows that are not in use. An existing test requires that approving a request row changes the hash. The note stays on the `ToolRequest` row only. Cap is 50 requests per district per day. Tests: `lib/requests.test.ts`.
  - Left open: the status link still shows the live decision for any tool name typed. Spec 4.6 asks for the current decision, so this needs a decision, not a patch.
  - Left open: a snapshot adopted before this change that holds open request rows shows as stale once, until re-adopted.

## Should fix

- [x] 6. **A failed adoption still adopts** — `app/actions/policy.ts:253-297`
  - Problem: the snapshot is created before the model call and the blob write. If either fails, the owner sees an error but the snapshot exists, and a retry makes a second one.
  - Fix: build the family letter before `adoptedSnapshot.create`. Wrap the blob write in try/catch and leave `exportKey` null.
  - Done: as planned. A model failure returns an error and adopts nothing. Test: `lib/adopt.test.ts`.

- [x] 7. **Nothing stops "approved" without an agreement** — `app/actions/tools.ts:84-96`, `lib/rubric.ts:1`
  - Problem: `evaluateRubric` only draws the tool page. `updateTool` saves `approved` with `not_requested`.
  - Fix: in `updateTool`, refuse `approved` unless the rubric verdict is `clear`. Add one test.
  - Done differently: `approved` is refused without a signed agreement, or when content is used for training. The full rubric is not enforced: the seed's own approved sample (Quizizz AI) gets a `hold` verdict, and the rubric type calls its result a suggestion. Test: `lib/audit-actions.test.ts`.
  - Left open: a row already approved without a signed agreement cannot be saved until its decision changes.

- [x] 8. **Any writer can sign any seat** — `app/actions/policy.ts:135-143`
  - Problem: `signSeat` never checks `assignedEmail`, so one user can sign all three required seats.
  - Fix: refuse when `s.assignedEmail` is set and differs from `user.email`. Confirm first that the assignment is meant to bind.
  - Done on an assumption: no spec says the assignment binds. An assigned seat is now signed only by its assignee; an unassigned seat is still open to any writer; the owner override is unchanged. Test: `lib/audit-actions.test.ts`. Revert the three lines in `signSeat` if the assignment is only a label.

- [x] 9. **Uploaded contracts are public files with no download link** — `lib/store.ts:25`, `app/tools/[id]/page.tsx:213`
  - Problem: stored with `access: "public"`, a guessable path, and the uploader's content type. The page prints only the key.
  - Fix: add `addRandomSuffix: true` and store the returned URL, or serve files through a signed-in route. Force `application/octet-stream`.
  - Done: random suffix on every stored file, uploads stored as `application/octet-stream`, and a signed-in download route `app/agreements/file/[id]/route.ts` linked from the tool page.
  - Left open: the files are still public to anyone holding the full URL; this SDK version has no private access. The Vercel Blob path is untested here: only the local-disk path ran. Files uploaded before this change keep their guessable paths.

- [x] 10. **The upload's expiry date is ignored** — `app/actions/tools.ts:119,132-138`, `lib/renewals.ts:32`
  - Problem: the date is saved on the agreement only, so the renewal pass never flags it. A bad date crashes after the file is stored.
  - Fix: check the date with `dateRe` before `putBlob`, and set `agreementEndsOn` in the same tool update.
  - Done: for uploads and alliance pointers. Test: `lib/audit-actions.test.ts`.
  - Left open: a past date with status `signed` is not turned into `expired` on upload; the next renewal pass or tool save does that.

- [x] 11. **Typing an email creates the account before the link is clicked** — `auth.ts:68-89`
  - Problem: the sign-in callback also runs on the magic-link request. It creates the user, marks the invite accepted, and assigns the seat.
  - Fix: after the gate check, return early when `email?.verificationRequest` is true. Verify this against the installed Auth.js version first.
  - Done: verified in `@auth/core` 0.41.3 (`send-token.js` passes `email.verificationRequest`; the callback runs again before the user lookup when the link is used). The gate and its writes moved to `admitLogin` in `lib/domain.ts`. Test: `lib/domain.test.ts`.
  - Left open: not run against a real sign-in in a browser.

- [x] 12. **The public list shows banned and on-hold tools** — `app/exhibit/[districtId]/page.tsx:27`, `lib/exhibit.ts:41-56`
  - Problem: the page says "approved or limited" but prints every snapshot row. `lib/exhibit.test.ts:91` seems to expect banned rows.
  - Fix: decide which is right, then filter to `approved` and `limited` in `projectExhibitRows` or change the sentence.
  - Done: the sentence changed. Spec 4.4 says each row shows its adopted decision, and the tests expect banned and hold rows, so the list was right and the wording was wrong. Open requests no longer enter snapshots (item 5).

- [x] 13. **CSV import breaks on commas inside quotes** — `lib/csv.ts:16`
  - Problem: `"Google Workspace, Education",Productivity` becomes the tool `Google Workspace` with category `Education"`.
  - Fix: split with a quote-aware pattern and strip the quotes. Add one test line.
  - Done: test in `lib/csv.test.ts`. Still not handled: a line break inside a quoted cell.

- [x] 14. **Importing twice doubles the inventory** — `app/actions/inventory.ts:61,86`
  - Problem: import and manual add always create a row. Only the request path checks for an existing name.
  - Fix: reuse the case-insensitive `findFirst` from `lib/requests.ts:60` and skip existing names.
  - Done: import skips names already present, and repeats within one file. Manual add returns an error. Test: `lib/audit-actions.test.ts`.
  - Left open: the import message does not say how many rows were skipped. Duplicates already in a database stay.

## Nice to have

- [x] 15. **The student-data guard blocks normal text** — `lib/guard.ts:5`, `app/actions/policy.ts:196`
  - Problem: `\b504\b` refuses the vendor contact `504-555-0100`. `citeFinding` runs the guard on the date and the user's own email.
  - Fix: match `/\b504 plan\b/i`, and drop the date and email from that loop.
  - Done: the guard matches `504 plan(s)`, `504 accommodation(s)`, and `section 504`. `citeFinding` checks only the URL. Test: `lib/csv.test.ts`.
  - Left open: a bare "her 504" is no longer refused. A citation URL containing a word such as `roster` is still refused.

- [x] 16. **Small duplicates and stale text** — `app/actions/council.ts:15`, `lib/domain.ts:44`, `app/actions/inventory.ts:17-22,85`, `lib/assembler.ts:208`, `README.md:39`
  - Problem: two free-mail lists that disagree on `proton.me`, three catalog name matchers, a ternary with two equal branches, and a README that calls cron and Microsoft login out of scope.
  - Fix: export the list from `lib/domain.ts`. Use `closeCatalogMatch` in all three places. Replace line 208 with `key || fallback`. Update the README.
  - Done: one `FREE_MAIL_DOMAINS` list in `lib/domain.ts`; import preview uses `closeCatalogMatch`; the ternary is gone; README matches the app.
  - Done differently: manual add (`addTool`) keeps its exact-name match. The fuzzy matcher there would link a catalog row, and its vendor facts, with no confirm step.

## Smaller items

- [ ] 17. **Sign-out is a GET** — `app/signout/route.ts:3`. Another site can log a user out with an image tag. Make it a POST form.
- [ ] 18. **Renewal pass makes one query per tool** — `lib/renewals.ts:52`. Load all open flags for the district once. Two runs at the same time also create duplicate flags.
- [ ] 19. **`next-auth` is pinned to the `beta` tag** — `package.json`. Pin the exact version from `package-lock.json`.
- [ ] 20. **Tool update and its audit event are not in one transaction** — `app/actions/tools.ts:84-103`. Wrap both in `prisma.$transaction`.

## Found while fixing

- [x] 21. **Saving a tool wipes its citation** — `app/actions/tools.ts:44-56,89`. `updateTool` rebuilds `exhibitOverride` from the form's known keys only, so `citationUrl`, `citationDate`, and `citedBy` written by `citeFinding` are dropped on the next save. Start from the existing override and keep those three keys. Read from the code, not reproduced. Done: `updateTool` carries the three keys over; test in `lib/product.test.ts`.

## Not checked in the audit

- DB-backed tests (database was down).
- No server action has a test, so 2, 3, 7 and 8 have nothing guarding them today.
- Not read in full: `lib/diff.ts`, `lib/guides.ts`, `app/review/page.tsx`, `app/council/page.tsx`, `app/shell.tsx`, `prisma/seed.ts`, migrations, `factory/`, `specs/`, `docs/`.
