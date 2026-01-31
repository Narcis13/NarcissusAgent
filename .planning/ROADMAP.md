# Roadmap: Claude Code Orchestrator

**Created:** 2026-01-31
**Depth:** Quick (3-5 phases)
**Total Requirements:** 30

## Phase Overview

| Phase | Name | Requirements | Success Criteria |
|-------|------|--------------|------------------|
| 1 | Core Foundation | 9 | 4 |
| 2 | Output Analysis & Loop | 9 | 4 |
| 3 | AI Supervisor | 5 | 4 |
| 4 | Web Interface | 7 | 5 |

## Phase 1: Core Foundation

**Goal:** Spawn and control Claude Code in a PTY with proper lifecycle management and session state tracking.

**Dependencies:** None (foundation)

**Requirements:**
- PTY-01: System can spawn Claude Code CLI in a pseudo-terminal
- PTY-02: System captures all output from Claude Code in real-time
- PTY-03: System can inject text input into the PTY
- PTY-04: System detects when Claude Code process exits and captures exit code
- PTY-05: System cleans up PTY resources on termination
- SES-01: System tracks session state (idle, task_running, analyzing, injecting, error)
- SES-02: System stores basic session metadata (task description, start time, runtime)
- SES-03: System provides session info via REST API
- LOOP-01: System accepts initial task via CLI argument

**Success Criteria:**
1. User can run `cco "task description"` and Claude Code spawns in a managed PTY
2. User can see raw terminal output streaming to stdout in real-time
3. System correctly transitions between session states (idle -> task_running -> etc.)
4. When Claude Code exits, system cleans up PTY and reports exit code

## Phase 2: Output Analysis & Autonomous Loop

**Goal:** Detect task completion patterns and run autonomous loop that chains commands.

**Dependencies:** Phase 1 (PTY and session management)

**Requirements:**
- OUT-01: System strips ANSI escape codes for pattern matching while preserving them for display
- OUT-02: System detects task completion patterns
- OUT-03: System detects error patterns
- OUT-04: System detects prompt-ready state
- OUT-05: System calculates confidence score for completion detection
- LOOP-02: System runs autonomous loop (spawn -> monitor -> detect -> analyze -> inject -> repeat)
- LOOP-03: System prevents feedback loops (cooldown between supervisor calls)
- LOOP-04: System stops when supervisor decides work is complete

**Success Criteria:**
1. System detects when Claude Code completes a task with 70%+ confidence
2. System distinguishes between completion, error, and still-working states
3. Cooldown mechanism prevents rapid-fire supervisor calls (2-5 second minimum)
4. Loop terminates gracefully when work is complete or on error

## Phase 3: AI Supervisor

**Goal:** Claude API integration that decides next action based on terminal transcript.

**Dependencies:** Phase 2 (detection events trigger supervisor)

**Requirements:**
- SUP-01: Supervisor calls Claude API with recent transcript to decide next action
- SUP-02: Supervisor returns structured decision (action, commands, reasoning, confidence)
- SUP-03: Supervisor can decide: continue, new_task, clear, compact, abort, wait
- SUP-04: System enforces iteration budget (max steps before forced stop)
- SUP-05: Supervisor determines when work is complete and stops the loop

**Success Criteria:**
1. Supervisor receives transcript and returns valid JSON decision with action type
2. Each decision type (continue, new_task, abort, etc.) triggers correct system behavior
3. System stops after hitting iteration budget (e.g., 50 steps)
4. User can observe supervisor reasoning in logs

## Phase 4: Web Interface

**Goal:** Real-time web UI showing terminal output and supervisor decisions.

**Dependencies:** Phase 3 (all components functional for full visibility)

**Requirements:**
- SRV-01: Server starts on configurable port (default: 3000, localhost only)
- SRV-02: Server provides WebSocket endpoint for real-time PTY output streaming
- SRV-03: Server provides REST endpoint to get current session status
- SRV-04: Server serves static files for web UI
- UI-01: Web UI renders terminal output using xterm.js with full ANSI color support
- UI-02: Web UI shows supervisor log (decisions, reasoning, confidence, timestamps)
- UI-03: Web UI shows connection status (connected/disconnected/reconnecting)
- UI-04: Web UI auto-scrolls to latest output

**Success Criteria:**
1. User opens browser to localhost:3000 and sees terminal output with colors preserved
2. Supervisor decisions appear in side panel with timestamps and reasoning
3. WebSocket reconnects automatically if connection drops
4. Terminal auto-scrolls as new output arrives
5. User can view session status (current state, runtime, task description)

## Progress

| Phase | Status | Progress |
|-------|--------|----------|
| 1 - Core Foundation | Pending | 0% |
| 2 - Output Analysis & Loop | Pending | 0% |
| 3 - AI Supervisor | Pending | 0% |
| 4 - Web Interface | Pending | 0% |

## Requirement Coverage

| Category | Requirements | Phase |
|----------|--------------|-------|
| PTY Management | PTY-01, PTY-02, PTY-03, PTY-04, PTY-05 | 1 |
| Session Management | SES-01, SES-02, SES-03 | 1 |
| Output Analysis | OUT-01, OUT-02, OUT-03, OUT-04, OUT-05 | 2 |
| Autonomous Loop | LOOP-01 | 1 |
| Autonomous Loop | LOOP-02, LOOP-03, LOOP-04 | 2 |
| AI Supervisor | SUP-01, SUP-02, SUP-03, SUP-04, SUP-05 | 3 |
| HTTP/WebSocket Server | SRV-01, SRV-02, SRV-03, SRV-04 | 4 |
| Web UI | UI-01, UI-02, UI-03, UI-04 | 4 |

**Coverage:** 30/30 requirements mapped

---
*Created: 2026-01-31*
*Last updated: 2026-01-31*
