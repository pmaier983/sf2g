# SF2G rework — plan index

Research and plan written 2026-10-22 by Claude (Fable 5.1) from a hands-on audit, production read-only queries and logs, and the git history. Each `phase-*.md` is self-contained: hand one file to an implementation agent (Opus 5.5) with "Implement `docs/rework/phase-NN-….md`; open a PR; stop."

| File | What it is |
|---|---|
| [00-FABLE-BRIEF.md](00-FABLE-BRIEF.md) | The original brief this plan was produced from |
| [01-findings.md](01-findings.md) | Root causes with evidence (VERIFIED vs HYPOTHESIS) |
| [02-architecture.md](02-architecture.md) | Target architecture; ADR-1…8; what stays unchanged; cost table (all $0) |
| [phase-00-safety-and-foundation.md](phase-00-safety-and-foundation.md) | Lock down anon RPCs, local Supabase, `CLAUDE.md`, CI |
| [phase-01-restore-sync-hotfix.md](phase-01-restore-sync-hotfix.md) | Make the dead cron actually run — restores 69 riders without re-auth |
| [phase-02-test-harness.md](phase-02-test-harness.md) | Fixture DB, golden/characterization tests, component + e2e setup, CI jobs |
| [phase-03-aggregation-in-postgres.md](phase-03-aggregation-in-postgres.md) | 03a–d: one SQL function per table/chart; ends the 1102s |
| [phase-04-reliable-sync.md](phase-04-reliable-sync.md) | 04a–d: webhook ack-and-enqueue, job table, Cron Trigger drain, backfill, health |
| [phase-05-table-foundation.md](phase-05-table-foundation.md) | 05a–e: `TableQuery` URL state, shared `<DataTable>`, migrate each table, bug list |
| [phase-06-cleanup.md](phase-06-cleanup.md) | Timezones, map tiles, charts, advisors, DevTools safety, runbooks |
| [phase-08-observability.md](phase-08-observability.md) | Error capture (app_errors, PostHog exceptions) and the monthly report email (built 2026-10-25) |

## The two headline findings

1. **The scheduled sync has never been running.** `/api/cron` returns 202 and leaves the work as a dangling promise, which Cloudflare cancels. GitHub Actions reports success because 202 is a 2xx. Result: 69 of 70 riders have had no sync since their last manual visit; Simon since July. Their refresh tokens are still valid, so **Phase 01 fixes this in one day with no re-authorization.**
2. **The 1102s and the "wrong numbers" are one problem.** Handlers pull whole tables into the Worker (18 pages of `rides` per leaderboard view, 25–30 subrequests against a cap of 50, JS aggregation under 10 ms CPU), and three different code paths compute the leaderboard differently. **Phase 03 moves every aggregation into one SQL function per table; Phase 05 gives every table one validated query model.**

## Order and parallelism

```
00 ─┬─► 01 (hotfix; ship same day)
    │
    └─► 02 ─┬─► 03a ─► 03b ─► 03c ─► 03d
            │     ▲                     │
            ├─► 05a ─► 05b ─► 05c ─► 05d ─► 05e
            │
            ├─► 04a ─► 04b ─► 04c ─► 04d
            │
            └─► 06a, 06b
```

- **Serial spine:** 00 → 02. Everything else hangs off 02 (goldens + CI).
- **Parallel tracks after 02:** `03` (SQL), `04` (sync), `05a/05b` (query model + shell), `06` (cleanup) touch disjoint files and can run as four concurrent sessions in separate worktrees.
- **Join points:** `05c` needs `03a`; `05d` needs `03b`/`03d`; `05e` needs `03c`; `04d` needs `03d` (`rider_edges` refresh hook); `06a` needs `05a` (`resolveDateRange`).
- `03a` and `05a` both want to own `app/lib/table-query.ts` — whichever starts first creates it; the other adopts it. Say so in the brief of the second one.

## Rules every implementing agent follows

- One phase (or sub-phase) = one PR = one session. Leave `main` deployable.
- **Local database only.** `.env.local` → `http://127.0.0.1:54321`. Never point at project `dgoqjrfjrzewplwayhhz`. Migrations go to prod only via `supabase db push --linked` run by Phillip after review.
- Tests first: the phase's acceptance criteria name the test; write it failing, then implement.
- Changing a golden number requires a sentence in the PR explaining why the new number is right (ideally pointing at the hand-computed fixture total).
- Keep `[perf]` logging; a server function that makes > 3 Supabase requests is a bug.
- Don't touch files owned by a phase running in parallel (see the graph).
- Commit messages end with the attribution line the session provides.

## Open items for Phillip

- Run the Strava push-subscription check (04 prerequisite) and share the output.
- Confirm deletion of `GEMINI.md`, `.agent/`, `swarm_session/`, `Egan Scraper.md` (asked in the Phase 00 PR).
- Top table bugs with repro steps → `docs/rework/TABLE_BUGS.md` (05a collects them).
- Cloudflare dashboard access for an implementing agent is not required, but a screenshot of Workers → Errors before Phase 03 and after 03d makes the 1102 acceptance criterion measurable.
