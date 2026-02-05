import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// WebSocket message types matching the broadcaster
interface WSMessage {
  type: string;
  timestamp: string;
  data: unknown;
}

interface SessionStateData {
  sessionState: { status: string; taskDescription?: string };
  metadata: { taskDescription: string; runtime: number } | null;
  controllerState: string;
  stats: {
    stopEvents: number;
    toolCalls: number;
    supervisorCalls: number;
    commandsInjected: number;
    errorsDetected: number;
  };
  decoupled?: boolean;
  claudeRunning?: boolean;
}

interface HookEventData {
  eventType: string;
  event: { tool_name?: string; session_id?: string; reason?: string };
}

interface SupervisorCallData {
  toolCount: number;
  recentTools: string[];
}

interface SupervisorDecisionData {
  decision: { action: string; reason: string; confidence: number; command?: string };
}

interface CommandInjectData {
  command: string;
}

interface PTYOutputData {
  output: string; // Clean text (ANSI stripped)
  raw?: string; // Base64 raw output (for terminal rendering if needed)
}

interface IterationUpdateData {
  current: number;
  max: number;
  percentage: number;
  consecutiveFailures: number;
}

// Tool history entry from hook events
interface ToolHistoryEntry {
  id: number;
  timestamp: string;
  toolName: string;
  input: unknown;
  output?: string;
  error?: string;
}

// Event log entry
interface EventLogEntry {
  id: number;
  timestamp: string;
  type: "hook" | "supervisor" | "inject" | "error";
  title: string;
  detail: string;
  transcriptPath?: string;
}

// Decision history entry
interface DecisionHistoryEntry {
  id: number;
  timestamp: string;
  action: string;
  reason: string;
  confidence: number;
}

// Transcript line from JSONL
interface TranscriptLine {
  [key: string]: unknown;
}

// Custom hook for WebSocket connection
function useWebSocket(url: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [sessionState, setSessionState] = useState<SessionStateData | null>(
    null
  );
  const [terminalOutput, setTerminalOutput] = useState("");
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [iterationData, setIterationData] = useState<IterationUpdateData | null>(null);
  const [decisionHistory, setDecisionHistory] = useState<DecisionHistoryEntry[]>([]);
  const [toolHistory, setToolHistory] = useState<ToolHistoryEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const eventIdRef = useRef(0);
  const toolIdRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const addEvent = useCallback(
    (type: EventLogEntry["type"], title: string, detail: string, transcriptPath?: string) => {
      setEvents((prev) => {
        const newEvent: EventLogEntry = {
          id: eventIdRef.current++,
          timestamp: new Date().toISOString(),
          type,
          title,
          detail,
          transcriptPath,
        };
        // Keep last 50 events
        return [newEvent, ...prev].slice(0, 50);
      });
    },
    []
  );

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      console.log("[WS] Connected");
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.log("[WS] Disconnected, reconnecting in 2s...");
      reconnectTimeoutRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = (error) => {
      console.error("[WS] Error:", error);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;

        switch (msg.type) {
          case "session_state":
            setSessionState(msg.data as SessionStateData);
            break;

          case "pty_output": {
            // output is now clean text (ANSI stripped)
            const { output } = msg.data as PTYOutputData;
            setTerminalOutput((prev) => {
              // Keep last 100KB of output
              const combined = prev + output;
              if (combined.length > 100000) {
                return combined.slice(-100000);
              }
              return combined;
            });
            break;
          }

          case "iteration_update":
            setIterationData(msg.data as IterationUpdateData);
            break;

          case "hook_event": {
            const { eventType, event } = msg.data as HookEventData;
            let detail = "";
            const evt = event as Record<string, unknown>;

            switch (eventType) {
              case "stop":
                detail = evt.transcript_path
                  ? `Transcript: ${String(evt.transcript_path).split("/").pop()}`
                  : "Claude finished responding";
                break;
              case "tool": {
                const hasError = evt.tool_response && (evt.tool_response as Record<string, unknown>).error;
                detail = evt.tool_name
                  ? `Tool: ${evt.tool_name}${hasError ? " (ERROR)" : ""}`
                  : "Tool executed";
                // Add to tool history
                const toolResp = evt.tool_response as Record<string, unknown> | undefined;
                setToolHistory(prev => [{
                  id: toolIdRef.current++,
                  timestamp: new Date().toISOString(),
                  toolName: String(evt.tool_name || 'unknown'),
                  input: evt.tool_input,
                  output: toolResp?.output ? String(toolResp.output) : undefined,
                  error: toolResp?.error ? String(toolResp.error) : undefined,
                }, ...prev].slice(0, 50));
                break;
              }
              case "session-start":
                detail = `Source: ${evt.source || "unknown"}`;
                break;
              case "session-end":
                detail = evt.reason ? String(evt.reason) : "Session ended";
                break;
              default:
                detail = evt.session_id
                  ? `Session: ${String(evt.session_id).slice(0, 8)}...`
                  : "";
            }
            const transcriptPath = eventType === "stop" && evt.transcript_path
              ? String(evt.transcript_path)
              : undefined;
            addEvent("hook", `Hook: ${eventType}`, detail, transcriptPath);
            break;
          }

          case "supervisor_call": {
            const { toolCount, recentTools } = msg.data as SupervisorCallData;
            addEvent(
              "supervisor",
              "Supervisor Called",
              `${toolCount} tools, recent: ${recentTools.join(", ")}`
            );
            break;
          }

          case "supervisor_decision": {
            const { decision } = msg.data as SupervisorDecisionData;
            addEvent(
              "supervisor",
              `Decision: ${decision.action}`,
              `${decision.reason} (${(decision.confidence * 100).toFixed(0)}%)`
            );
            // Add to decision history
            setDecisionHistory(prev => [{
              id: Date.now(),
              timestamp: new Date().toISOString(),
              action: decision.action,
              reason: decision.reason,
              confidence: decision.confidence,
            }, ...prev].slice(0, 10));
            break;
          }

          case "command_inject": {
            const { command } = msg.data as CommandInjectData;
            addEvent("inject", "Command Injected", command);
            break;
          }

          case "error": {
            const { message } = msg.data as { message: string };
            addEvent("error", "Error", message);
            break;
          }
        }
      } catch (err) {
        console.error("[WS] Parse error:", err);
      }
    };
  }, [url, addEvent]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  // Ping keepalive
  useEffect(() => {
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send("ping");
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return { isConnected, sessionState, terminalOutput, events, iterationData, decisionHistory, toolHistory };
}

// Format runtime
function formatRuntime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

// Format timestamp
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

// Iteration Progress Component
function IterationProgress({ data }: { data: IterationUpdateData | null }) {
  if (!data) return null;

  const { current, max, percentage, consecutiveFailures } = data;
  const isNearLimit = percentage > 80;
  const hasFailures = consecutiveFailures > 0;

  return (
    <div className="iteration-progress">
      <div className="iteration-header">
        <span className="iteration-label">Iteration</span>
        <span className="iteration-count">{current} / {max}</span>
      </div>
      <div className="progress-bar-container">
        <div
          className={`progress-bar ${isNearLimit ? 'warning' : ''}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      {hasFailures && (
        <div className="failure-warning">
          {consecutiveFailures} consecutive failure(s)
        </div>
      )}
    </div>
  );
}

// Control Panel Component
function ControlPanel({
  isPaused,
  onInject,
  onPause,
  onResume,
  onStop
}: {
  isPaused: boolean;
  onInject: (cmd: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const [command, setCommand] = useState("");

  const handleInject = () => {
    if (command.trim()) {
      onInject(command);
      setCommand("");
    }
  };

  return (
    <div className="panel control-panel">
      <div className="panel-header">Controls</div>
      <div className="panel-content">
        <div className="inject-row">
          <input
            type="text"
            className="inject-input"
            placeholder="Command to inject..."
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleInject()}
          />
          <button className="inject-button" onClick={handleInject}>
            Inject
          </button>
        </div>
        <div className="control-buttons">
          {isPaused ? (
            <button className="control-btn resume" onClick={onResume}>
              Resume
            </button>
          ) : (
            <button className="control-btn pause" onClick={onPause}>
              Pause
            </button>
          )}
          <button className="control-btn stop" onClick={onStop}>
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}

// Supervisor Panel Component
function SupervisorPanel({
  iterationData,
  decisionHistory,
  controllerState
}: {
  iterationData: IterationUpdateData | null;
  decisionHistory: DecisionHistoryEntry[];
  controllerState: string;
}) {
  return (
    <div className="panel supervisor-panel">
      <div className="panel-header">Supervisor</div>
      <div className="panel-content">
        <div className="supervisor-state">
          <span className={`state-indicator ${controllerState}`} />
          <span>{controllerState}</span>
        </div>

        <IterationProgress data={iterationData} />

        <div className="decision-history">
          <div className="history-title">Recent Decisions</div>
          {decisionHistory.length === 0 ? (
            <div className="empty-state small">No decisions yet</div>
          ) : (
            decisionHistory.map(d => (
              <div key={d.id} className={`decision-item ${d.action}`}>
                <div className="decision-header">
                  <span className="decision-action">{d.action}</span>
                  <span className="decision-time">{formatTime(d.timestamp)}</span>
                </div>
                <div className="decision-reason">{d.reason}</div>
                <div className="confidence-bar-container">
                  <div
                    className="confidence-bar"
                    style={{ width: `${d.confidence * 100}%` }}
                  />
                  <span className="confidence-value">{(d.confidence * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Tool History Panel Component
function ToolHistoryPanel({ tools }: { tools: ToolHistoryEntry[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="panel tool-history-panel">
      <div className="panel-header">Tool History ({tools.length})</div>
      <div className="panel-content">
        {tools.length === 0 ? (
          <div className="empty-state small">No tools executed</div>
        ) : (
          tools.slice(0, 20).map((tool) => (
            <div
              key={tool.id}
              className={`tool-item ${tool.error ? 'error' : ''} ${expandedId === tool.id ? 'expanded' : ''}`}
              onClick={() => setExpandedId(expandedId === tool.id ? null : tool.id)}
            >
              <div className="tool-header">
                <span className="tool-name">{tool.toolName}</span>
                <span className={`tool-status ${tool.error ? 'error' : 'success'}`}>
                  {tool.error ? 'ERROR' : 'OK'}
                </span>
              </div>
              {expandedId === tool.id && (
                <div className="tool-details">
                  <div className="tool-section">
                    <div className="section-label">Input:</div>
                    <pre className="section-content">{JSON.stringify(tool.input, null, 2)}</pre>
                  </div>
                  {tool.output && (
                    <div className="tool-section">
                      <div className="section-label">Output:</div>
                      <pre className="section-content">{tool.output.slice(0, 500)}{tool.output.length > 500 ? '...' : ''}</pre>
                    </div>
                  )}
                  {tool.error && (
                    <div className="tool-section error">
                      <div className="section-label">Error:</div>
                      <pre className="section-content">{tool.error}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Session Panel Component
function SessionPanel({ data }: { data: SessionStateData | null }) {
  if (!data) {
    return (
      <div className="panel">
        <div className="panel-header">Session</div>
        <div className="panel-content">
          <div className="empty-state">Waiting for data...</div>
        </div>
      </div>
    );
  }

  const { sessionState, metadata, controllerState, stats } = data;

  return (
    <div className="panel">
      <div className="panel-header">Session</div>
      <div className="panel-content">
        <div className="session-info">
          <div className="info-row">
            <span className="info-label">Session State</span>
            <span className={`status-badge ${sessionState.status}`}>
              {sessionState.status}
            </span>
          </div>

          <div className="info-row">
            <span className="info-label">Controller</span>
            <span className={`status-badge ${controllerState}`}>
              {controllerState}
            </span>
          </div>

          {metadata && (
            <div className="info-row">
              <span className="info-label">Runtime</span>
              <span className="info-value">{formatRuntime(metadata.runtime)}</span>
            </div>
          )}

          {metadata?.taskDescription && (
            <div className="task-description">{metadata.taskDescription}</div>
          )}

          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-value">{stats.toolCalls}</div>
              <div className="stat-label">Tools</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">{stats.supervisorCalls}</div>
              <div className="stat-label">Supervisor</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">{stats.commandsInjected}</div>
              <div className="stat-label">Injected</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">{stats.errorsDetected}</div>
              <div className="stat-label">Errors</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Terminal Panel Component
function TerminalPanel({ output }: { output: string }) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(true);

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (terminalRef.current && shouldScrollRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [output]);

  // Track if user has scrolled up
  const handleScroll = () => {
    if (terminalRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      shouldScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
    }
  };

  return (
    <div className="panel terminal-panel">
      <div className="panel-header">Terminal Output</div>
      <div
        className="terminal panel-content"
        ref={terminalRef}
        onScroll={handleScroll}
      >
        {output || <span className="empty-state">No output yet...</span>}
      </div>
    </div>
  );
}

// Transcript Modal Component
function TranscriptModal({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTranscript = async () => {
      try {
        const res = await fetch(
          `/api/transcript?path=${encodeURIComponent(path)}`
        );
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setLines(data.lines);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };
    fetchTranscript();
  }, [path]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const filename = path.split("/").pop() || path;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{filename}</span>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          {loading && <div className="empty-state">Loading transcript...</div>}
          {error && <div className="modal-error">{error}</div>}
          {!loading && !error && (
            <div className="transcript-lines">
              {lines.map((line, i) => (
                <pre key={i} className="transcript-line">
                  {JSON.stringify(line, null, 2)}
                </pre>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Event Log Panel Component
function EventLogPanel({ events }: { events: EventLogEntry[] }) {
  const [transcriptPath, setTranscriptPath] = useState<string | null>(null);

  return (
    <div className="panel event-log-panel">
      <div className="panel-header">Event Log</div>
      <div className="panel-content">
        {events.length === 0 ? (
          <div className="empty-state small">No events yet...</div>
        ) : (
          <div className="event-log">
            {events.map((event) => (
              <div
                key={event.id}
                className={`event-item ${event.type}${event.transcriptPath ? " clickable" : ""}`}
                onClick={
                  event.transcriptPath
                    ? () => setTranscriptPath(event.transcriptPath!)
                    : undefined
                }
              >
                <div className="event-time">{formatTime(event.timestamp)}</div>
                <div className="event-type">{event.title}</div>
                {event.detail && (
                  <div className="event-detail">{event.detail}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {transcriptPath && (
        <TranscriptModal
          path={transcriptPath}
          onClose={() => setTranscriptPath(null)}
        />
      )}
    </div>
  );
}

// Launch Panel Component (decouple mode)
function LaunchPanel({ onLaunched }: { onLaunched: () => void }) {
  const [task, setTask] = useState("");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLaunch = async () => {
    setLaunching(true);
    setError(null);
    try {
      const res = await fetch("/api/claude/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: task || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onLaunched();
    } catch (err) {
      setError(String(err));
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="panel launch-panel-wrapper">
      <div className="panel-header">Launch Claude</div>
      <div className="panel-content">
        <div className="launch-panel">
          <input
            type="text"
            className="launch-input"
            placeholder="Task description (optional)"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !launching) handleLaunch();
            }}
            disabled={launching}
          />
          <button
            className="launch-button"
            onClick={handleLaunch}
            disabled={launching}
          >
            {launching ? "Launching..." : "Launch Claude"}
          </button>
          {error && <div className="launch-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}

// Main App Component
function App() {
  const wsUrl = `ws://${window.location.host}/ws`;
  const { isConnected, sessionState, terminalOutput, events, iterationData, decisionHistory, toolHistory } =
    useWebSocket(wsUrl);
  const [launched, setLaunched] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const isDecoupled = sessionState?.decoupled ?? false;
  const claudeRunning = sessionState?.claudeRunning ?? false;
  const showLaunchPanel = isDecoupled && !claudeRunning && !launched;

  // Control handlers
  const handleInject = async (cmd: string) => {
    try {
      await fetch("/api/control/inject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
    } catch (err) {
      console.error("Failed to inject:", err);
    }
  };

  const handlePause = async () => {
    try {
      await fetch("/api/control/pause", { method: "POST" });
      setIsPaused(true);
    } catch (err) {
      console.error("Failed to pause:", err);
    }
  };

  const handleResume = async () => {
    try {
      await fetch("/api/control/resume", { method: "POST" });
      setIsPaused(false);
    } catch (err) {
      console.error("Failed to resume:", err);
    }
  };

  const handleStop = async () => {
    try {
      await fetch("/api/control/stop", { method: "POST" });
    } catch (err) {
      console.error("Failed to stop:", err);
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>CCO Monitor</h1>
        <div className="connection-indicator">
          {isDecoupled && (
            <span className="mode-badge">DECOUPLED</span>
          )}
          {isPaused && (
            <span className="mode-badge paused">PAUSED</span>
          )}
          <span className={`connection-dot ${isConnected ? "connected" : ""}`} />
          <span>{isConnected ? "Connected" : "Disconnected"}</span>
        </div>
      </header>

      {showLaunchPanel && <LaunchPanel onLaunched={() => setLaunched(true)} />}

      <div className="left-column">
        <SessionPanel data={sessionState} />
        <ControlPanel
          isPaused={isPaused}
          onInject={handleInject}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
        />
      </div>

      <div className="center-column">
        <TerminalPanel output={terminalOutput} />
        <ToolHistoryPanel tools={toolHistory} />
      </div>

      <div className="right-column">
        <SupervisorPanel
          iterationData={iterationData}
          decisionHistory={decisionHistory}
          controllerState={sessionState?.controllerState || 'idle'}
        />
        <EventLogPanel events={events} />
      </div>
    </div>
  );
}

// Mount the app
const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}

export default App;
