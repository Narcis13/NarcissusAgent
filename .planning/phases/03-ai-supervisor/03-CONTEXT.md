# Phase 3: AI Supervisor - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Claude Code instance (headless, via `claude -p`) that supervises the inner Claude Code instance spawned by Bun. Supervisor receives transcript + metadata via HTTP, decides next action, returns command to inject. Communication happens over WebSocket/HTTP, not direct Claude API calls.

**Architecture shift:** Instead of calling Claude API directly, the supervisor IS another Claude Code instance running in non-interactive mode.

</domain>

<decisions>
## Implementation Decisions

### Supervisor Invocation
- Per-decision spawn: Bun runs `claude -p "..."` each time a decision is needed
- Not a long-running process — fresh spawn per decision
- Prompt includes: recent transcript + session metadata (task description, iteration count, elapsed time)

### Communication Layer
- Inner Claude → Supervisor: HTTP endpoint that Bun exposes
- Supervisor → Inner Claude: Response contains command to inject into PTY
- Supervisor sends exact text to inject (not abstract action types)

### Response Format
- Plain text with bracketed markers at start
- `[COMPLETE]` — work is done, stop the loop gracefully
- `[ABORT]` — something wrong, inject `/clear` and stop
- `[CONTINUE]` — followed by the command/prompt to inject
- Everything after the marker is the content (for CONTINUE, it's the command)

### Abort Behavior
- On `[ABORT]`: inject `/clear` into inner Claude, then stop loop
- Clean exit, not SIGTERM
- Log the abort reason (text after marker)

### Iteration Budget
- Default: 50 iterations max
- Supervisor sees iteration count in prompt: "Iteration 23/50"
- At budget limit: force stop with warning, inject `/clear`, exit
- No gradual warnings — hard stop at limit

### Claude's Discretion
- Exact prompt template structure
- How much transcript to include (last N lines)
- Error handling for supervisor spawn failures
- Timeout for supervisor response

</decisions>

<specifics>
## Specific Ideas

- "Truly amazing things will happen when a Claude Code instance spawned by Bun where the coding happens talks and is supervised from another Claude Code instance"
- The vision: Claude supervising Claude, with Bun orchestrating the conversation

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-ai-supervisor*
*Context gathered: 2026-02-04*
