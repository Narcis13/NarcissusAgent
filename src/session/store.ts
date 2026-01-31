/**
 * Session Store
 *
 * Singleton store for managing session state and metadata.
 * Provides centralized state management for the SessionManager.
 */

import type { SessionState, SessionMetadata } from "./types";

class SessionStore {
  private state: SessionState = { status: "idle" };
  private metadata: SessionMetadata | null = null;

  getState(): Readonly<SessionState> {
    return this.state;
  }

  setState(state: SessionState): void {
    this.state = state;
  }

  getMetadata(): Readonly<SessionMetadata> | null {
    return this.metadata;
  }

  setMetadata(metadata: SessionMetadata | null): void {
    this.metadata = metadata;
  }

  getRuntime(): number {
    if (!this.metadata) return 0;
    return Date.now() - this.metadata.startTime.getTime();
  }
}

// Singleton instance
export const sessionStore = new SessionStore();
