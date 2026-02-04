/**
 * Supervisor Types
 *
 * Type definitions for Claude Code CLI supervisor spawning.
 */

import type { ToolHistoryEntry } from "../hooks/types";

/**
 * Context passed to supervisor for decision making.
 *
 * NOTE: iterationCount and maxIterations are tracked in the closure
 * of createClaudeSupervisor, not passed via context. This keeps the
 * SupervisorContext compatible with HooksController.SupervisorFn.
 */
export interface SupervisorContext {
  taskDescription: string;
  toolHistory: ToolHistoryEntry[];
  sessionId: string;
}

/**
 * Result from spawning claude -p process
 */
export interface SpawnResult {
  output: string;
  exitCode: number;
  error?: string;
}

/**
 * Parsed supervisor response
 */
export interface ParsedResponse {
  action: 'complete' | 'abort' | 'continue';
  content: string;
  raw: string;
}

/**
 * Configuration for createClaudeSupervisor
 */
export interface ClaudeSupervisorConfig {
  /** Maximum iterations before forced stop (default: 50) */
  maxIterations?: number;
  /** Timeout for supervisor spawn in ms (default: 30000) */
  timeout?: number;
  /** Maximum consecutive failures before abort (default: 3) */
  maxConsecutiveFailures?: number;
}
