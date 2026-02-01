# Project State: Claude Code Orchestrator

**Current Phase:** 2 (complete)
**Current Plan:** 04 complete (Phase 2 complete)
**Status:** Phase 2 Complete
**Last Updated:** 2026-02-01

## Progress

| Phase | Status | Progress |
|-------|--------|----------|
| 1 - Core Foundation | Complete | ██████████ 100% |
| 2 - Output Analysis & Loop | Complete | ██████████ 100% |
| 3 - AI Supervisor | Pending | ░░░░░░░░░░ 0% |
| 4 - Web Interface | Pending | ░░░░░░░░░░ 0% |

**Overall:** 8 plans complete (Phase 1 + Phase 2, ~50% project)

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-31)

**Core value:** The autonomous loop must work reliably: task -> detect completion -> supervisor decides -> inject next command -> repeat until done.

**Current focus:** Phase 2 Complete - Ready for Phase 3 (AI Supervisor)

## Current Position

- **Phase:** 2 - Output Analysis & Loop (COMPLETE)
- **Plan:** 04 complete (CLI Integration)
- **Blocking:** Nothing
- **Next action:** Begin Phase 3 - AI Supervisor

## Performance Metrics

| Metric | Value |
|--------|-------|
| Plans completed | 8 |
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

## Session Continuity

**Last session:** 2026-02-01
**Stopped at:** Completed 02-04-PLAN.md (CLI Integration) - Phase 2 Complete
**Resume file:** None

---
*State updated: 2026-02-01*
