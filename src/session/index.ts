/**
 * Session Module
 *
 * Exports session management components:
 * - SessionManager: State machine with validated transitions
 * - sessionStore: Singleton store for session state
 * - Types: SessionState, SessionStatus, SessionMetadata, etc.
 */

export { SessionManager, sessionManager } from "./manager";
export { sessionStore } from "./store";
export * from "./types";
