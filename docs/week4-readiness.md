# November 12: Auth & Profiles readiness

Evidence date: November 11, 2026. No live tester responses are included.

## Baseline and scope

Main contained working Week 1–3 implementations and the team's newer real Send, Requests, Groups/splits, History and navigation code. Baseline lint and 78 automated tests passed. The first build encountered stale local generated types for the removed `/preview` route; moving that development cache aside produced a passing clean baseline build. No product change or dependency upgrade was needed for that cache issue.

The preview-only route/inventory are absent on all Week 4 branches. The archived local preview branch is retained as a reversible backup. Week 1–3 PR history and existing AGENTS.md edits are preserved. No production navigation, transaction logic, shared schema, credentials or infrastructure is changed.

## Confirmed Auth-owned fixes

| Priority | Reproduction | Fix set |
| --- | --- | --- |
| P1 | Delayed username response still called onSaved after unmount; browser assertion failed before fix | Auth reliability PR #26: cancellation, submission lock and callback guard |
| P2 | Username saves had no deadline; sync deadline ended before body parsing | PR #26: full 15-second request/body deadline, safe response/error validation and retry classification |
| P2 | Enter on UserPicker Clear reached Groups' parent add shortcut; browser assertion failed before fix | UserPicker PR #27: stop Enter propagation on Clear, preserve native activation |
| P2 | Input/Clear mobile hit targets were below the chosen 44px minimum | PR #27: minimum heights; touch/keyboard checks at 320/375/390px |

No new wallet, profile-editing or faucet feature is required. Existing balance/network/precision, account-switch and Clipboard API tests are rerun as regression evidence; further production changes require an actual reproduced issue.

## Verification and limits

Baseline main: 78 tests. Auth fix branch: 83 tests (five new request-lifetime tests), lint, explicit TypeScript and production build passed. Its real-component browser regression now passes for stale saves, timeout/retry and conflict feedback; existing onboarding/profile fixture suites passed. UserPicker branch: 78 tests, lint, explicit TypeScript, build, existing browser suite, and new keyboard/touch/mobile/debounce suite passed. These are unit and controlled-service browser results, not physical phone or real OAuth evidence.

The separate integration script exercises the actual Send/Requests/Groups forms using mocked transport/identity/wallet services. It checks recipient selection and request/member payloads without sending funds or writing to the real database. A combined local branch is used to verify PR #26 and #27 together; it is not pushed to main.

The tester checklist and header-only feedback log are in [week4-testing.md](week4-testing.md) and [week4-feedback.csv](week4-feedback.csv). CI results and final executed integration/live-read checks are reported in the PR descriptions and final handoff, not inferred from code existence.

## Remaining demo gates (manual)

- Real email and Google sign-in on the authorized deployment, including fresh-account creation, uniqueness and logout/relogin.
- Apply/review any outstanding committed migrations with the database lead. No new migration is introduced in Week 4.
- Two-account funded test transfer, balance refresh and Activity confirmation with the Send/History owners; real request/group test flows as coordinated by their owners.
- Actual iPhone/Android testing and 5–10 real club-member sessions/survey responses. Current recorded external responses: **zero**.
- Lead-approved deployment/preview access. The existing workflow skips previews for non-crh78 authors; this restriction was not changed.
- Review and explicitly approve PR merges after required CI passes. No PR is merged by this agent.

Status: automated/local readiness can be verified; full November 12 demo readiness remains conditional on the manual gates above. Previous user-supplied Week 3 screenshots showed successful funding from 0 to 20 USDC, but are not fresh Week 4 OAuth/device/production acceptance evidence.
