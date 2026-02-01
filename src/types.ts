/**
 * Shared Types for Claude Code Orchestrator
 *
 * Re-exports all types from domain modules for convenient imports.
 * Import from this file when you need types across module boundaries.
 *
 * @example
 * import type { SessionState, PTYManager } from "./types";
 */

// PTY types
export type { PTYManager, PTYManagerOptions } from "./pty/types.ts";

// Session types
export type {
  SessionState,
  SessionStatus,
  SessionMetadata,
  SessionInfo,
} from "./session/types.ts";

export { VALID_TRANSITIONS, isValidTransition } from "./session/types.ts";

// Output analysis types
export type {
  OutputState,
  PatternCategory,
  PatternMatch,
  PatternWeight,
  AnalysisResult,
} from "./output/types.ts";

export { OutputAnalyzer } from "./output/analyzer.ts";
export { OutputBuffer } from "./output/buffer.ts";
export { PATTERNS, DEFAULT_CONFIDENCE_THRESHOLD } from "./output/patterns.ts";

// Loop types
export type {
  LoopState,
  LoopConfig,
  SupervisorAction,
  SupervisorDecision,
  LoopEventHandler,
  LoopStats,
} from "./loop/types.ts";
export { DEFAULT_LOOP_CONFIG } from "./loop/types.ts";

export { Cooldown } from "./loop/cooldown.ts";
export { LoopController } from "./loop/controller.ts";
export type { SupervisorFn } from "./loop/controller.ts";
