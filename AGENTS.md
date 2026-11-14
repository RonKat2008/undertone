# Undertone — rules for every coding agent in this repo

Undertone is a one-day hackathon project: a wearable speech coach. `plan.md` is the source of truth. Read the sections that cover your work before writing code.

## Who owns what

| Path | Built by | Never touched by |
|---|---|---|
| `backend/`, `scripts/`, `fixtures/`, `sdk/` | Claude Code | Antigravity |
| `dashboard/`, `mobile/` (look and screens, on mock data) | Antigravity `/swarm` | — |
| `dashboard/lib/bus/`, `mobile/src/bus/`, `mobile/src/haptics/` (the live wiring) | Claude Code, after the swarm lands | — |
| `contracts/events.ts`, `plan.md`, `AGENTS.md`, `DESIGN.md` | Humans decide; agents propose | Silent edits by any agent |

## Hard rules

- Every message between components uses the shapes in `contracts/events.ts`. Do not invent a new message shape. If one is missing, stop and report it.
- Secrets live only in `.env` (git-ignored). Never print, commit, or hard-code a key.
- Each agent writes only inside the folders it owns. Shared root files (`package.json` at root, lockfiles outside your app, `.gitignore`) have one owner per task.
- The demo must run after every merge. If your change breaks the run, fix or revert it before moving on.
- Speed over polish in the backend; polish over features in the UI.
- UI work follows `DESIGN.md`. Read it before writing a component.
