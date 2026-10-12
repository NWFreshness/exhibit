# Product to-do

From the product review on 2026-10-12. These are feature changes, not bug fixes;
bug fixes live in `docs/audit-todo.md`. Based on reading the code, not on user
interviews, so check each one against what councils actually ask for.

Tick a box when the change is in and `bash scripts/check.sh` exits 0.

Suggested order: 1 and 2 first (they change what "adopted" means), then 3, 4, 5.
The rest are independent.

Items marked **Rule change** conflict with a hard constraint in `AGENTS.md`.
Decide on the rule before building.

## Part A — Change what exists

- [x] 1. **Split the policy from the tool list**
  - Problem: one `AdoptedSnapshot` holds both. A board adopts policy text about once a year; the tool list changes monthly. Any tool edit marks everything stale until the owner re-adopts.
  - Change: keep `AdoptedSnapshot` for policy text (clauses and answers). Add a published tool-list version that the council can publish under the current policy without re-adopting. Staleness becomes two flags: "policy changed" and "tool list changed".
  - Touches: `prisma/schema.prisma`, `lib/assembler.ts` (the two hashes already exist), `app/actions/policy.ts` (`adoptSnapshot`), `lib/diff.ts`, `lib/exhibit.ts`, `lib/training.ts`, home, draft, snapshot, training, and public exhibit pages.
  - Decide first: do training acknowledgments attach to the policy version, the tool-list version, or both?
  - Done when: publishing a tool-list version leaves the policy snapshot untouched, and the public list and teacher card read the latest tool-list version.
  - Done: new `ToolListVersion` model and `lib/policy.ts`. `publishToolList` (owner) publishes the live list under the policy in force, with no seat sign-off and no board vote. Home and draft show "policy text changed" and "tool list changed" separately.
  - Decided: training acknowledgments follow the policy snapshot and also record the tool-list version shown. A newer tool list does not reset training.
  - Left open: the frozen policy html still contains the tool table as it stood at council approval. A list published between council approval and board adoption is replaced by the approval-time list once the board adopts; publish again after the board date.

- [x] 2. **Tie seat signatures to the draft they approved**
  - Problem: a seat signed once stays signed. The draft can change afterwards and adoption is still unlocked (`lib/seats.ts`, `signSeat`).
  - Change: store the draft hashes on `ReviewSeat` at signing. `boardLock` counts a signature only when its hashes match the current draft. Show "signed an earlier draft" next to a lapsed signature.
  - Touches: `prisma/schema.prisma` (`ReviewSeat`), `lib/seats.ts`, `app/actions/policy.ts`, `app/review/page.tsx`.
  - Depends on: 1, because it decides which hash a seat signs.
  - Done when: a test signs all seats, changes an answer, and adoption is refused.
  - Done: `ReviewSeat.signedHash` holds a hash of the answers plus the stored purpose paragraph. Overrides lapse the same way. The review page marks a lapsed seat "Signed an earlier draft".
  - Left open: seats signed before this change have no hash and stay valid until they are next signed. A tool-list change does not lapse a signature, by design.

- [x] 3. **Separate "council approved" from "board adopted"**
  - Problem: adoption is one owner clicking a button. Nothing records the board meeting or the vote.
  - Change: two states on the policy snapshot. Council approval happens when seats are signed. Board adoption is a second step that records meeting date and an optional resolution number. The public page and training packet read only board-adopted versions.
  - Touches: `prisma/schema.prisma` (`AdoptedSnapshot`), `app/actions/policy.ts`, draft, snapshot, export, and public exhibit pages.
  - Depends on: 1.
  - Done when: a council-approved draft is not public until the board date is entered.
  - Done: "Record council approval" creates the snapshot; `recordBoardAdoption` on the approved-policy page stores the meeting date and resolution number. Public list, training, and exports read only board-adopted policies. Existing snapshots were backfilled as board-adopted on their approval date.

- [x] 4. **Split notes into internal note and teacher guidance**
  - Problem: `DistrictTool.notes` holds council working notes and also prints on the teacher card and board draft. "Limited" has no field saying what the limit is.
  - Change: add `teacherGuidance` (printed) and `limitText` (required when decision is `limited`). `notes` becomes internal only and stops printing.
  - Touches: `prisma/schema.prisma`, `app/actions/tools.ts`, `app/tools/[id]/page.tsx`, `lib/assembler.ts` (tool table), `lib/training.ts`, `lib/guides.ts`, the snapshot row shape in `adoptSnapshot`, `lib/diff.ts`.
  - Migration: existing `notes` stay internal. Do not copy them into guidance; some are not fit to print.
  - Done when: a test puts text in `notes` and it appears in no generated packet.
  - Done: `teacherGuidance` and `limitText` on `DistrictTool`; both print, `notes` does not. The limit is asked for when a tool becomes limited; rows already limited can be saved without one.
  - Left open: rows pinned in snapshots before this change still print the note they were adopted with on staff packets (never on the public list). Seed data still puts its sample text in `notes`.

- [x] 5. **Make model text editable and frozen**
  - Problem: the purpose paragraph and family letter are regenerated on each view. The text a seat signed is not the text that gets adopted, and nobody can correct it.
  - Change: store the generated purpose paragraph and family letter on the draft. Add "Regenerate" and an edit box for the owner. Adoption copies the stored text. Pages stop calling the model on view.
  - Touches: `prisma/schema.prisma` (`Draft`), `lib/assembler.ts`, `app/actions/policy.ts`, draft, review, and export pages.
  - **Rule change:** `AGENTS.md` says adopted text never comes from the model beyond these sections; owner edits to model text are new. Confirm edited text still counts as the purpose paragraph.
  - Done when: two views of the draft show identical text and make no model call. This also closes the open half of audit item 4.
  - Done: purpose paragraph and family letter are stored on `Draft`. "Write both with AI" generates them; the owner edits them; no page calls the model on view. Editing lapses seat signatures.
  - Left open: council approval still calls the model if the texts were never written. `AGENTS.md` has not been updated for owner-edited model text.

- [x] 6. **Monthly renewal digest email**
  - Problem: renewal flags are rows. They are seen only if someone logs in.
  - Change: after `runRenewalPass`, send one email per district to each tool's renewal owner (fallback: district owners) listing open flags. Reuse the SMTP settings from `auth.ts`. No email when nothing is open.
  - Touches: `lib/renewals.ts`, `app/api/cron/renewals/route.ts`, a small mail helper shared with `auth.ts`.
  - **Rule change:** `AGENTS.md` says the renewal pass flags rows, never emails, and makes no outbound HTTP. SMTP is not HTTP, but the intent was no mail.
  - Done when: a test with a stubbed transport gets one message listing the flagged tools.
  - Done: `renewalDigests` in `lib/renewals.ts` builds one digest per renewal owner (district owners as fallback); the cron route sends them through `lib/mail.ts`, which `auth.ts` now shares. No mail server means no mail and rows only.
  - Left open: tested at the digest level, not with a stubbed transport; no real mail was sent. `AGENTS.md` still says the renewal pass never emails.

## Part B — Add what is missing

- [x] 7. **Teacher lookup**
  - Problem: teachers ask "can I use X with 7th graders?" The public page is an unsearchable table with no reason given.
  - Change: on `app/exhibit/[districtId]/page.tsx`, add a search box and a grade-band filter. Each row shows the decision, the band rule, and the teacher guidance from item 4. Unlisted tool: say "not permitted" and link to the request form.
  - Depends on: 4 for guidance text.
  - Done when: typing a tool name narrows the list without a login.
  - Done: `app/exhibit/[districtId]/lookup.tsx` filters by name and grade band and shows guidance; no match links to the request form. Tools on hold or banned show "not permitted" for every band.
  - Left open: the filter is browser code with no automated test.

- [x] 8. **Translated family letters**
  - Problem: the family letter is English only.
  - Change: the district picks languages (start with Spanish). Generate one letter per language through `lib/llm.ts`, stored and editable as in item 5. Label each as machine-translated until a person marks it reviewed.
  - Touches: questionnaire answers, `lib/llm.ts`, `lib/assembler.ts` (`familyLetter`), `app/export/family/page.tsx`.
  - Depends on: 5.
  - Done when: the export page shows one reviewed-or-labeled letter per chosen language.
  - Done: nine languages offered on the draft page. A translation is stored unreviewed, the owner edits it and marks it reviewed, and council approval copies it into the snapshot. The family export labels unreviewed ones.
  - Left open: no real model was called; with no model key the text is labeled sample text in English.

- [x] 9. **Delete, rename, and merge tools**
  - Problem: no action removes or renames a `DistrictTool`. Duplicates and mistakes stay forever.
  - Change: owner-only archive (soft delete, kept for the audit trail), rename, and merge two rows (requests, agreements, comments, and events move to the kept row).
  - Touches: `prisma/schema.prisma` (`archivedAt`), `app/actions/tools.ts`, tool and inventory pages, every `districtTool.findMany` that feeds the hash or a packet.
  - Done when: an archived tool disappears from the draft and inventory but its events remain.
  - Done: owner-only archive and restore, rename, and merge on the tool page, each recorded as a decision event. Merge moves requests, agreements, comments, events, and renewal flags, then removes the duplicate row; that step cannot be undone.

- [x] 10. **A denominator for training**
  - Problem: "12 signed" means little without "of 40".
  - Change: add `staffCount` to `School`, entered by the owner. Show "12 of 40" and a percent per building.
  - Touches: `prisma/schema.prisma` (`School`), `app/actions/council.ts`, `lib/rollup.ts`, training and home pages.
  - Note: a number only. A staff roster is not a student record, but a count avoids the question.
  - Done when: the training page shows signed-of-total per building.
  - Done: `School.staffCount`, set on the council page; the training page shows "12 of 40 signed (30%)".
  - Left open: the home page "not yet trained" line still means zero signatures, not a percent.

- [x] 11. **PDF or Word export**
  - Problem: exports are HTML pages. Boards usually want a file.
  - Change: start with a "Save as PDF" button that calls the browser print dialog, plus print styles checked for the board packet, family letter, and teacher card. Add real file generation only if districts ask for Word.
  - Touches: export pages, `app/globals.css` print block.
  - Done when: each of the three exports prints to a clean PDF with page breaks between sections.
  - Done: "Save as PDF or print" button on the board, family, and teacher exports and the training packet, plus print styles for margins and page breaks.
  - Left open: no PDF was actually printed and looked at. No Word export.

- [x] 12. **District sign-up**
  - Problem: a district exists only if the seed script creates it.
  - Change: an operator-only page or script that creates a district, its first owner invite, and its login domain. Self-serve sign-up can wait.
  - Touches: a new action or `scripts/` entry, `lib/domain.ts`.
  - Done when: a new district can be created and its owner can sign in without touching the database by hand.
  - Done: `npm run district:create -- "<name>" <owner email> [WA]` creates the district, its login domain, its seats, and an owner invite.
  - Left open: the script was tested through `createDistrict`, not run from the command line against a real sign-in.

- [x] 13. **Shared findings between districts**
  - Problem: every district researches the same vendors alone. The shared catalog has no write path.
  - Change: a district can opt in to share a cited finding (value, source URL, date). Other districts see it on the tool page as "reported by another district", never merged into their own exhibit until they accept it.
  - Touches: `prisma/schema.prisma`, `app/actions/policy.ts` (`citeFinding`), `lib/rubric.ts` (`mergedExhibit`), tool page.
  - **Rule change:** `AGENTS.md` says never invent vendor facts and districts never edit catalog rows. Shared findings must stay labeled, cited, and opt-in on both sides.
  - Done when: district B sees district A's shared finding with its source, and B's rubric is unchanged until B accepts it.
  - Done: a "share" checkbox on the cite form stores a `SharedFinding` for catalog-linked tools. Other districts see value, source, and date on the tool page, never who shared it, and "Accept as our finding" copies it into their own record with the original source.
  - Left open: nothing withdraws a shared finding except citing again. `AGENTS.md` has not been updated for this.

## Not on this list

- Replacing the request status-token page with an email on decision. Suggested in the review as something to shrink; it needs the same mail rule change as item 6.
