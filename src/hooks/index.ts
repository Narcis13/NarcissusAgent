/**
 * Hooks Module
 *
 * Event-driven orchestration using Claude Code's native hooks system.
 */

export { HooksController } from './controller';
export type { SupervisorFn } from './controller';
export type {
  StopEvent,
  ToolEvent,
  SessionStartEvent,
  SessionEndEvent,
  HookEvent,
  HooksControllerState,
  HooksStats,
  HooksEventHandler,
  ToolHistoryEntry,
  SupervisorAction,
  SupervisorDecision,
} from './types';
