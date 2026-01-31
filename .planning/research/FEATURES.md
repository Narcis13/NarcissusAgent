# Feature Research: Terminal Orchestrator

**Researched:** 2026-01-31
**Domain:** Terminal orchestration + AI supervision

## Terminal/PTY Management

### Table Stakes
- **PTY spawning and lifecycle management** — Simple
  - Use [node-pty](https://github.com/microsoft/node-pty) (Microsoft's library, 555+ npm dependents)
  - Support Linux, macOS, Windows (via conpty API on Windows 1809+)
  - Handle master/slave pseudo-terminal pairs correctly

- **Input/output streaming** — Simple
  - Capture stdout/stderr in real-time
  - Pass stdin to the process
  - Handle binary data and control characters

- **Process exit detection** — Simple
  - Detect when underlying process terminates
  - Capture exit codes
  - Clean up resources on termination

- **Terminal resize (SIGWINCH)** — Simple
  - Support dynamic terminal dimensions
  - Propagate resize events to child process

- **Environment variable handling** — Simple
  - Pass through parent environment
  - Allow custom environment overrides
  - Handle PATH correctly across platforms

### Differentiators
- **ANSI escape code parsing/interpretation** — Medium
  - Parse [VT100/VT220 sequences](https://vt100.net/emu/dec_ansi_parser) for state tracking
  - Useful for understanding terminal state without visual rendering
  - Enables "headless" mode like [xterm-headless](https://xtermjs.org/)

- **Session persistence across orchestrator restarts** — Complex
  - Serialize terminal state (scrollback buffer, cursor position)
  - Reconnect to running processes (requires careful architecture)
  - Similar to how [tmux](https://www.linode.com/docs/guides/persistent-terminal-sessions-with-tmux/) survives disconnections

- **Multi-session management with Redis/memory store** — Medium
  - Track multiple PTY sessions in a [dictionary or Redis](https://medium.com/@deysouvik700/efficient-and-scalable-usage-of-node-js-pty-with-socket-io-for-multiple-users-402851075c4a)
  - Scale horizontally across processes
  - Session isolation and cleanup

- **Output buffering with configurable history** — Simple
  - Configurable scrollback buffer size (like [WezTerm](https://wezterm.org/scrollback.html))
  - Memory-efficient ring buffer implementation
  - Searchable history

### Anti-features
- **Thread-based PTY multiplexing** — node-pty is [not thread-safe](https://github.com/microsoft/node-pty); use process-based isolation instead
- **Custom terminal emulation from scratch** — Use established libraries; terminal compatibility is notoriously hard
- **Synchronous I/O** — Always use async/event-driven patterns for PTY operations

---

## AI Supervisor/Orchestration

### Table Stakes
- **Autonomous execution loop** — Medium
  - [Multi-agent loop pattern](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) with termination conditions
  - Continuously process output and decide next actions
  - Clear entry/exit conditions

- **Step/iteration budgets** — Simple
  - Hard limit on iterations to [prevent infinite loops](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system)
  - Configurable max steps before forced termination
  - Cost tracking (token usage)

- **Error handling with retries** — Medium
  - [Exponential backoff with jitter](https://portkey.ai/blog/retries-fallbacks-and-circuit-breakers-in-llm-apps/)
  - Configurable retry counts per error type
  - Distinguish transient vs permanent failures

- **Output parsing/analysis** — Medium
  - Extract structured information from terminal output
  - Detect success/failure patterns
  - Handle streaming partial output

- **State machine for supervisor states** — Medium
  - Clear states: IDLE, RUNNING, WAITING_FOR_OUTPUT, ANALYZING, ERROR
  - [Graph-based workflow](https://docs.langchain.com/oss/python/langgraph/workflows-agents) like LangGraph
  - State transitions with guards

### Differentiators
- **Circuit breaker pattern** — Medium
  - [Three states: closed, open, half-open](https://www.pollydocs.org/strategies/circuit-breaker.html)
  - Prevent cascading failures when LLM provider is down
  - Auto-recovery with health checks

- **Fallback model support** — Medium
  - Route to backup LLM when primary fails
  - [Graceful degradation](https://engineersmeetai.substack.com/p/fail-safe-patterns-for-ai-agent-workflows) with smaller/faster models
  - Cost vs quality tradeoffs

- **Maker-checker pattern** — Complex
  - One agent proposes, another validates
  - [Iterative refinement loop](https://kore.ai/blog/choosing-the-right-orchestration-pattern-for-multi-agent-systems)
  - Reduces hallucination risks

- **Goal decomposition** — Complex
  - Break complex tasks into subtasks
  - [Supervisor pattern](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) for task delegation
  - Progress tracking per subtask

- **Tool/action validation** — Medium
  - Validate proposed commands before execution
  - Sandbox dangerous operations
  - [Allowlist/blocklist patterns](https://www.anthropic.com/engineering/claude-code-sandboxing)

- **Checkpointing and rollback** — Complex
  - Save state at decision points
  - [Rewind capability](https://pasqualepillitteri.it/en/news/141/claude-code-dangerously-skip-permissions-guide-autonomous-mode) like Claude Code
  - Git-based checkpoints for file changes

- **Human-in-the-loop interrupts** — Medium
  - [Pause/resume workflow](https://docs.langchain.com/oss/python/langchain/human-in-the-loop) at critical points
  - Clear approval requests with context
  - [State persistence](https://mastra.ai/docs/workflows/human-in-the-loop) during pause

### Anti-features
- **Unlimited autonomous operation** — Always have kill switches and step budgets
- **Synchronous LLM calls blocking the event loop** — Use async patterns
- **Storing full conversation history in memory** — Use summarization or external storage for long sessions
- **Hard-coded prompts** — Make prompts configurable and versionable

---

## Web UI (Terminal View)

### Table Stakes
- **Real-time terminal rendering** — Medium
  - Use [xterm.js](https://xtermjs.org/) (powers VS Code, JupyterLab, Azure Cloud Shell)
  - WebSocket connection for streaming
  - Full ANSI/Unicode/emoji support

- **Scrollback buffer** — Simple
  - Configurable history length
  - Efficient DOM virtualization for large buffers
  - Automatic scroll-to-bottom on new output

- **Copy/paste support** — Simple
  - Selection and clipboard integration
  - Handle terminal escape sequences correctly

- **Responsive/resizable terminal** — Simple
  - Use [xterm-addon-fit](https://xtermjs.org/docs/) addon
  - Propagate size changes to backend PTY

- **Connection status indicator** — Simple
  - Show connected/disconnected/reconnecting states
  - Visual feedback for latency

### Differentiators
- **Search in scrollback** — Medium
  - Highlight matches like [WezTerm](https://wezterm.org/scrollback.html) (Ctrl+Shift+F)
  - Regex support
  - Navigate between matches

- **Split view (terminal + supervisor log)** — Medium
  - Side-by-side or tabbed layout
  - Synchronized scrolling option
  - Collapsible panels

- **Output highlighting/annotation** — Medium
  - Highlight errors, warnings, success messages
  - Clickable links (URLs, file paths)
  - Custom markers for important events

- **Session recording/playback** — Complex
  - Record terminal sessions with timing
  - Playback with speed control
  - Export to video/GIF

- **Multiple terminal tabs** — Medium
  - Tab management UI
  - Tab grouping/naming
  - Quick switch shortcuts

- **Theming support** — Simple
  - Dark/light modes
  - Custom color schemes
  - Font selection

- **Mobile/touch support** — Medium
  - Touch-friendly controls
  - Virtual keyboard integration
  - Gesture support (swipe to scroll)

### Anti-features
- **Canvas-based terminal without xterm.js** — Don't reinvent; xterm.js is battle-tested
- **Polling for updates** — Use WebSocket streaming instead
- **Storing full scrollback in browser localStorage** — Use server-side storage for persistence
- **Custom font rendering** — Use xterm.js GPU-accelerated renderer

---

## Session Management

### Table Stakes
- **Session creation/destruction** — Simple
  - Unique session IDs
  - Clean resource cleanup on destroy
  - Timeout for idle sessions

- **Session state tracking** — Medium
  - Current status (running, paused, completed, failed)
  - Start/end timestamps
  - Last activity timestamp

- **Basic session metadata** — Simple
  - Name/description
  - Associated task/goal
  - Creation parameters

- **Session listing/querying** — Simple
  - List active sessions
  - Filter by status
  - Basic search

### Differentiators
- **Session persistence to database** — Medium
  - SQLite for single-instance
  - PostgreSQL for multi-instance
  - Store output history, state snapshots

- **Session reconnection** — Complex
  - Restore UI state on reconnect
  - Replay missed output
  - Handle network interruptions gracefully
  - Similar to [tmux attach](https://www.linode.com/docs/guides/persistent-terminal-sessions-with-tmux/)

- **Session branching/forking** — Complex
  - Create checkpoint and explore alternative paths
  - Compare outcomes between branches
  - Merge successful branches

- **Session templates** — Simple
  - Predefined configurations for common tasks
  - Quick-start with presets
  - Shareable templates

- **Session export/import** — Medium
  - Export full session state as JSON/archive
  - Import and replay sessions
  - Share sessions between users

- **Multi-user session sharing** — Complex
  - Real-time collaboration
  - Permission levels (view, interact)
  - Activity indicators for other users

### Anti-features
- **In-memory only session storage** — Sessions should survive process restarts
- **Unbounded session history** — Implement retention policies and archival
- **Session data in filesystem without structure** — Use a proper database

---

## Observability/Monitoring

### Table Stakes
- **Basic logging** — Simple
  - Structured JSON logs
  - Log levels (debug, info, warn, error)
  - Correlation IDs for request tracing

- **Error tracking** — Simple
  - Capture stack traces
  - Error categorization
  - Rate limiting for repeated errors

- **Health checks** — Simple
  - Liveness endpoint
  - Readiness endpoint
  - Dependency health status

### Differentiators
- **OpenTelemetry integration** — Medium
  - [Standardized telemetry](https://opentelemetry.io/blog/2025/ai-agent-observability/) for AI agents
  - Traces across LLM calls
  - Metrics for latency, token usage

- **Token usage tracking** — Simple
  - Track input/output tokens per request
  - Cost estimation
  - Usage alerts/limits

- **Agent decision tracing** — Medium
  - Log reasoning steps
  - [Decision paths](https://www.ibm.com/think/insights/ai-agent-observability) with timestamps
  - Tool invocation history

- **Real-time metrics dashboard** — Medium
  - Sessions active
  - Tokens consumed
  - Success/failure rates
  - Average session duration

- **Alerting** — Medium
  - Configurable thresholds
  - Multiple notification channels
  - Alert grouping/deduplication

### Anti-features
- **Logging to stdout only in production** — Use proper log aggregation
- **Synchronous metrics collection** — Use async/batched approaches
- **Storing metrics only in memory** — Use time-series database for history

---

## Feature Dependencies

```
PTY Management
  |
  v
Session Management <-- required for -->  AI Supervisor
  |                                            |
  v                                            v
Web UI (Terminal View) <-- required for --> Observability
```

### Dependency Chain

1. **Core Layer (implement first)**
   - PTY spawning/management (node-pty)
   - Basic session CRUD
   - WebSocket server for streaming

2. **AI Layer (implement second)**
   - Output parsing
   - LLM integration
   - Basic autonomous loop
   - Step budgets and error handling

3. **UI Layer (implement third)**
   - xterm.js integration
   - Real-time streaming display
   - Basic session list

4. **Advanced Features (implement last)**
   - Circuit breakers, fallbacks
   - Session persistence/reconnection
   - Search, recording, branching
   - OpenTelemetry, dashboards

### Critical Path for MVP

1. node-pty + WebSocket streaming
2. xterm.js web terminal
3. Basic AI supervisor loop with Claude
4. Session state tracking
5. Simple web dashboard

---

## Sources

### Terminal/PTY
- [Microsoft node-pty](https://github.com/microsoft/node-pty)
- [xterm.js](https://xtermjs.org/)
- [WezTerm Scrollback](https://wezterm.org/scrollback.html)
- [Pilotty - PTY for AI agents](https://github.com/msmps/pilotty)

### AI Orchestration
- [Azure AI Agent Design Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [Google Cloud Agentic AI Patterns](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system)
- [LangGraph Documentation](https://docs.langchain.com/oss/python/langgraph/workflows-agents)
- [Kore.ai Multi-Agent Orchestration](https://kore.ai/blog/choosing-the-right-orchestration-pattern-for-multi-agent-systems)

### Resilience Patterns
- [Portkey: Retries, Fallbacks, Circuit Breakers](https://portkey.ai/blog/retries-fallbacks-and-circuit-breakers-in-llm-apps/)
- [Fail-Safe Patterns for AI Agent Workflows](https://engineersmeetai.substack.com/p/fail-safe-patterns-for-ai-agent-workflows)
- [Polly Circuit Breaker](https://www.pollydocs.org/strategies/circuit-breaker.html)

### Claude Code
- [Claude Code Sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)
- [Claude Code Autonomous Mode Guide](https://pasqualepillitteri.it/en/news/141/claude-code-dangerously-skip-permissions-guide-autonomous-mode)
- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)

### Observability
- [OpenTelemetry AI Agent Observability](https://opentelemetry.io/blog/2025/ai-agent-observability/)
- [IBM AI Agent Observability](https://www.ibm.com/think/insights/ai-agent-observability)

### Human-in-the-Loop
- [LangChain HITL](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)
- [Mastra HITL Workflows](https://mastra.ai/docs/workflows/human-in-the-loop)
- [OpenAI Agents SDK HITL](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
