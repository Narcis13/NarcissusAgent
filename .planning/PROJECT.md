# Claude Code Orchestrator (CCO)

## What This Is

A terminal orchestrator that runs Claude Code with an AI supervisor, enabling fully autonomous multi-task workflows. You give it a task via CLI, and the supervisor AI watches the output, detects when Claude Code completes work, decides what to do next, and injects the next command — all without human intervention.

## Core Value

The autonomous loop must work reliably: task → detect completion → supervisor decides → inject next command → repeat until supervisor determines work is done.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] PTY management that spawns and controls Claude Code process
- [ ] Pattern-based detection of task completion from terminal output
- [ ] Supervisor agent that uses Claude API to decide next action
- [ ] Command injection back into the PTY
- [ ] Autonomous loop that chains tasks until supervisor decides "done"
- [ ] Web UI showing terminal output stream via xterm.js
- [ ] Supervisor log visible in web UI (decisions, reasoning, confidence)
- [ ] CLI entry point that accepts initial task as argument
- [ ] WebSocket for real-time output streaming to browser

### Out of Scope

- Multiple simultaneous sessions — single session only for MVP
- User authentication — localhost only, no auth needed
- Persistent session history — no database, in-memory only
- Mobile-responsive UI — desktop browser only
- Manual command injection from web UI — full autopilot mode
- Task queue/list upfront — supervisor decides dynamically

## Context

The spec at `claude-orchestrator-spec.md` provides detailed architecture:
- PTY Manager handles pseudo-terminal interface
- Session Manager tracks state machine (idle → task_running → analyzing → injecting)
- Output Analyzer uses regex patterns to detect completion, errors, prompt ready
- Supervisor Agent calls Claude API with transcript to decide next action
- Hono.js server with WebSocket for web UI
- xterm.js for terminal rendering in browser

Key detection patterns for Claude Code:
- Completion: "I've finished/completed", "What would you like to do next?"
- Errors: "Error:", "Failed to", connection issues
- Active work: "Reading file", "Running", "Executing"
- Prompt ready: ">" at line start

Supervisor decisions: continue, new_task, clear, compact, abort, wait, human_review

## Constraints

- **Stack**: Bun.js with TypeScript as specified
- **PTY**: Use whatever works (bun-pty or node-pty)
- **Supervisor model**: Claude Sonnet 4.5 via Anthropic API
- **Web framework**: Hono.js as specified
- **Terminal UI**: xterm.js as specified
- **Scope**: MVP first, spec is reference for full feature set

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Full autopilot mode | User wants to watch, not intervene | — Pending |
| CLI-first for initial task | `cco "build X"` pattern for automation | — Pending |
| Supervisor decides completion | No predefined task list, AI determines when done | — Pending |
| MVP before spec | Build working autonomous loop first, then add features | — Pending |

---
*Last updated: 2026-01-31 after initialization*
