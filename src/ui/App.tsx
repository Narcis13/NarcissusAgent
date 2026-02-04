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
  decision: { action: string; reason: string; confidence: number };
}

interface CommandInjectData {
  command: string;
}

interface PTYOutputData {
  output: string; // Clean text (ANSI stripped)
  raw?: string; // Base64 raw output (for terminal rendering if needed)
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
  const wsRef = useRef<WebSocket | null>(null);
  const eventIdRef = useRef(0);
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
              case "tool":
                detail = evt.tool_name
                  ? `Tool: ${evt.tool_name}${evt.tool_response && (evt.tool_response as Record<string, unknown>).error ? " (ERROR)" : ""}`
                  : "Tool executed";
                break;
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

  return { isConnected, sessionState, terminalOutput, events };
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
    <div className="panel">
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
    <div className="panel">
      <div className="panel-header">Event Log</div>
      <div className="panel-content">
        {events.length === 0 ? (
          <div className="empty-state">No events yet...</div>
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

// Main App Component
function App() {
  const wsUrl = `ws://${window.location.host}/ws`;
  const { isConnected, sessionState, terminalOutput, events } =
    useWebSocket(wsUrl);

  return (
    <div className="app-container">
      <header className="header">
        <h1>CCO Monitor</h1>
        <div className="connection-indicator">
          <span className={`connection-dot ${isConnected ? "connected" : ""}`} />
          <span>{isConnected ? "Connected" : "Disconnected"}</span>
        </div>
      </header>

      <SessionPanel data={sessionState} />
      <TerminalPanel output={terminalOutput} />
      <EventLogPanel events={events} />
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
