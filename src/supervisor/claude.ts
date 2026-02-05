/**
 * Claude Supervisor Factory
 *
 * Creates a supervisor function that spawns claude -p for decisions.
 */
import type { SupervisorFn } from "../hooks/controller";
import type { SupervisorDecision } from "../hooks/types";
import type { ClaudeSupervisorConfig } from "./types";
import { spawnSupervisor } from "./spawn";
import { parseResponse } from "./parse";
import { buildSupervisorPrompt } from "./prompt";

const DEFAULT_MAX_ITERATIONS = 50;
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Create a Claude Code CLI supervisor function
 *
 * Spawns a fresh `claude -p` process for each decision.
 * Tracks iteration count and failure count in closure.
 *
 * @param config - Optional configuration (maxIterations, timeout, maxConsecutiveFailures)
 * @returns SupervisorFn compatible with HooksController.setSupervisor()
 */
export function createClaudeSupervisor(config: ClaudeSupervisorConfig = {}): SupervisorFn {
  const {
    maxIterations = DEFAULT_MAX_ITERATIONS,
    timeout = DEFAULT_TIMEOUT,
    maxConsecutiveFailures = DEFAULT_MAX_CONSECUTIVE_FAILURES,
    onIterationUpdate,
  } = config;

  // Closure state for iteration and failure tracking
  let iterationCount = 0;
  let consecutiveFailures = 0;

  return async (context): Promise<SupervisorDecision> => {
    iterationCount++;

    // Notify UI of iteration progress
    onIterationUpdate?.({
      current: iterationCount,
      max: maxIterations,
      percentage: (iterationCount / maxIterations) * 100,
      consecutiveFailures,
    });

    // Enforce iteration budget - hard stop at limit
    if (iterationCount >= maxIterations) {
      console.log(`[Supervisor] Iteration budget exhausted (${iterationCount}/${maxIterations})`);
      return {
        action: 'abort',
        command: '/clear',
        reason: `Iteration budget exhausted (${iterationCount}/${maxIterations})`,
        confidence: 1.0,
      };
    }

    // Build prompt with iteration context (passed as direct args, not from context)
    const prompt = buildSupervisorPrompt(context, iterationCount, maxIterations);

    // Spawn supervisor process
    const result = await spawnSupervisor(prompt, timeout);

    // Handle spawn failures with consecutive failure tracking
    if (result.exitCode !== 0) {
      consecutiveFailures++;
      console.error(`[Supervisor] Process exited with code: ${result.exitCode} (failure ${consecutiveFailures}/${maxConsecutiveFailures})`);
      console.error('[Supervisor] Error:', result.error);

      // Abort after too many consecutive failures
      if (consecutiveFailures >= maxConsecutiveFailures) {
        console.error(`[Supervisor] Too many consecutive failures (${consecutiveFailures}), aborting`);
        return {
          action: 'abort',
          command: '/clear',
          reason: `Supervisor failed ${consecutiveFailures} times consecutively`,
          confidence: 1.0,
        };
      }

      // Continue monitoring on recoverable failure
      return {
        action: 'continue',
        reason: `Supervisor error (exit ${result.exitCode}), resuming monitoring`,
        confidence: 0.5,
      };
    }

    // Success - reset consecutive failure counter
    consecutiveFailures = 0;

    // Parse response and map to SupervisorDecision
    const parsed = parseResponse(result.output);

    switch (parsed.action) {
      case 'complete':
        return {
          action: 'stop',
          reason: parsed.content || 'Work complete',
          confidence: 0.9,
        };

      case 'abort':
        return {
          action: 'abort',
          command: '/clear',  // Clean up inner Claude context
          reason: parsed.content || 'Aborted by supervisor',
          confidence: 0.9,
        };

      case 'continue':
        return {
          action: 'inject',
          command: parsed.content,
          reason: 'Supervisor continues work',
          confidence: 0.8,
        };
    }
  };
}
