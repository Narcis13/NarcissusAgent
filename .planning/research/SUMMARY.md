# Project Research Summary

**Project:** Claude Code Orchestrator
**Domain:** Terminal orchestration with AI supervision
**Researched:** 2026-01-31
**Confidence:** HIGH

## Executive Summary

This project is a terminal orchestration system that wraps Claude Code CLI with autonomous AI supervision capabilities. The architecture follows event-driven patterns common in terminal multiplexers (tmux/screen) combined with AI agent orchestration patterns (LangGraph, AutoGPT). The recommended approach leverages Bun.js's native `Bun.Terminal` API (v1.3.5+) for PTY management, Hono for HTTP/WebSocket serving, and xterm.js for browser-based terminal rendering. The system acts as an intelligent middleware layer that spawns Claude Code in a PTY, analyzes its output via pattern matching, consults an AI supervisor (Claude API) to make decisions, and injects commands back into the terminal autonomously.

The critical architectural challenge is preventing feedback loops where the supervisor's injected commands trigger further supervisor actions, creating infinite recursion. This must be addressed through explicit state machines, cooldown periods, action deduplication, and circuit breaker patterns baked into the foundation. Other key risks include PTY process lifecycle mismanagement (zombie processes, signal forwarding), ANSI escape sequence handling (partial sequences corrupting pattern matching), and WebSocket connection resilience (reconnection with state sync). These are all well-documented problems with established solutions from terminal emulator and web socket domains.

Confidence is HIGH because all core technologies (Bun.Terminal, Hono, xterm.js, Anthropic SDK) have official documentation and proven usage patterns. The integration challenges are known from similar projects (GitHub Copilot CLI, Warp terminal, VSCode terminal). The main unknowns are specific to pattern matching Claude Code's output format, which will require iterative tuning but follows established ANSI parsing approaches.

## Key Findings

### Recommended Stack

The stack is optimized for Bun.js runtime (v1.3.5+), which provides native PTY support eliminating the need for node-pty. This is significant because node-pty has known incompatibilities with Bun and requires native module compilation. Using Bun's built-in APIs provides first-class TypeScript support, zero dependencies, and performance advantages.

**Core technologies:**
- **Bun.Terminal (built-in)**: PTY management — native API introduced in Bun v1.3.5 with zero dependencies, eliminates node-pty compatibility issues
- **Hono (4.11.7)**: HTTP/WebSocket server — ultrafast (14KB), first-class Bun support, native WebSocket helpers for pub/sub patterns
- **@anthropic-ai/sdk (0.72.1)**: Claude API client — official SDK with streaming support, TypeScript definitions, Bun 1.0+ compatible
- **@xterm/xterm (6.0.0)**: Web terminal emulator — industry standard (used by VS Code, Hyper), full ANSI/Unicode support, WebSocket integration
- **strip-ansi (7.1.2)**: ANSI code processing — de-facto standard (250M+ weekly downloads) for stripping escape sequences before pattern matching

**What NOT to use:**
- node-pty (incompatible with Bun)
- ws package (Bun has native WebSocket)
- Express.js (Hono is faster and better optimized for Bun)
- dotenv (Bun auto-loads .env files)

### Expected Features

The research identified a clear dependency chain: PTY management is foundational, session management orchestrates state, AI supervision adds intelligence, and web UI provides visibility. MVP scope is well-defined with clear table stakes vs. differentiators.

**Must have (table stakes):**
- PTY spawning and lifecycle management — handle master/slave pseudo-terminal pairs correctly
- Input/output streaming — capture stdout/stderr in real-time, pass stdin to process
- Real-time terminal rendering — WebSocket streaming to xterm.js with full ANSI support
- Autonomous execution loop — multi-agent pattern with termination conditions
- Step/iteration budgets — hard limit on iterations to prevent infinite loops
- Output parsing/analysis — extract structured information from terminal output
- State machine for supervisor states — IDLE, RUNNING, ANALYZING, ERROR with clear transitions

**Should have (competitive):**
- ANSI escape code parsing — enables headless state tracking without rendering
- Output buffering with configurable history — memory-efficient ring buffer for pattern matching
- Circuit breaker pattern — prevent cascading failures when LLM provider is down
- Fallback model support — route to backup LLM when primary fails
- Tool/action validation — sandbox dangerous operations with allowlist/blocklist
- Split view (terminal + supervisor log) — side-by-side or tabbed layout
- Search in scrollback — highlight matches with regex support

**Defer (v2+):**
- Session persistence across restarts — serialize terminal state and reconnect to running processes
- Multi-session management with Redis — track multiple PTY sessions, horizontal scaling
- Maker-checker pattern — one agent proposes, another validates
- Goal decomposition — break complex tasks into subtasks with progress tracking
- Session recording/playback — record sessions with timing, playback with speed control
- Session branching/forking — create checkpoints and explore alternative paths

### Architecture Approach

The architecture follows event-driven pub/sub patterns with a central EventBus mediating between components. This decouples PTY management, session state tracking, output analysis, supervisor decisions, and WebSocket broadcasting. The recommended build order starts with zero-dependency foundation components (EventBus, RingBuffer), then adds I/O layer (PTYManager), state management (SessionManager), analysis (OutputAnalyzer), AI integration (SupervisorAgent), and finally HTTP/WebSocket serving.

**Major components:**
1. **PTYManager** — Wraps Bun.Terminal API for spawning/writing/resizing PTY processes, emits data/exit/error events
2. **SessionManager** — Finite state machine coordinating PTY, Analyzer, and Supervisor; manages output buffers (ring buffer + full transcript); tracks task history
3. **OutputAnalyzer** — Subscribes to PTY data events, maintains sliding window buffer, strips ANSI codes, applies three-tier pattern matching (explicit/contextual/structural), calculates confidence scores
4. **SupervisorAgent** — Receives detection events, constructs prompts with context, calls Claude API (streaming), parses JSON decisions, validates/sanitizes commands, emits decision events
5. **WebSocketHub** — Topic-based pub/sub (terminal, supervisor-log, session-status) using Bun's native `ws.raw.subscribe()` and `server.publish()` for efficient multicasting
6. **Web UI (xterm.js)** — Browser-based terminal with AttachAddon for WebSocket, FitAddon for auto-resize, separate panels for status and supervisor logs

**Key patterns:**
- Facade pattern for PTYManager (simplifies Bun.Terminal API)
- State Machine pattern for SessionManager (explicit transitions with guards)
- Pipeline with Observer for OutputAnalyzer (receive -> buffer -> strip -> match -> score -> emit)
- Agent with Strategy for SupervisorAgent (decision logic swappable)
- Publisher-Subscriber for WebSocket (topic-based multicasting)

### Critical Pitfalls

The research identified five critical pitfalls that must be addressed in foundational architecture, not bolted on later. Feedback loops and PTY lifecycle issues can break the entire system if not designed correctly from day one.

1. **Feedback Loop / Infinite Recursion** — Supervisor injects commands that produce output matching detection patterns, triggering another supervisor action. Prevention: cooldown period (2-5s), action deduplication in sliding window, recursion depth counter, circuit breaker after N consecutive actions, tag injected commands to exclude from pattern matching, explicit state machine with "supervisor acting" state. **Address in Phase 1 (Core Foundation).**

2. **PTY Process Lifecycle Mismanagement** — Zombie processes when child exits, orphaned PTY masters on crash, race conditions during startup, improper signal forwarding (SIGINT/SIGTERM/SIGWINCH). Prevention: handle SIGCHLD to reap children, try/finally for PTY cleanup, signal forwarding chain (supervisor -> PTY master -> shell -> child), wait for shell prompt before commands, track PTY master fd for cleanup in all exit paths. **Address in Phase 1 (Core Foundation).**

3. **ANSI Escape Sequence State Corruption** — Partial sequences when buffer splits mid-sequence, pattern matching against raw ANSI instead of stripped text, OSC sequences spanning multiple reads. Prevention: buffer incomplete sequences until complete, strip ANSI BEFORE pattern matching using strip-ansi, use streaming ANSI parser for partial sequences, ring buffer large enough for longest sequence (~256 bytes for OSC), test with vim/htop/tmux, dual-track approach (raw for xterm.js, stripped for analysis). **Address in Phase 2 (Output Processing).**

4. **WebSocket Connection Lifecycle Issues** — Lost output during reconnection, memory leak from buffering for disconnected clients, backpressure ignored (slow client causes server memory balloon), no heartbeat detection. Prevention: reconnection protocol with sequence numbers, store output in bounded ring buffer (client requests from sequence number), WebSocket ping/pong heartbeats (30s interval), monitor client buffer size and drop connection if backlogged, connection state machine (CONNECTING -> READY -> DISCONNECTED), send full terminal state snapshot on reconnect. **Address in Phase 3 (Web UI).**

5. **Claude API Error Handling Gaps** — 429 rate limits cause cascade failure, timeout leaves system in undefined state, partial response handling from stream interruption, cost runaway from retry storms. Prevention: exponential backoff with jitter, different strategies per error type (429=backoff, 529=wait longer, 5xx=retry, 4xx=don't retry), reasonable timeouts (30-60s), track partial state for streaming interruptions, circuit breaker (after N failures fail fast during cooling period), hard budget limits in code, log all API calls with latency and cost. **Address in Phase 2 (Claude Integration).**

## Implications for Roadmap

Based on the dependency analysis and pitfall research, the recommended phase structure prioritizes foundation components (zero dependencies), then I/O layer, then state management, then analysis, then AI integration, and finally HTTP serving. This order minimizes rework and ensures critical patterns (feedback loop prevention, PTY lifecycle) are baked in from the start.

### Phase 1: Core Foundation
**Rationale:** Zero-dependency components are prerequisites for everything else. EventBus is used by all components for decoupled communication. RingBuffer is needed by SessionManager and OutputAnalyzer. State machine design must be explicit from the start to handle all transitions (avoiding undefined states). PTY lifecycle management is critical architecture that can't be retrofitted.

**Delivers:** EventBus, RingBuffer, shared Types, PTYManager with proper lifecycle handling, dimension tracking

**Addresses:**
- PTY spawning/management (table stakes)
- Terminal resize support (table stakes)
- Environment variable handling (table stakes)

**Avoids:**
- Feedback loop / infinite recursion (critical pitfall #1) — build architecture to prevent
- PTY process lifecycle mismanagement (critical pitfall #2) — proper signal forwarding, cleanup, SIGCHLD handling

**Research needed:** No, well-documented patterns (Bun.Terminal API docs, PTY management is standard Unix programming)

### Phase 2: State Management & Output Analysis
**Rationale:** SessionManager orchestrates all components and maintains the state machine. OutputAnalyzer consumes PTY events and triggers supervisor actions. Both depend on EventBus and RingBuffer from Phase 1. ANSI handling must be robust before pattern matching can work reliably. This phase establishes the detection->analysis loop that drives autonomous behavior.

**Delivers:** SessionManager with state machine, OutputAnalyzer with three-tier pattern matching, ANSI utilities (strip-ansi wrapper), confidence scoring, buffer management (ring buffer + full transcript)

**Addresses:**
- State machine for supervisor states (table stakes)
- Output parsing/analysis (table stakes)
- Output buffering with history (differentiator)

**Avoids:**
- ANSI escape sequence state corruption (critical pitfall #3) — buffer partials, strip before matching
- Pattern matching false positives (medium pitfall) — multi-factor detection

**Uses:** EventBus, RingBuffer, strip-ansi

**Research needed:** Possibly for pattern tuning — Claude Code output format may need iteration, but ANSI parsing is standard

### Phase 3: AI Supervisor Integration
**Rationale:** Supervisor depends on SessionManager for context and OutputAnalyzer for detection events. This phase brings autonomous decision-making online. Must handle all Claude API error cases from day one (rate limits, timeouts, streaming interruptions) to avoid cascade failures.

**Delivers:** SupervisorAgent with Claude API integration (streaming), decision parsing (JSON), command validation/sanitization, retry logic with exponential backoff, circuit breaker pattern, budget tracking

**Addresses:**
- Autonomous execution loop (table stakes)
- Step/iteration budgets (table stakes)
- Error handling with retries (table stakes)
- Circuit breaker pattern (differentiator)
- Tool/action validation (differentiator)

**Avoids:**
- Claude API error handling gaps (critical pitfall #5) — backoff, circuit breaker, budget limits
- Command injection timing (medium pitfall) — detect shell prompt, use markers

**Uses:** @anthropic-ai/sdk, EventBus, Types

**Research needed:** No for API integration (official SDK docs), possibly for prompt engineering if decision quality is low

### Phase 4: HTTP/WebSocket Server
**Rationale:** Web interface depends on all core components being functional. WebSocket streaming is the final integration point that exposes real-time events to clients. This phase makes the system usable via browser.

**Delivers:** Hono HTTP server with REST routes, WebSocket endpoint with topic-based pub/sub, static file serving, WebSocketHub for broadcasting, connection lifecycle management (heartbeat, reconnection)

**Addresses:**
- Real-time terminal rendering (table stakes)
- Connection status indicator (table stakes)
- Scrollback buffer (table stakes)
- Copy/paste support (table stakes)
- Responsive/resizable terminal (table stakes)

**Avoids:**
- WebSocket connection lifecycle issues (critical pitfall #4) — reconnection protocol, sequence numbers, heartbeats, backpressure

**Uses:** Hono, Bun native WebSocket, EventBus

**Research needed:** No, standard WebSocket patterns with Hono documentation

### Phase 5: Web UI (xterm.js)
**Rationale:** Separate from HTTP server to allow parallel development if needed. xterm.js integration is well-documented but has nuances (dimension sync, scrollback limits, addon configuration).

**Delivers:** xterm.js terminal component, AttachAddon for WebSocket, FitAddon for auto-resize, status panel, supervisor log panel, split view layout

**Addresses:**
- Real-time terminal rendering (table stakes)
- Scrollback buffer (table stakes)
- Copy/paste support (table stakes)
- Responsive/resizable terminal (table stakes)
- Split view (differentiator)
- Output highlighting/annotation (differentiator)
- Theming support (differentiator)

**Avoids:**
- xterm.js state synchronization (medium pitfall) — server authoritative on dimensions
- Browser tab resource exhaustion (low pitfall) — scrollback limits (5k-10k lines)

**Uses:** @xterm/xterm, @xterm/addon-attach, @xterm/addon-fit

**Research needed:** No, xterm.js documentation is comprehensive

### Phase 6: Advanced Features (Polish)
**Rationale:** After MVP is functional, add differentiators that improve UX but aren't critical for core loop. These can be developed iteratively based on user feedback.

**Delivers:** Search in scrollback, multiple terminal tabs, session templates, token usage tracking, real-time metrics dashboard, alerting

**Addresses:**
- Search in scrollback (differentiator)
- Multiple terminal tabs (differentiator)
- Session templates (differentiator)
- Token usage tracking (differentiator)
- Real-time metrics dashboard (differentiator)

**Uses:** Existing components, add features incrementally

**Research needed:** Possibly for observability integration if using OpenTelemetry (standard patterns exist)

### Phase Ordering Rationale

- **Dependencies drive order:** EventBus and RingBuffer are used by all components, so they must come first. PTYManager is needed by SessionManager. SessionManager and OutputAnalyzer feed SupervisorAgent. All of these are needed for the WebSocket server to have something to broadcast.
- **Risk mitigation:** Critical pitfalls (feedback loops, PTY lifecycle) are addressed in the earliest phases where they belong architecturally. ANSI handling and API error handling are built robustly before relying on them.
- **Testability:** Each phase delivers independently testable components. PTYManager can be tested with simple shell commands. SessionManager can be tested with mocked PTY events. OutputAnalyzer can be tested with captured terminal output samples. SupervisorAgent can be tested with mocked detection events.
- **Incremental value:** Phase 1-2 delivers a functional terminal wrapper with state tracking. Phase 3 adds AI supervision. Phase 4-5 add web UI. Phase 6 adds polish. Each phase is a checkpoint that could be demoed.

### Research Flags

Phases likely needing deeper research during planning:
- **None expected** — all phases use well-documented technologies with established patterns. The main unknowns (Claude Code output format, optimal pattern matching) will require empirical testing during implementation, not upfront research.

Phases with standard patterns (skip research-phase):
- **Phase 1-5** — Bun.Terminal API, EventBus pattern, state machines, ANSI parsing, Claude SDK, WebSocket pub/sub, and xterm.js integration are all documented with examples. Focus should be on implementation and testing, not research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official Bun v1.3.5 release notes confirm Bun.Terminal API; Hono and xterm.js are production-proven; Anthropic SDK is official |
| Features | HIGH | Feature dependencies validated against similar projects (VS Code terminal, Warp, tmux); table stakes vs. differentiators well-defined |
| Architecture | HIGH | Event-driven architecture is standard for terminal multiplexers; component boundaries clear; build order validated against dependency graph |
| Pitfalls | HIGH | Feedback loop and PTY lifecycle issues documented in multiple sources; ANSI handling challenges known from terminal emulator domain; WebSocket patterns standard |

**Overall confidence:** HIGH

### Gaps to Address

- **Pattern matching specifics:** Research identified general ANSI parsing approaches but Claude Code's specific output format (prompts, completion messages, error formats) will need empirical observation. Mitigation: capture sample outputs during Phase 2 testing and iterate patterns.

- **Prompt engineering for supervisor:** Research validated Claude SDK integration but optimal prompt structure for decision-making (reasoning, task status assessment, command generation) will require tuning. Mitigation: start with conservative prompts and iterate based on decision quality metrics.

- **Shell compatibility:** Research noted differences between bash/zsh/fish but didn't specify which Claude Code uses. Mitigation: test with multiple shells during Phase 1 PTY testing; make prompt detection configurable.

- **Performance tuning:** Research didn't cover specific buffer sizes, debounce periods, or confidence thresholds. Mitigation: start with conservative values (2s cooldown, 70% confidence threshold, 100-line ring buffer) and tune based on testing.

## Sources

### Primary (HIGH confidence)
- [Bun v1.3.5 Release Notes](https://bun.com/blog/bun-v1.3.5) — Bun.Terminal API introduction and examples
- [Bun.spawn Documentation](https://bun.com/docs/runtime/child-process) — PTY spawning with terminal option
- [Hono Documentation](https://hono.dev/) — HTTP framework for Bun
- [Hono WebSocket Helper](https://hono.dev/docs/helpers/websocket) — upgradeWebSocket pattern for Bun
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) — Official SDK with streaming examples
- [xterm.js Documentation](https://xtermjs.org/) — Terminal emulator API and addons
- [strip-ansi Library](https://github.com/chalk/strip-ansi) — ANSI stripping implementation

### Secondary (MEDIUM confidence)
- [Azure AI Agent Design Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) — Multi-agent loop patterns, supervisor pattern
- [Google Cloud Agentic AI Patterns](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system) — Step budgets, termination conditions
- [LangGraph Documentation](https://docs.langchain.com/oss/python/langgraph/workflows-agents) — State machine workflows for agents
- [Portkey: Retries, Fallbacks, Circuit Breakers](https://portkey.ai/blog/retries-fallbacks-and-circuit-breakers-in-llm-apps/) — Resilience patterns for LLM apps
- [OpenTelemetry AI Agent Observability](https://opentelemetry.io/blog/2025/ai-agent-observability/) — Tracing for AI agents
- [Microsoft node-pty](https://github.com/microsoft/node-pty) — PTY management patterns (for comparison, not used)
- [tmux Client-Server Architecture](https://man7.org/linux/man-pages/man1/tmux.1.html) — Session persistence patterns

### Tertiary (LOW confidence)
- [Medium: PTY with Socket.IO for Multiple Users](https://medium.com/@deysouvik700/efficient-and-scalable-usage-of-node-js-pty-with-socket-io-for-multiple-users-402851075c4a) — Multi-session management patterns (not using Socket.IO but relevant architecture)
- [GitHub Pilotty](https://github.com/msmps/pilotty) — PTY for AI agents (alternative approach for reference)
- [GitHub claude-flow](https://github.com/ruvnet/claude-flow) — Multi-agent orchestration (similar domain, different approach)

---
*Research completed: 2026-01-31*
*Ready for roadmap: yes*
