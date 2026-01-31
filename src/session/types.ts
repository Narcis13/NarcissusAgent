/**
 * Session State Types
 *
 * Defines the session state machine using TypeScript discriminated unions.
 * This pattern provides type-safe state transitions and exhaustive checking.
 */

/**
 * Session state discriminated union
 *
 * Each state has a unique `status` field that TypeScript uses for narrowing.
 * Additional fields are state-specific and only present when relevant.
 */
export type SessionState =
  | { status: "idle" }
  | { status: "task_running"; taskDescription: string; startTime: Date }
  | { status: "analyzing" }
  | { status: "injecting"; command: string }
  | { status: "error"; error: string; previousStatus: SessionStatus };

/**
 * Union of all possible session status values
 * Extracted from SessionState for use in transition maps
 */
export type SessionStatus = SessionState["status"];

/**
 * Metadata about the current or last session task
 */
export interface SessionMetadata {
  /** Description of the task being executed */
  taskDescription: string;
  /** When the task started */
  startTime: Date;
  /** Runtime in milliseconds (updated periodically or on completion) */
  runtime: number;
}

/**
 * Complete session information for API responses
 */
export interface SessionInfo {
  /** Current session state */
  state: SessionState;
  /** Task metadata (null if no task has been started) */
  metadata: SessionMetadata | null;
}

/**
 * Valid state transitions map
 *
 * Defines which states can transition to which other states.
 * Used by SessionManager to validate transitions at runtime.
 *
 * State machine diagram:
 *
 *   idle ─────────────────────────► task_running
 *     ▲                               │
 *     │                               ▼
 *     │                            analyzing
 *     │                               │
 *     │                               ▼
 *     │                            injecting ──► task_running
 *     │                               │
 *     └───────────────────────────────┘
 *                    │
 *                    ▼
 *                  error ───► idle
 *
 * Any state can transition to error, error can only go to idle.
 */
export const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  idle: ["task_running", "error"],
  task_running: ["analyzing", "idle", "error"],
  analyzing: ["injecting", "idle", "error"],
  injecting: ["task_running", "error"],
  error: ["idle"],
};

/**
 * Type guard to check if a transition is valid
 */
export function isValidTransition(
  from: SessionStatus,
  to: SessionStatus
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
