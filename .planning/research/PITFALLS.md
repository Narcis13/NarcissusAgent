# Pitfalls Research: Terminal Orchestrator

**Researched:** 2026-01-31
**Domain:** Terminal orchestration with Bun.js (Claude Code Orchestrator)

## Critical Pitfalls

### 1. Feedback Loop / Infinite Recursion

**What goes wrong:**
The supervisor injects commands into the terminal, which produce output that matches detection patterns, triggering another supervisor action, creating an infinite loop. This can manifest as:
- Supervisor sends a command, Claude Code responds, supervisor interprets response as needing another command
- Pattern matching on "waiting for input" triggers command injection, which produces more "waiting" states
- API calls beget more API calls until rate limits hit or costs spiral

**Warning signs:**
- Rapid succession of identical or similar commands
- Terminal output growing exponentially
- API costs spiking unexpectedly
- CPU/memory usage climbing without user interaction
- Log files showing repetitive patterns

**Prevention:**
- Implement a cooldown period between supervisor actions (minimum 2-5 seconds)
- Track recent actions in a sliding window; refuse duplicate actions within N seconds
- Add recursion depth counter that resets on genuine user input
- Implement circuit breaker pattern: after N consecutive automated actions, require human confirmation
- Tag injected commands distinctly so pattern matching can exclude them from triggering responses
- Use a state machine with explicit "supervisor acting" vs "waiting for genuine output" states

**Address in phase:** Core architecture (Phase 1). This must be baked into the fundamental design, not bolted on later.

---

### 2. PTY Process Lifecycle Mismanagement

**What goes wrong:**
- Zombie processes when PTY child exits but parent doesn't clean up
- Orphaned PTY masters when supervisor crashes
- Race conditions during startup (reading before shell ready)
- Improper signal forwarding (SIGINT, SIGTERM, SIGWINCH)
- File descriptor leaks from unclosed PTY master/slave pairs

**Warning signs:**
- `ps aux | grep defunct` shows zombie processes
- `/dev/pts` entries accumulating
- "Input/output error" on PTY operations
- CTRL+C not working in spawned terminal
- Window resize events not propagating

**Prevention:**
- Always handle SIGCHLD to reap child processes
- Use try/finally or Bun's built-in cleanup mechanisms for PTY cleanup
- Implement proper signal forwarding chain: supervisor -> PTY master -> shell -> child processes
- Wait for shell prompt before sending initial commands
- Track PTY master fd and ensure closure in all exit paths (normal, error, crash)
- Consider using a process manager or supervision tree pattern

**Address in phase:** Phase 1 (PTY foundation). Get this right before building anything on top.

---

### 3. ANSI Escape Sequence State Corruption

**What goes wrong:**
- Partial escape sequences when buffer splits mid-sequence
- Pattern matching against raw ANSI codes instead of rendered text
- State machine for ANSI parsing gets out of sync
- Cursor position tracking breaks, corrupting "screen" understanding
- OSC (Operating System Command) sequences can span multiple reads
- 256-color and true-color sequences have variable length

**Warning signs:**
- Garbled output in xterm.js
- Pattern matches that should succeed are failing
- "Invisible" text (text with same foreground/background)
- Cursor jumping unexpectedly in rendered output
- Partial sequences appearing in logs like `\x1b[` without completion

**Prevention:**
- Buffer incomplete escape sequences until complete (detect by parsing)
- Strip ANSI codes BEFORE pattern matching (use proven library like `strip-ansi`)
- Use a streaming ANSI parser that handles partial sequences (e.g., `ansi-parser` or custom FSM)
- Maintain ring buffer large enough to hold longest possible escape sequence (~20 bytes typical, up to 256 for complex OSC)
- Test with programs that use heavy ANSI: vim, htop, tmux
- Consider dual-track: raw bytes for xterm.js, stripped text for pattern matching

**Address in phase:** Phase 2 (Output processing). But design for it in Phase 1.

---

### 4. WebSocket Connection Lifecycle Issues

**What goes wrong:**
- Lost output during reconnection (data sent while client disconnected)
- Memory leak from buffering for disconnected clients indefinitely
- Backpressure ignored: slow client causes server memory to balloon
- No heartbeat: stale connections not detected
- Race condition: client connects, server sends history, client misses real-time update during history send

**Warning signs:**
- Memory growth correlated with client disconnects
- Output gaps after network blips
- Server becoming unresponsive under load
- Connections timing out on client but server thinks they're active

**Prevention:**
- Implement proper reconnection protocol with sequence numbers
- Store output in ring buffer (bounded memory); client requests from sequence number on reconnect
- Implement WebSocket ping/pong heartbeats (30 second interval typical)
- Monitor client buffer size; if backlogged, drop connection or skip updates
- Handle 'drain' event before sending more data
- Use connection state machine: CONNECTING -> READY -> DISCONNECTED with clear transitions
- Send full terminal state snapshot on reconnect, not just missed data

**Address in phase:** Phase 3 (Web UI). But design buffer architecture in Phase 2.

---

### 5. Claude API Error Handling Gaps

**What goes wrong:**
- 429 (rate limit) causes cascade failure instead of graceful degradation
- Timeout on long-running API calls leaves system in undefined state
- Partial response handling (stream interruption)
- Overload errors (529) treated same as rate limits
- API key rotation during operation
- Cost runaway from retry storms

**Warning signs:**
- API errors appearing in logs without retry
- System becoming unresponsive during API issues
- Inconsistent state after API timeout
- Billing alerts
- Retries happening immediately without backoff

**Prevention:**
- Implement exponential backoff with jitter for all retries
- Different strategies for different errors: 429=backoff, 529=wait longer, 5xx=retry, 4xx=don't retry
- Set reasonable timeouts (30-60s for most calls)
- For streaming responses: track partial state, handle interruption gracefully
- Implement circuit breaker: after N failures in window, fail fast for cooling period
- Set hard budget limits in code, not just Anthropic dashboard
- Log all API calls with latency and cost estimation

**Address in phase:** Phase 2 (Claude integration). Must be robust from day one.

---

## Medium-Risk Pitfalls

### 1. Pattern Matching False Positives

**What goes wrong:**
- User output containing strings like "Waiting for input" triggers supervisor
- Code snippets in Claude's response match action patterns
- Multiline patterns broken by screen wrapping
- Unicode normalization differences cause match failures

**Warning signs:**
- Supervisor acting when it shouldn't
- Patterns working in tests but failing in production
- Actions triggered by documentation Claude prints

**Prevention:**
- Use multi-factor detection: pattern + timing + context
- Require patterns at specific screen positions (e.g., bottom line only)
- Add negative patterns (must NOT contain X to match)
- Test patterns against corpus of real terminal sessions
- Consider semantic detection (Claude API) for ambiguous cases
- Escape special characters when building patterns from config

**Address in phase:** Phase 2, iteratively refined in Phase 4.

---

### 2. xterm.js State Synchronization

**What goes wrong:**
- Terminal dimensions out of sync (server thinks 80x24, client is 120x40)
- Alternate screen buffer handling (vim opens/closes)
- Scrollback buffer divergence between server and client
- Multiple tabs/windows seeing different states

**Warning signs:**
- Text wrapping incorrectly
- Line breaks in wrong places
- Vim/less output corrupted
- "Screen tearing" appearance

**Prevention:**
- Server should be authoritative on dimensions; propagate resize events server->client->PTY
- Track alternate screen buffer state; clear appropriately on exit
- Use xterm.js `serialize` addon for state snapshots
- Hash scrollback periodically; resync if diverged
- Limit scrollback to prevent memory issues (10k lines typical)

**Address in phase:** Phase 3, with dimension handling in Phase 1.

---

### 3. Command Injection Timing

**What goes wrong:**
- Command injected before previous command finished
- Commands sent during output flood get lost
- Shell prompt detection fails with custom prompts
- Injected command interleaved with output

**Warning signs:**
- Commands appearing in middle of output
- Commands being interpreted as input to running programs
- Shell prompts varying and breaking detection

**Prevention:**
- Detect shell prompt reliably (configure expected prompt pattern or use shell integration)
- Wait for prompt before injecting
- Use unique markers: `echo __MARKER_START__; command; echo __MARKER_END__`
- Implement command queue with state: PENDING, SENT, EXECUTING, COMPLETED
- Add timeout for command completion; escalate if stuck

**Address in phase:** Phase 2 (command injection protocol).

---

### 4. Bun-Specific PTY Quirks

**What goes wrong:**
- Bun's `Bun.spawn` doesn't support PTY natively
- Using `node-pty` with Bun may have native module issues
- Bun's async I/O semantics differ from Node
- Bundle issues with native addons

**Warning signs:**
- "Cannot find module" for native modules
- Segfaults or crashes in PTY operations
- Different behavior in dev vs production
- `bun build` failing on native deps

**Prevention:**
- Test PTY library explicitly with Bun before committing
- Consider pure-JS PTY solution or FFI approach
- Pin versions of all native modules
- Test bundled output, not just dev server
- Have fallback plan (run PTY subprocess separately)

**Address in phase:** Phase 0 (technology validation).

---

### 5. State Machine Completeness

**What goes wrong:**
- Undefined state transitions (event X in state Y not handled)
- State corruption from concurrent events
- Recovery from error states not implemented
- Implicit state distributed across variables

**Warning signs:**
- "Impossible" states occurring
- System getting stuck
- Debugging requiring reconstruction of what state should be

**Prevention:**
- Use explicit state machine library (xstate or similar)
- Define ALL states and ALL transitions upfront
- Every state must handle every possible event (even if "ignore")
- Add timeout transitions from every state
- Log state transitions for debugging
- Implement state persistence for recovery

**Address in phase:** Phase 1 architecture, refined throughout.

---

## Low-Risk (But Worth Knowing)

### 1. Terminal Encoding Edge Cases

**What goes wrong:**
- UTF-8 multi-byte characters split across buffers
- Emoji rendering width (some are 2 columns)
- Right-to-left text confusion
- Non-UTF8 output from certain commands

**Warning signs:**
- Garbled characters intermittently
- Cursor position off by one
- Wide characters causing column misalignment

**Prevention:**
- Use TextDecoder with `stream: true` option
- Track pending incomplete UTF-8 sequences
- Use Unicode-aware string width library for cursor math
- Assume UTF-8 but handle decoding errors gracefully

**Address in phase:** Phase 3 polish.

---

### 2. Log Volume Management

**What goes wrong:**
- Debug logging in production creates multi-GB logs
- Sensitive data (API keys, user input) in logs
- Log aggregation service costs spike

**Warning signs:**
- Disk space alerts
- Log search becoming slow
- Log ingestion bills

**Prevention:**
- Structured logging with levels from day one
- Log sampling for high-frequency events
- Redaction middleware for sensitive patterns
- Log rotation configuration

**Address in phase:** Phase 1, refined in Phase 4.

---

### 3. Browser Tab Resource Exhaustion

**What goes wrong:**
- xterm.js memory grows unbounded with scrollback
- Multiple terminal instances leak memory
- Animation frames continue when tab backgrounded

**Warning signs:**
- Browser tab using 500MB+
- Fan spinning from hidden tabs
- Browser becoming unresponsive

**Prevention:**
- Limit scrollback lines (5000-10000)
- Dispose terminals properly when switching
- Use `Page Visibility API` to reduce work when hidden
- Profile memory periodically during development

**Address in phase:** Phase 3.

---

### 4. Shell-Specific Behavior

**What goes wrong:**
- Prompt detection assumes bash but user has zsh/fish
- Job control differences between shells
- History file locking issues
- Different escaping rules

**Warning signs:**
- Works on dev machine, fails on others
- Prompt detection intermittent

**Prevention:**
- Test with bash, zsh, and fish at minimum
- Make shell integration configurable
- Document supported shells
- Use POSIX-compatible commands where possible

**Address in phase:** Phase 4 (hardening).

---

### 5. Development vs Production Divergence

**What goes wrong:**
- Works perfectly locally, fails in Docker
- Signal handling differs
- File paths hardcoded
- Environment variable assumptions

**Warning signs:**
- "Works on my machine"
- Flaky CI tests

**Prevention:**
- Docker-first development
- CI runs full test suite in production-like environment
- Inject all config via environment variables
- No hardcoded paths

**Address in phase:** Phase 0 (project setup).

---

## Testing Recommendations

### Unit Testing
- Test ANSI parser with corpus of real escape sequences (capture from vim, htop, etc.)
- Test state machine transitions exhaustively (property-based testing ideal)
- Test pattern matching against both positive and negative examples
- Test UTF-8 buffer handling with split multi-byte characters

### Integration Testing
- Spawn real Claude Code CLI, inject known commands, verify output capture
- Simulate WebSocket disconnects during active output
- Force API errors (mock) and verify degradation behavior
- Test with various terminal sizes including edge cases (1x1, 400x100)

### Load Testing
- Many concurrent WebSocket clients
- Rapid command injection (ensure rate limiting works)
- Large output volumes (megabytes of output)
- Long-running sessions (memory leaks)

### Chaos Testing
- Kill PTY process unexpectedly
- Kill server process, restart, verify client recovery
- Introduce network latency and packet loss
- Corrupt WebSocket frames

### Real-World Testing
- Run actual Claude Code sessions end-to-end
- Test with users who have non-standard shells/terminals
- Deploy canary to small percentage of traffic
- Monitor metrics for anomalies before full rollout

### Recommended Test Matrix

| Component | Unit | Integration | Load | Chaos |
|-----------|------|-------------|------|-------|
| PTY Handler | Y | Y | N | Y |
| ANSI Parser | Y | Y | Y | N |
| Pattern Matcher | Y | Y | N | N |
| State Machine | Y | Y | Y | Y |
| WebSocket Server | Y | Y | Y | Y |
| Claude API Client | Y | Y | Y | Y |
| xterm.js Frontend | Y | Y | Y | N |

### Metrics to Monitor
- PTY process count (should be stable)
- WebSocket connection count
- API latency p50/p95/p99
- API error rate
- Memory usage over time
- Output buffer sizes
- Commands injected per minute (detect feedback loops)
- State machine transition frequency

---

## Implementation Checklist

### Phase 0 (Pre-Development)
- [ ] Verify Bun + PTY solution works
- [ ] Set up Docker development environment
- [ ] Establish logging/monitoring infrastructure

### Phase 1 (Core)
- [ ] Implement feedback loop prevention at architecture level
- [ ] Proper PTY lifecycle management
- [ ] Explicit state machine with all transitions
- [ ] Basic dimension handling

### Phase 2 (Integration)
- [ ] ANSI parser with partial sequence handling
- [ ] Robust Claude API client with all error handling
- [ ] Command injection protocol with prompt detection
- [ ] Pattern matching with false positive mitigation

### Phase 3 (Web UI)
- [ ] WebSocket reconnection protocol
- [ ] xterm.js state synchronization
- [ ] Backpressure handling
- [ ] Scrollback limits

### Phase 4 (Hardening)
- [ ] Multi-shell testing
- [ ] Load testing
- [ ] Chaos testing
- [ ] Production monitoring setup
