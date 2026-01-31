/**
 * Session Manager
 *
 * Manages session state transitions with validation against VALID_TRANSITIONS.
 * Provides convenience methods for common state transitions and getters for
 * current state and metadata.
 */

import type { SessionState, SessionMetadata } from "./types";
import { VALID_TRANSITIONS } from "./types";
import { sessionStore } from "./store";

export class SessionManager {
  /**
   * Transition to a new state with validation.
   * Throws descriptive error if transition is invalid.
   */
  transition(newState: SessionState): void {
    const currentStatus = sessionStore.getState().status;
    const validNextStates = VALID_TRANSITIONS[currentStatus];

    if (!validNextStates.includes(newState.status)) {
      throw new Error(
        `Invalid state transition: ${currentStatus} -> ${newState.status}. ` +
          `Valid transitions from ${currentStatus}: ${validNextStates.join(", ")}`
      );
    }

    sessionStore.setState(newState);

    // Update metadata on task_running
    if (newState.status === "task_running") {
      sessionStore.setMetadata({
        taskDescription: newState.taskDescription,
        startTime: newState.startTime,
        runtime: 0,
      });
    }
  }

  /**
   * Start a new task. Transitions from idle to task_running.
   */
  startTask(taskDescription: string): void {
    this.transition({
      status: "task_running",
      taskDescription,
      startTime: new Date(),
    });
  }

  /**
   * Set state to analyzing. Transitions from task_running.
   */
  setAnalyzing(): void {
    this.transition({ status: "analyzing" });
  }

  /**
   * Set state to injecting with the command being injected.
   */
  setInjecting(command: string): void {
    this.transition({ status: "injecting", command });
  }

  /**
   * Return to idle state.
   */
  setIdle(): void {
    this.transition({ status: "idle" });
  }

  /**
   * Set error state. Can be called from any state.
   * Captures the previous status for recovery.
   */
  setError(error: string): void {
    const previousStatus = sessionStore.getState().status;
    sessionStore.setState({
      status: "error",
      error,
      previousStatus,
    });
  }

  /**
   * Get current session state.
   */
  getState(): Readonly<SessionState> {
    return sessionStore.getState();
  }

  /**
   * Get session metadata with current runtime.
   * Returns null if no task has been started.
   */
  getMetadata(): Readonly<SessionMetadata> | null {
    const meta = sessionStore.getMetadata();
    if (!meta) return null;
    return {
      ...meta,
      runtime: sessionStore.getRuntime(),
    };
  }

  /**
   * Get complete session info including state and metadata.
   */
  getInfo(): { state: SessionState; metadata: SessionMetadata | null } {
    return {
      state: this.getState(),
      metadata: this.getMetadata(),
    };
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
