/**
 * Mock Supervisor
 *
 * A simple mock supervisor for testing and development.
 * Always returns "continue" with a configurable delay.
 */

import type { SupervisorFn } from "../hooks/controller";
import type { SupervisorDecision } from "../hooks/types";

export interface MockSupervisorOptions {
  /** Simulated thinking delay in milliseconds (default: 100) */
  delay?: number;
  /** Default action to return (default: "continue") */
  defaultAction?: SupervisorDecision["action"];
}

/**
 * Create a mock supervisor function for testing
 */
export function createMockSupervisor(
  options: MockSupervisorOptions = {}
): SupervisorFn {
  const { delay = 100, defaultAction = "continue" } = options;

  return async (context): Promise<SupervisorDecision> => {
    // Simulate thinking time
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    return {
      action: defaultAction,
      reason: `Mock supervisor: reviewed transcript ${context.transcriptPath}, continuing task`,
      confidence: 0.9,
    };
  };
}
