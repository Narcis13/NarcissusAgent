/**
 * Supervisor Module
 *
 * Exports supervisor implementations and utilities.
 */

// Mock supervisor for testing
export { createMockSupervisor } from "./mock";
export type { MockSupervisorOptions } from "./mock";

// Claude CLI supervisor (production)
export { createClaudeSupervisor } from "./claude";

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
