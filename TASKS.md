# Task List

Execute tasks **in order**. Each task depends on the previous one compiling and passing tests.
Commit after completing each task. Start every Claude Code session by reading `CLAUDE.md` first.

| # | Task File | Description | Status |
|---|-----------|-------------|--------|
| 01 | `tasks/01-tax-tables.md` | Tax lookup tables (brackets, IRMAA, RMD, estate, WA cap gains) | ✅ DONE |
| 02 | `tasks/02-types.md` | All TypeScript interfaces (`YearState`, `Strategy`, `Assumptions`, etc.) | ✅ DONE |
| 03 | `tasks/03-compute-year.md` | Per-year cost function + all helper functions (the core tax math) | ✅ DONE |
| 04 | `tasks/04-simulate.md` | Forward simulation loop (`simulate()` + `initialState()` + `resolveDecision()`) | ✅ DONE |
| 05 | `tasks/05-greedy-optimizer.md` | Fill-to-cliff baseline optimizer (sanity check reference) | ✅ DONE |
| 06 | `tasks/06-ui-shell.md` | React UI shell — inputs, strategy controls, results display, charts | ✅ DONE |
| 07 | `tasks/07-dp-optimizer.md` | Backward dynamic programming optimizer (global optimum solver) | ✅ DONE |

---

## Status Key
- ⬜ TODO — not started
- 🔄 IN PROGRESS — currently being worked on
- ✅ DONE — all files created, all tests passing, committed

## Notes
- Tasks 01–05 are **engine-only** (pure TypeScript, no React). Build these before any UI work.
- Task 05 (greedy optimizer) provides the sanity-check baseline; task 07 (DP) is the rigorous solver.
  If the DP result ever disagrees with greedy by more than ~5%, suspect a bug in the DP first.
- The UI in task 06 is wired to the greedy optimizer initially. The DP from task 07 can be
  swapped in as an optional "deep optimize" mode once task 07 is complete.
