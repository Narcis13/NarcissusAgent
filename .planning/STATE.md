# Project State: Claude Code Orchestrator

**Current Phase:** 3 (in progress)
**Current Plan:** 02 complete (Prompt Template & Supervisor Factory)
**Status:** Phase 3 In Progress
**Last Updated:** 2026-02-05

## Progress

| Phase | Status | Progress |
|-------|--------|----------|
| 1 - Core Foundation | Complete | ██████████ 100% |
| 2 - Output Analysis & Loop | Complete | ██████████ 100% |
| 3 - AI Supervisor | In Progress | █████░░░░░ 50% |
| 4 - Web Interface | Pending | ░░░░░░░░░░ 0% |

**Overall:** 10 plans complete (Phase 1 + Phase 2 + Plans 03-01, 03-02, ~62% project)

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-31)

**Core value:** The autonomous loop must work reliably: task -> detect completion -> supervisor decides -> inject next command -> repeat until done.

**Current focus:** Phase 3 - AI Supervisor (Plan 02 complete, supervisor factory ready)

## Current Position

- **Phase:** 3 - AI Supervisor (IN PROGRESS)
- **Plan:** 02 complete (Prompt Template & Supervisor Factory)
- **Blocking:** Nothing
- **Next action:** Execute Plan 03-03 (Hooks Integration)

## Performance Metrics

| Metric | Value |
|--------|-------|
| Plans completed | 10 |
| Plans failed | 0 |
| Requirements done | 0/30 |
| Session started | 2026-01-31 |

## Accumulated Context

### Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Quick depth (4 phases) | Balance speed with coherent delivery boundaries | 2026-01-31 |
| PTY + Session in Phase 1 | Foundation must be solid before adding detection/analysis | 2026-01-31 |
| Loop mechanics in Phase 2 | Detection and loop are tightly coupled | 2026-01-31 |
| Bun 1.3.8 for Terminal API | Upgraded from 1.3.2 to enable native PTY support | 2026-01-31 |
| Discriminated union for SessionState | Type-safe state machine without XState overhead | 2026-01-31 |
| proc.exited for PTY exit handling | More reliable than terminal.exit callback for process exit detection | 2026-01-31 |
| Default terminal 120x40 | Comfortable viewing width for Claude Code output | 2026-01-31 |
| setError bypasses transition validation | Error state can be reached from any state | 2026-01-31 |
| Runtime calculated on-demand | getMetadata() calculates runtime fresh each call | 2026-01-31 |
| CLI entry pattern: parseArgs -> Bun.serve -> PTYManager.spawn | Standard integration flow for CLI | 2026-01-31 |
| Checkpoint auto-approval in autonomous mode | Per POLICY-07 when all verifications pass | 2026-01-31 |
| Ring buffer line-aware splitting | Handles partial PTY output chunks by joining incomplete lines | 2026-02-01 |
| Pattern weights 0.1-0.6 scale | Lower for weak signals, higher for definitive (exclusive flag) | 2026-02-01 |
| 70% confidence threshold | DEFAULT_CONFIDENCE_THRESHOLD per requirements | 2026-02-01 |
| PatternCategory 'completion' -> OutputState 'completed' | Category uses noun, state uses past tense for API clarity | 2026-02-01 |
| EXCLUSIVE_PENALTY = 0.2 | Penalize other categories when exit code patterns match | 2026-02-01 |
| Cooldown starts AFTER action | Rate limiting vs debounce - ensures minimum gap between supervisor calls | 2026-02-01 |
| Supervisor injection via setSupervisor() | Allows Phase 3 to provide Claude API implementation | 2026-02-01 |
| Only completed/error states trigger supervisor | Running and prompt_ready don't need supervisor intervention | 2026-02-01 |
| Verbose flag default false | Analysis logging gated by --verbose to reduce noise | 2026-02-01 |
| Loop stats on exit | Report iterations and supervisor calls for monitoring | 2026-02-01 |
| SupervisorContext excludes iteration tracking | iterationCount/maxIterations managed in closure, not context | 2026-02-05 |
| Bun.$ with safety guards for spawn | .nothrow().quiet().timeout() for robust process spawning | 2026-02-05 |
| Bracketed marker protocol | [COMPLETE]/[ABORT]/[CONTINUE] at start of supervisor response | 2026-02-05 |
| Defensive continue on missing marker | Default to 'continue' with warning if no marker found | 2026-02-05 |
| Iteration count as direct params to buildSupervisorPrompt | Tracked in closure, not context, for HooksController compatibility | 2026-02-05 |
| Default 50 max iterations | Hard budget stop to prevent runaway supervisor loops | 2026-02-05 |
| Default 3 consecutive failures before abort | Recovery from transient failures, abort on persistent issues | 2026-02-05 |
| Marker mapping: COMPLETE->stop, ABORT->abort+/clear, CONTINUE->inject | Clear action semantics for supervisor decisions | 2026-02-05 |

### Technical Notes

- Use Bun.Terminal API (v1.3.5+) for PTY management, not node-pty
- Hono for HTTP/WebSocket server
- xterm.js for browser terminal rendering
- Anthropic SDK for Claude API calls
- Feedback loop prevention is critical (cooldown, state machine)
- SessionState uses discriminated union with `status` field for type narrowing
- VALID_TRANSITIONS map enforces state machine rules at runtime
- PTYManager uses proc.exited promise (not terminal.exit callback) for exit handling
- PTYManager throws on double spawn and writes to closed terminal (defensive API)
- SessionManager validates transitions, setError bypasses for error recovery
- REST API returns runtime in both ms and formatted string
- CLI uses parseArgs for argument parsing with --port, --verbose, and --help options
- Signal handlers (SIGINT/SIGTERM) trigger graceful shutdown with PTY and loop cleanup
- strip-ansi@7.1.2 for ANSI escape code stripping (ESM-only)
- OutputBuffer uses ring buffer with line-aware splitting for partial output handling
- 21 detection patterns across 4 categories: completion, error, prompt_ready, running
- Exclusive patterns for exit codes penalize other categories
- OutputAnalyzer.analyze() returns AnalysisResult with state, confidence, matches, cleanOutput, categoryScores
- TDD approach: test commit followed by feat commit for feature development
- LoopController.processOutput() is main entry point from PTYManager.onData
- Event handlers for external observation without tight coupling
- Cooldown class prevents feedback loops via rate limiting (not debounce)
- All Phase 2 types re-exported from src/types.ts for convenient imports
- Bun.$ template literal for spawning claude -p with .nothrow().quiet().timeout()
- Supervisor marker protocol: [COMPLETE], [ABORT], [CONTINUE] parsed from response start
- buildSupervisorPrompt accepts iterationCount and maxIterations as direct parameters
- createClaudeSupervisor uses closure state for iteration and consecutive failure tracking
- Supervisor factory returns SupervisorFn compatible with HooksController.setSupervisor()

### TODOs

- None yet

### Blockers

- None

## Phase 1 Deliverables

| Component | Status | Summary |
|-----------|--------|---------|
| PTYManager | Complete | Spawns Claude Code in PTY, streams output, handles exit |
| SessionManager | Complete | State machine with validated transitions |
| REST API | Complete | /api/health and /api/session endpoints |
| CLI Entry | Complete | Integrates all components, graceful shutdown |

## Phase 2 Deliverables

| Component | Status | Summary |
|-----------|--------|---------|
| Output Types | Complete | OutputState, PatternWeight, AnalysisResult types |
| OutputBuffer | Complete | Ring buffer for memory-bounded output accumulation |
| Pattern Definitions | Complete | 21 patterns for state detection with weights |
| OutputAnalyzer | Complete | ANSI stripping, confidence scoring, exclusive penalties |
| Loop Types | Complete | LoopState, LoopConfig, SupervisorDecision types |
| Cooldown | Complete | Rate limiter preventing feedback loops |
| LoopController | Complete | Autonomous loop orchestration with supervisor injection |
| CLI Integration | Complete | LoopController wired to PTY output, event handlers configured |

## Phase 3 Deliverables

| Component | Status | Summary |
|-----------|--------|---------|
| Supervisor Types | Complete | SupervisorContext, SpawnResult, ParsedResponse, ClaudeSupervisorConfig |
| Spawn Wrapper | Complete | spawnSupervisor() using Bun.$ template literal with timeout |
| Response Parser | Complete | parseResponse() for [COMPLETE]/[ABORT]/[CONTINUE] markers |
| Prompt Template | Complete | buildSupervisorPrompt with iteration N/M format and tool history |
| Supervisor Factory | Complete | createClaudeSupervisor with budget enforcement and failure recovery |
| Hooks Integration | Pending | Plan: 03-03 |
| CLI Integration | Pending | Plan: 03-04 |

## Session Continuity

**Last session:** 2026-02-05
**Stopped at:** Completed 03-02-PLAN.md (Prompt Template & Supervisor Factory)
**Resume file:** None

---
*State updated: 2026-02-05*
