/**
 * Hooks Types
 *
 * Type definitions for Claude Code hook events.
 * These correspond to the events fired by Claude Code's hooks system.
 */

/**
 * Stop event - fired when Claude finishes responding
 */
export interface StopEvent {
  session_id: string;
  transcript_path: string;
  hook_event_name: 'Stop';
}

/**
 * Tool use event - fired after each tool call completes
 */
export interface ToolEvent {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: {
    output: string;
    error?: string;
  };
  hook_event_name: 'PostToolUse';
}

/**
 * Session start event - fired when a session begins
 */
export interface SessionStartEvent {
  session_id: string;
  cwd: string;
  source: 'startup' | 'resume' | 'clear' | 'compact';
  hook_event_name: 'SessionStart';
}

/**
 * Session end event - fired when a session terminates
 */
export interface SessionEndEvent {
  session_id: string;
  reason: string;
  hook_event_name: 'SessionEnd';
}

/**
 * Union of all hook events
 */
export type HookEvent = StopEvent | ToolEvent | SessionStartEvent | SessionEndEvent;

/**
 * Controller state
 */
export type HooksControllerState =
  | 'idle'              // Not running
  | 'monitoring'        // Waiting for hook events
  | 'processing'        // Handling an event
  | 'calling_supervisor' // Awaiting supervisor decision
  | 'injecting'         // Writing command to PTY
  | 'stopped';          // Gracefully stopped

/**
 * Tool history entry for tracking
 */
export interface ToolHistoryEntry {
  timestamp: Date;
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  error?: string;
}

/**
 * Statistics tracked during execution
 */
export interface HooksStats {
  /** Number of Stop events received */
  stopEvents: number;
  /** Number of tool calls tracked */
  toolCalls: number;
  /** Number of supervisor calls */
  supervisorCalls: number;
  /** Number of commands injected */
  commandsInjected: number;
  /** Number of errors detected */
  errorsDetected: number;
  /** Start time */
  startTime: Date;
  /** End time (null if still running) */
  endTime: Date | null;
}

/**
 * Event handler callbacks for hooks controller
 */
export interface HooksEventHandler {
  /** Called when a Stop event is received */
  onStop?: (event: StopEvent) => void;
  /** Called when a tool event is received */
  onTool?: (event: ToolEvent) => void;
  /** Called when session starts */
  onSessionStart?: (event: SessionStartEvent) => void;
  /** Called when session ends */
  onSessionEnd?: (event: SessionEndEvent) => void;
  /** Called when supervisor is invoked */
  onSupervisorCall?: (context: { toolHistory: ToolHistoryEntry[] }) => void;
  /** Called when supervisor returns decision */
  onSupervisorDecision?: (decision: SupervisorDecision) => void;
  /** Called when command is injected */
  onInject?: (command: string) => void;
  /** Called when controller stops */
  onControllerStop?: (reason: string) => void;
  /** Called on controller error */
  onError?: (error: Error) => void;
}

/**
 * Supervisor decision types
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
