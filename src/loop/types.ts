/**
 * Loop Types
 *
 * Type definitions for the autonomous loop controller.
 */

import type { AnalysisResult } from '../output/types.ts';

/**
 * Loop controller state
 */
export type LoopState =
  | 'idle'           // Not running
  | 'monitoring'     // Watching PTY output
  | 'analyzing'      // Running pattern analysis
  | 'waiting_cooldown' // Cooldown period before supervisor
  | 'calling_supervisor' // Awaiting supervisor decision
  | 'injecting'      // Writing command to PTY
  | 'stopped';       // Gracefully stopped

/**
 * Configuration for loop behavior
 */
export interface LoopConfig {
  /** Minimum milliseconds between supervisor calls (default: 3000) */
  minCooldownMs: number;
  /** Maximum cooldown in ms - not currently used, for future adaptive cooldown */
  maxCooldownMs: number;
  /** Confidence threshold to trigger supervisor (default: 0.7) */
  confidenceThreshold: number;
  /** Maximum loop iterations before forced stop (default: 100) */
  maxIterations: number;
  /** Output buffer size in lines (default: 100) */
  bufferSize: number;
}

/**
 * Default loop configuration
 */
export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  minCooldownMs: 3000,
  maxCooldownMs: 5000,
  confidenceThreshold: 0.7,
  maxIterations: 100,
  bufferSize: 100,
};

/**
 * Supervisor decision types
 * (Actual supervisor implementation is Phase 3, but types needed for interface)
 */
export type SupervisorAction =
  | 'continue'    // Keep monitoring, no action needed
  | 'inject'      // Inject a new command
  | 'stop'        // Stop the loop (work complete)
  | 'clear'       // Clear terminal and continue
  | 'compact'     // Compact conversation and continue
  | 'abort';      // Abort due to error/issue

/**
 * Decision returned by supervisor
 */
export interface SupervisorDecision {
  /** Action to take */
  action: SupervisorAction;
  /** Command to inject (required if action === 'inject') */
  command?: string;
  /** Reasoning for the decision */
  reason: string;
  /** Supervisor's confidence in this decision */
  confidence: number;
}

/**
 * Event handler callbacks for loop controller
 */
export interface LoopEventHandler {
  /** Called when analysis completes */
  onAnalysis?: (result: AnalysisResult) => void;
  /** Called when supervisor is invoked */
  onSupervisorCall?: (context: { recentOutput: string; analysis: AnalysisResult }) => void;
  /** Called when supervisor returns decision */
  onSupervisorDecision?: (decision: SupervisorDecision) => void;
  /** Called when command is injected */
  onInject?: (command: string) => void;
  /** Called when loop stops */
  onStop?: (reason: string) => void;
  /** Called on loop error */
  onError?: (error: Error) => void;
}

/**
 * Statistics tracked during loop execution
 */
export interface LoopStats {
  /** Number of loop iterations */
  iterations: number;
  /** Number of supervisor calls */
  supervisorCalls: number;
  /** Number of commands injected */
  commandsInjected: number;
  /** Start time */
  startTime: Date;
  /** End time (null if still running) */
  endTime: Date | null;
}
