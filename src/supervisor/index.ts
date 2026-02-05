/**
 * Supervisor Module
 *
 * Exports supervisor implementations and utilities.
 */

// Mock supervisor for testing
export { createMockSupervisor } from "./mock";
export type { MockSupervisorOptions } from "./mock";

// Claude CLI supervisor (spawn-based, legacy)
export { createClaudeSupervisor } from "./claude";

// Interactive PTY-based supervisor (recommended)
export {
  InteractiveSupervisor,
  createInteractiveSupervisor,
} from "./interactive";
export type {
  InteractiveSupervisorConfig,
  SupervisorPTYState,
} from "./interactive";

// Types
export type {
  SupervisorContext,
  SpawnResult,
  ParsedResponse,
  ClaudeSupervisorConfig,
} from "./types";

// Internal utilities (exported for testing/advanced use)
export { spawnSupervisor } from "./spawn";
export { parseResponse } from "./parse";
export { buildSupervisorPrompt } from "./prompt";
