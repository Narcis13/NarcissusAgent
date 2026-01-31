# Requirements: Claude Code Orchestrator

**Defined:** 2026-01-31
**Core Value:** The autonomous loop must work reliably: task → detect completion → supervisor decides → inject next command → repeat until done.

## v1 Requirements

### PTY Management

- [ ] **PTY-01**: System can spawn Claude Code CLI in a pseudo-terminal
- [ ] **PTY-02**: System captures all output from Claude Code in real-time
- [ ] **PTY-03**: System can inject text input into the PTY
- [ ] **PTY-04**: System detects when Claude Code process exits and captures exit code
- [ ] **PTY-05**: System cleans up PTY resources on termination

### Output Analysis

- [ ] **OUT-01**: System strips ANSI escape codes for pattern matching while preserving them for display
- [ ] **OUT-02**: System detects task completion patterns (e.g., "I've finished", "What would you like to do next?")
- [ ] **OUT-03**: System detects error patterns (e.g., "Error:", "Failed to")
- [ ] **OUT-04**: System detects prompt-ready state (e.g., ">" at line start)
- [ ] **OUT-05**: System calculates confidence score for completion detection (threshold: 70+)

### AI Supervisor

- [ ] **SUP-01**: Supervisor calls Claude API with recent transcript to decide next action
- [ ] **SUP-02**: Supervisor returns structured decision: action, commands, reasoning, confidence
- [ ] **SUP-03**: Supervisor can decide: continue, new_task, clear, compact, abort, wait
- [ ] **SUP-04**: System enforces iteration budget (max steps before forced stop)
- [ ] **SUP-05**: Supervisor determines when work is complete and stops the loop

### Autonomous Loop

- [ ] **LOOP-01**: System accepts initial task via CLI argument (e.g., `cco "build a todo app"`)
- [ ] **LOOP-02**: System runs autonomous loop: spawn → monitor → detect → analyze → inject → repeat
- [ ] **LOOP-03**: System prevents feedback loops (cooldown between supervisor calls)
- [ ] **LOOP-04**: System stops when supervisor decides work is complete

### HTTP/WebSocket Server

- [ ] **SRV-01**: Server starts on configurable port (default: 3000, localhost only)
- [ ] **SRV-02**: Server provides WebSocket endpoint for real-time PTY output streaming
- [ ] **SRV-03**: Server provides REST endpoint to get current session status
- [ ] **SRV-04**: Server serves static files for web UI

### Web UI

- [ ] **UI-01**: Web UI renders terminal output using xterm.js with full ANSI color support
- [ ] **UI-02**: Web UI shows supervisor log (decisions, reasoning, confidence, timestamps)
- [ ] **UI-03**: Web UI shows connection status (connected/disconnected/reconnecting)
- [ ] **UI-04**: Web UI auto-scrolls to latest output

### Session Management

- [ ] **SES-01**: System tracks session state (idle, task_running, analyzing, injecting, error)
- [ ] **SES-02**: System stores basic session metadata (task description, start time, runtime)
- [ ] **SES-03**: System provides session info via REST API

## v2 Requirements

### Enhanced PTY
- **PTY-06**: Terminal resize support (SIGWINCH)
- **PTY-07**: Environment variable customization

### Enhanced Supervisor
- **SUP-06**: Error handling with exponential backoff and retry
- **SUP-07**: Circuit breaker pattern for API failures
- **SUP-08**: human_review decision type with notification

### Enhanced Web UI
- **UI-05**: Scrollback buffer with search
- **UI-06**: Manual command input for intervention
- **UI-07**: Quick action buttons (/clear, /compact, pause)
- **UI-08**: Theme support (dark/light)

### Enhanced Session
- **SES-04**: Session persistence to database
- **SES-05**: Session reconnection on browser refresh
- **SES-06**: Multiple session support

### Observability
- **OBS-01**: Structured JSON logging
- **OBS-02**: Token usage tracking
- **OBS-03**: Health check endpoints

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multiple simultaneous sessions | MVP is single session only |
| User authentication | Localhost only, no auth needed |
| Database persistence | In-memory only for MVP |
| Mobile-responsive UI | Desktop browser only |
| Session recording/playback | Nice-to-have, not core value |
| Multi-user collaboration | Single user tool |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PTY-01 | Pending | Pending |
| PTY-02 | Pending | Pending |
| PTY-03 | Pending | Pending |
| PTY-04 | Pending | Pending |
| PTY-05 | Pending | Pending |
| OUT-01 | Pending | Pending |
| OUT-02 | Pending | Pending |
| OUT-03 | Pending | Pending |
| OUT-04 | Pending | Pending |
| OUT-05 | Pending | Pending |
| SUP-01 | Pending | Pending |
| SUP-02 | Pending | Pending |
| SUP-03 | Pending | Pending |
| SUP-04 | Pending | Pending |
| SUP-05 | Pending | Pending |
| LOOP-01 | Pending | Pending |
| LOOP-02 | Pending | Pending |
| LOOP-03 | Pending | Pending |
| LOOP-04 | Pending | Pending |
| SRV-01 | Pending | Pending |
| SRV-02 | Pending | Pending |
| SRV-03 | Pending | Pending |
| SRV-04 | Pending | Pending |
| UI-01 | Pending | Pending |
| UI-02 | Pending | Pending |
| UI-03 | Pending | Pending |
| UI-04 | Pending | Pending |
| SES-01 | Pending | Pending |
| SES-02 | Pending | Pending |
| SES-03 | Pending | Pending |

**Coverage:**
- v1 requirements: 30 total
- Mapped to phases: 0
- Unmapped: 30 ⚠️

---
*Requirements defined: 2026-01-31*
*Last updated: 2026-01-31 after initial definition*
