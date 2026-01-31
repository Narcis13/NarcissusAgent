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
