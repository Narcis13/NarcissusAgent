/**
 * WebSocket Module
 *
 * Exports WebSocket event broadcasting utilities for the monitoring UI.
 */

export { EventBroadcaster, eventBroadcaster } from "./broadcaster";
export type {
  WSMessageType,
  WSMessage,
  SessionStateData,
  PTYOutputData,
  HookEventData,
  SupervisorCallData,
  SupervisorDecisionData,
  CommandInjectData,
} from "./broadcaster";
