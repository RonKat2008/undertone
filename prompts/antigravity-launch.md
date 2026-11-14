# Launching the Antigravity swarm

The swarm builds only how the website and phone app look, in `dashboard/` and `mobile/`, on mock data.

## 1. Open the right folder

```bash
git clone https://github.com/RonKat2008/undertone.git
cd undertone
git checkout -b ui
```

Open **this `undertone` folder** as the workspace in Antigravity (it must be the repo root, so `AGENTS.md` is picked up). Do not open `dashboard/` or a parent folder.

## 2. Turn off the approval prompts (a setting, not a prompt)

Writing "skip permissions" in the prompt does nothing. Approvals are controlled by settings. Set these **before** typing `/swarm`:

**Antigravity App**

| Setting | Where | Value |
|---|---|---|
| Permission Preset | Settings → General → Global Permissions (or Settings → Projects for this project only) | **Auto** (recommended) or **Turbo** (no prompts at all) |
| Plan Review Policy | Settings → General → Agent Behavior | **Always Proceed** |
| Browser Actuation Rules | Settings → Browser → Edit → Execute URLs | add `localhost` (no port; covers every port) |

**Antigravity CLI**

```bash
agy --mode=auto                          # recommended: runs safe commands, pauses only on risky ones
agy --dangerously-skip-permissions       # no prompts at all; turns the sandbox off
```

**Auto or Turbo?** Auto keeps the sandbox, which blocks `.env` (our API keys) and `~/.ssh`, and still pauses on irreversible commands. Turbo and `--dangerously-skip-permissions` never pause, but the agents then run with full access to the laptop. If you choose Turbo, add these Deny rules first (Settings, or `/permissions` in the CLI); Deny rules still apply under Turbo:

```
command(rm -rf)
command(sudo)
command(git push)
read_file(.env)
```

Google's docs describe inheritance of these settings for subagents but do not state it for swarm workers. If workers still stop for approval: in the CLI, Alt+J jumps to the next waiting worker and Ctrl+K approves; in the App, approve from the Swarm pane's Members tab.

## 3. Check quota, then launch

- Run `/usage`. A swarm uses quota much faster than one conversation, and `/swarm` needs a Google AI Pro or Ultra plan.
- Pick the strongest model you have for the conversation (it becomes the coordinator).
- Copy the whole prompt and paste it as one message:

```bash
pbcopy < prompts/antigravity-swarm.md
```

## 4. While it runs

- Watch the board (`/swarm board` or Alt+S in the CLI; the Swarm pane in the App).
- The first thing posted should be the design research and a style tile. If it looks generic, say so on the board straight away; that is the cheapest moment to correct it.
- A worker that hits a quota error pauses and does not restart by itself. Message it after quota refreshes.
- When the final report arrives, check the screenshots, then push the `ui` branch and tell the team it is ready to wire up.
