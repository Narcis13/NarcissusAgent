/**
 * WebSocket Event Broadcaster
 *
 * Manages WebSocket connections and broadcasts real-time events to connected
 * clients for the monitoring UI.
 */

import type { Server, ServerWebSocket } from "bun";
import stripAnsi from "strip-ansi";

/**
 * Strip all terminal control sequences beyond what strip-ansi handles.
 * This includes OSC sequences, cursor movement, screen clearing, etc.
 */
function stripAllControlSequences(text: string): string {
  let result = stripAnsi(text);
  // OSC sequences: ESC ] ... (ST|BEL)
  result = result.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
  // Any remaining ESC sequences
  result = result.replace(/\x1b[^a-zA-Z]*[a-zA-Z]/g, "");
  // Raw control characters (keep \n \r \t)
  result = result.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  // Carriage returns (terminal overwrites)
  result = result.replace(/\r/g, "");
  // Claude Code thinking tags
  result = result.replace(/\(thinking\)/g, "");
  // Repeated dots/ellipsis from spinners
  result = result.replace(/[.…]{4,}/g, "…");
  return result;
}

/**
 * Patterns to filter out from PTY output - these are UI noise, not content
 */
const NOISE_PATTERNS = [
  // Spinner/status lines (various unicode spinners)
  /^[✶✳✢·✻✽⏺◐◓◑◒▶◆◇○●◉◎⦿⊙⊚◈❖✦✧★☆•▸▹▷▻►◂◃◄◅⏵⏴⏶⏷⟐⟡◠◡◴◵◶◷◰◱◲◳⣾⣽⣻⢿⡿⣟⣯⣷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/,
  // Thinking/pondering status lines
  /^(Thinking|Pontificating|Elucidating|Determining|Processing|Working|Reasoning|Analyzing|Considering|Reflecting|Deliberating)…?\s*$/,
  // Thinking tag fragments
  /^\(thinking\)$/,
  // Token counters and timing
  /\d+s\s*·.*tokens/,
  /esc to interrupt/,
  // Box drawing lines (decorative borders)
  /^[╭╮╰╯│─┌┐└┘├┤┬┴┼═╔╗╚╝╠╣╦╩╬]+$/,
  /^[╭╮╰╯][-─═]+[╭╮╰╯]$/,
  // UI chrome
  /^\s*\?\s+for shortcuts/,
  /IDE disconnected/,
  /Bypassing Permissions/,
  /bypass permissions on/,
  /shift\+tab to cycle/,
  /ctrl\+o to expand/,
  // Suggestion box content
  /^│\s*>\s*Try\s+".*"\s*│$/,
  // Welcome banner
  /Welcome to Claude Code/,
  /\/help for help/,
  /\/status for your current setup/,
  /\/getting-started-for-more/,
  // Empty box lines
  /^│\s*│$/,
  // Lines that are just whitespace
  /^\s*$/,
  // Version/model info noise
  /^Claude \d+\.\d+\s*\|/,
  /switched from npm to native installer/,
  /Run.*claude.*install/,
];

/**
 * Check if a line is meaningful content vs UI noise
 */
function isMeaningfulLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return false;

  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Lines starting with ⏺ are Claude's actual responses
  if (trimmed.startsWith("⏺")) return true;

  // Lines starting with ⎿ are tool results
  if (trimmed.startsWith("⎿")) return true;

  // Bullet points / list items
  if (/^[-•]\s+\w/.test(trimmed)) return true;

  // Keep lines that have actual word content
  if (/[a-zA-Z]{3,}/.test(trimmed)) return true;

  return false;
}

/**
 * Filter PTY output to extract only meaningful Claude responses
 */
function filterPTYOutput(text: string, previousLines: string[]): { filtered: string; newLines: string[] } {
  const lines = text.split("\n");
  const meaningfulLines: string[] = [];
  const updatedPreviousLines = [...previousLines];

  for (const line of lines) {
    if (isMeaningfulLine(line)) {
      const trimmed = line.trim();
      if (!updatedPreviousLines.includes(trimmed)) {
        meaningfulLines.push(trimmed);
        updatedPreviousLines.push(trimmed);
        if (updatedPreviousLines.length > 50) {
          updatedPreviousLines.shift();
        }
      }
    }
  }

  return {
    filtered: meaningfulLines.join("\n"),
    newLines: updatedPreviousLines,
  };
}

import type {
  HooksControllerState,
  HooksStats,
  StopEvent,
  ToolEvent,
  SessionStartEvent,
  SessionEndEvent,
  SupervisorDecision,
  ToolHistoryEntry,
} from "../hooks/types";
import type { SessionState, SessionMetadata } from "../session/types";

/**
 * WebSocket message types for the monitoring UI
 */
export type WSMessageType =
  | "session_state"
  | "pty_output"
  | "supervisor_pty_output"
  | "hook_event"
  | "supervisor_call"
  | "supervisor_decision"
  | "supervisor_state"
  | "command_inject"
  | "iteration_update"
  | "error"
  | "connected";

/**
 * Base WebSocket message structure
 */
export interface WSMessage {
  type: WSMessageType;
  timestamp: string;
  data: unknown;
}

/**
 * Session state message data
 */
export interface SessionStateData {
  sessionState: SessionState;
  metadata: SessionMetadata | null;
  controllerState: HooksControllerState;
  stats: HooksStats;
  decoupled?: boolean;
  claudeRunning?: boolean;
}

/**
 * PTY output message data
 */
export interface PTYOutputData {
  /** Clean text output (ANSI stripped) */
  output: string;
  /** Raw output for terminal rendering (base64 encoded) */
  raw?: string;
}

/**
 * Hook event message data
 */
export interface HookEventData {
  eventType: "stop" | "tool" | "session-start" | "session-end";
  event: StopEvent | ToolEvent | SessionStartEvent | SessionEndEvent;
}

/**
 * Supervisor call message data
 */
export interface SupervisorCallData {
  toolCount: number;
  recentTools: string[];
}

/**
 * Supervisor decision message data
 */
export interface SupervisorDecisionData {
  decision: SupervisorDecision;
}

/**
 * Command inject message data
 */
export interface CommandInjectData {
  command: string;
}

/**
 * Iteration update message data
 */
export interface IterationUpdateData {
  /** Current iteration number (1-indexed) */
  current: number;
  /** Maximum iterations allowed */
  max: number;
  /** Progress percentage (0-100) */
  percentage: number;
  /** Number of consecutive failures */
  consecutiveFailures: number;
}

/**
 * Supervisor state message data
 */
export interface SupervisorStateData {
  /** Supervisor PTY state */
  state: "stopped" | "starting" | "ready" | "processing" | "error";
}

/**
 * Supervisor PTY output message data
 */
export interface SupervisorPTYOutputData {
  /** Clean text output (ANSI stripped) */
  output: string;
}

/**
 * WebSocket data attached to each connection
 */
interface WSData {
  connectedAt: Date;
}

/**
 * EventBroadcaster manages WebSocket connections and broadcasts events
 */
export class EventBroadcaster {
  private server: Server<WSData> | null = null;
  private connections = new Set<ServerWebSocket<WSData>>();
  private previousLines: string[] = []; // Track recent lines for spinner deduplication

  /**
   * Set the server reference for WebSocket broadcasting
   */
  setServer(server: Server<WSData>): void {
    this.server = server;
  }

  /**
   * Handle new WebSocket connection
   */
  onOpen(ws: ServerWebSocket<WSData>): void {
    this.connections.add(ws);

    // Send connected confirmation
    this.sendTo(ws, {
      type: "connected",
      timestamp: new Date().toISOString(),
      data: { message: "Connected to CCO monitor" },
    });
  }

  /**
   * Handle WebSocket message (ping/pong or future commands)
   */
  onMessage(ws: ServerWebSocket<WSData>, message: string | Buffer): void {
    // Currently just echo for keepalive
    if (message === "ping") {
      ws.send("pong");
    }
  }

  /**
   * Handle WebSocket close
   */
  onClose(ws: ServerWebSocket<WSData>): void {
    this.connections.delete(ws);
  }

  /**
   * Get number of connected clients
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(message: WSMessage): void {
    const json = JSON.stringify(message);
    for (const ws of this.connections) {
      try {
        ws.send(json);
      } catch {
        // Remove dead connections
        this.connections.delete(ws);
      }
    }
  }

  /**
   * Send a message to a specific client
   */
  private sendTo(ws: ServerWebSocket<WSData>, message: WSMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      this.connections.delete(ws);
    }
  }

  /**
   * Broadcast session state update
   */
  broadcastSessionState(data: SessionStateData): void {
    this.broadcast({
      type: "session_state",
      timestamp: new Date().toISOString(),
      data,
    });
  }

  /**
   * Broadcast PTY output (ANSI stripped and spinner-deduplicated for orchestrator readability)
   */
  broadcastPTYOutput(output: Uint8Array): void {
    const decoder = new TextDecoder();
    const rawText = decoder.decode(output);
    // Strip all terminal control sequences
    const cleanText = stripAllControlSequences(rawText);

    // Filter out spinner frame repetition
    const { filtered, newLines } = filterPTYOutput(cleanText, this.previousLines);
    this.previousLines = newLines;

    // Only broadcast if there's meaningful content
    if (filtered.trim() === "") {
      return;
    }

    this.broadcast({
      type: "pty_output",
      timestamp: new Date().toISOString(),
      data: {
        output: filtered,
        raw: Buffer.from(output).toString("base64"),
      } satisfies PTYOutputData,
    });
  }

  /**
   * Broadcast hook event
   */
  broadcastHookEvent(
    eventType: HookEventData["eventType"],
    event: HookEventData["event"]
  ): void {
    this.broadcast({
      type: "hook_event",
      timestamp: new Date().toISOString(),
      data: { eventType, event } satisfies HookEventData,
    });
  }

  /**
   * Broadcast supervisor call
   */
  broadcastSupervisorCall(toolHistory: ToolHistoryEntry[]): void {
    this.broadcast({
      type: "supervisor_call",
      timestamp: new Date().toISOString(),
      data: {
        toolCount: toolHistory.length,
        recentTools: toolHistory.slice(-3).map((t) => t.toolName),
      } satisfies SupervisorCallData,
    });
  }

  /**
   * Broadcast supervisor decision
   */
  broadcastSupervisorDecision(decision: SupervisorDecision): void {
    this.broadcast({
      type: "supervisor_decision",
      timestamp: new Date().toISOString(),
      data: { decision } satisfies SupervisorDecisionData,
    });
  }

  /**
   * Broadcast command injection
   */
  broadcastCommandInject(command: string): void {
    this.broadcast({
      type: "command_inject",
      timestamp: new Date().toISOString(),
      data: { command } satisfies CommandInjectData,
    });
  }

  /**
   * Broadcast error event
   */
  broadcastError(error: Error): void {
    this.broadcast({
      type: "error",
      timestamp: new Date().toISOString(),
      data: { message: error.message, stack: error.stack },
    });
  }

  /**
   * Broadcast iteration update
   */
  broadcastIterationUpdate(data: IterationUpdateData): void {
    this.broadcast({
      type: "iteration_update",
      timestamp: new Date().toISOString(),
      data,
    });
  }

  /**
   * Broadcast supervisor state change (for interactive supervisor)
   */
  broadcastSupervisorState(state: SupervisorStateData["state"]): void {
    this.broadcast({
      type: "supervisor_state",
      timestamp: new Date().toISOString(),
      data: { state } satisfies SupervisorStateData,
    });
  }

  /**
   * Broadcast supervisor PTY output (for monitoring supervisor Claude)
   */
  broadcastSupervisorPTYOutput(output: string): void {
    // Strip control sequences for clean output
    const cleanText = stripAllControlSequences(output);

    // Filter out spinner/noise
    const { filtered } = filterPTYOutput(cleanText, []);

    // Only broadcast if there's meaningful content
    if (filtered.trim() === "") {
      return;
    }

    this.broadcast({
      type: "supervisor_pty_output",
      timestamp: new Date().toISOString(),
      data: { output: filtered } satisfies SupervisorPTYOutputData,
    });
  }
}

// Singleton instance
export const eventBroadcaster = new EventBroadcaster();
