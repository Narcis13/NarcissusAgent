# Architecture Research: Terminal Orchestrator

**Researched:** 2026-01-31
**Domain:** Terminal orchestration with Bun.js
**Bun Version Required:** >= 1.3.5 (for Bun.Terminal API)

## High-Level Architecture

```
                                 ┌─────────────────────────────────────────┐
                                 │            CLI Entry Point               │
                                 │        cco "build feature X"             │
                                 └───────────────────┬─────────────────────┘
                                                     │
                                                     ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CCO Main Process (Bun.js)                            │
│                                                                                        │
│  ┌─────────────────┐         ┌─────────────────┐         ┌─────────────────────────┐  │
│  │   PTY Manager   │◄───────►│ Session Manager │◄───────►│     HTTP/WS Server      │  │
│  │                 │         │                 │         │        (Hono.js)        │  │
│  │  spawn()        │         │  state machine  │         │                         │  │
│  │  write()        │         │  transitions    │         │  GET /api/session       │  │
│  │  resize()       │         │  buffer mgmt    │         │  WS  /ws                │  │
│  │  onData()       │         │                 │         │  GET /                  │  │
│  └────────┬────────┘         └────────┬────────┘         └───────────┬─────────────┘  │
│           │                           │                               │                │
│           │                           │                               │                │
│           └───────────────────────────┼───────────────────────────────┘                │
│                                       │                                                │
│                                       ▼                                                │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                           Event Bus (TypedEventEmitter)                          │  │
│  │                                                                                  │  │
│  │   pty:data ───────────────────────────────────────────────────────► ws:broadcast │  │
│  │   pty:exit                                                                       │  │
│  │   session:state_change                                                           │  │
│  │   analyzer:detection ─────────────────────────────► supervisor:request           │  │
│  │   supervisor:decision ────────────────────────────► pty:inject                   │  │
│  │   supervisor:log ─────────────────────────────────► ws:broadcast                 │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
│           │                           │                               │                │
│           ▼                           ▼                               ▼                │
│  ┌─────────────────┐         ┌─────────────────┐         ┌─────────────────────────┐  │
│  │ Output Analyzer │         │Supervisor Agent │         │    WebSocket Hub        │  │
│  │                 │         │                 │         │                         │  │
│  │  ring buffer    │────────►│  Claude API     │────────►│  topic: terminal        │  │
│  │  ANSI strip     │         │  decision logic │         │  topic: supervisor-log  │  │
│  │  pattern match  │         │  command inject │         │  topic: session-status  │  │
│  │  confidence     │         │                 │         │                         │  │
│  └─────────────────┘         └─────────────────┘         └─────────────────────────┘  │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                                     │
                                                     │ localhost:3000
                                                     ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                  Web UI (Browser)                                      │
│                                                                                        │
│  ┌──────────────────────────────────────┐    ┌──────────────────────────────────────┐ │
│  │          Terminal View               │    │          Control Panel               │ │
│  │          (xterm.js)                  │    │                                      │ │
│  │                                      │    │   Session: ACTIVE                    │ │
│  │   WebSocket ──► AttachAddon          │    │   Supervisor: ON (conf: 85)         │ │
│  │   FitAddon for auto-resize           │    │   [/clear] [/compact] [Pause]       │ │
│  │                                      │    │                                      │ │
│  └──────────────────────────────────────┘    │   Supervisor Log:                   │ │
│                                              │   12:34:56 DETECT task_complete      │ │
│                                              │   12:34:57 DECIDE new_task           │ │
│                                              │   12:34:58 INJECT "implement..."     │ │
│                                              └──────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Primary Data Flow                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘

1. USER INPUT FLOW
   CLI argument ──► SessionManager ──► PTYManager.write() ──► Claude Code PTY

2. OUTPUT FLOW
   Claude Code PTY ──► PTYManager.onData() ──► EventBus("pty:data")
                                                    │
                        ┌───────────────────────────┼────────────────────────┐
                        ▼                           ▼                        ▼
                 RingBuffer.push()          WebSocketHub.broadcast()   OutputAnalyzer
                 (rolling 100 lines)        (to all clients)           .analyze()

3. DETECTION FLOW
   OutputAnalyzer ──► pattern match ──► confidence score ──► EventBus("analyzer:detection")
                                                                    │
                                                                    ▼
                                                            SessionManager
                                                            (state: analyzing)
                                                                    │
                                                                    ▼
                                                            SupervisorAgent
                                                            .analyzeSession()

4. SUPERVISOR FLOW
   SupervisorAgent ──► Claude API (streaming) ──► parse JSON decision
                                                        │
                                                        ▼
                                                EventBus("supervisor:decision")
                                                        │
                        ┌───────────────────────────────┼────────────────────────┐
                        ▼                               ▼                        ▼
                 SessionManager                  WebSocketHub              PTYManager
                 .transition()                   .broadcast()              .write()
                                                (supervisor-log topic)    (inject cmd)

5. WEBSOCKET FLOW (Browser)
   Browser ──► WebSocket connect ──► subscribe topics ──► receive broadcasts
                                                              │
                         ┌────────────────────────────────────┼──────────────────┐
                         ▼                                    ▼                  ▼
                   xterm.write()                      updateStatusPanel()  appendLog()
```

## Component Details

### PTY Manager

**Responsibilities:**
- Spawn Claude Code CLI process in a pseudo-terminal
- Handle bidirectional I/O (read output, write commands)
- Manage terminal dimensions (cols/rows)
- Signal process lifecycle events (data, exit, error)
- Pass through raw ANSI escape sequences for proper terminal rendering

**Interfaces:**

```typescript
interface PTYManager {
  // Lifecycle
  spawn(command: string, args?: string[]): void;
  kill(signal?: NodeJS.Signals): void;
  isRunning(): boolean;

  // I/O
  write(data: string | Uint8Array): void;

  // Terminal control
  resize(cols: number, rows: number): void;
  getDimensions(): { cols: number; rows: number };

  // Events (via EventBus)
  // Emits: "pty:data", "pty:exit", "pty:error"
}

// Bun.Terminal specific options
interface PTYSpawnOptions {
  cols: number;
  rows: number;
  env?: Record<string, string>;
  cwd?: string;
}
```

**Data Flow:**
```
Input:  write(cmd) ──────────► PTY stdin ──────────► Claude Code
Output: Claude Code ──────────► PTY stdout ────────► onData callback ──► EventBus
```

**Implementation Notes:**
- Use `Bun.spawn()` with `terminal` option (Bun >= 1.3.5)
- Set `TERM=xterm-256color` for full color support
- Default dimensions: 120 cols x 30 rows
- PTY output is raw bytes; decode as UTF-8 but preserve ANSI sequences
- The `terminal.data` callback fires for each chunk of output
- Use `terminal.write()` for injecting commands (append `\n` for execution)

**Architecture Pattern:**
Facade pattern wrapping Bun.Terminal. The PTYManager provides a simplified interface over the raw PTY APIs, handling encoding, event emission, and lifecycle management internally.

---

### Session Manager

**Responsibilities:**
- Maintain finite state machine for session lifecycle
- Coordinate between PTY, Analyzer, and Supervisor
- Manage output buffers (ring buffer + full transcript)
- Track task history and session metadata
- Handle state transitions with validation
- Emit state change events for UI updates

**State Machine:**

```
                    ┌────────────────────────────────────────────────────────┐
                    │                     State Machine                      │
                    └────────────────────────────────────────────────────────┘

                                         spawn()
                    ┌──────────────────────────────────────────────────────┐
                    │                                                      │
                    ▼                                                      │
              ┌──────────┐                                                 │
              │   IDLE   │◄────────────────────────────────────────────────┤
              └────┬─────┘                                                 │
                   │ task received (CLI arg or injected)                   │
                   ▼                                                       │
              ┌──────────────┐                                             │
              │ TASK_RUNNING │◄──────────┐                                 │
              └──────┬───────┘           │                                 │
                     │                   │                                 │
     ┌───────────────┼───────────────────┼─────────────────┐               │
     │               │                   │                 │               │
     ▼               ▼                   │                 ▼               │
 detection      pty:exit           supervisor          error             abort
 triggered     (unexpected)        decides              detected         called
     │               │             "continue"              │               │
     ▼               ▼                   │                 ▼               ▼
┌──────────┐    ┌─────────┐              │            ┌─────────┐    ┌─────────┐
│ANALYZING │    │  ERROR  │──────────────┴───────────►│  ERROR  │    │ ABORTED │
└────┬─────┘    └─────────┘                           └────┬────┘    └─────────┘
     │                                                     │               │
     │ supervisor                                          │ human_review  │
     │ decides                                             │ or recover    │
     │                                                     │               │
     ├──────── "new_task" ─────────► PTY.write() ──────────┤               │
     │                                    │                │               │
     │                                    └────────────────┼───────────────┘
     │                                                     │
     ├──────── "clear"/"compact" ──► PTY.write(/clear) ────┤
     │                                                     │
     ├──────── "wait" ─────────────► stay in ANALYZING ────┤
     │                                                     │
     ├──────── "abort" ────────────► ABORTED ──────────────┤
     │                                                     │
     └──────── "human_review" ─────► PAUSED ───────────────┘
```

**Interfaces:**

```typescript
type SessionState =
  | "idle"
  | "task_running"
  | "analyzing"
  | "injecting"
  | "paused"
  | "error"
  | "aborted";

interface SessionManager {
  // State
  readonly state: SessionState;
  readonly currentTask: string | null;
  readonly taskHistory: TaskRecord[];
  readonly metadata: SessionMetadata;

  // State transitions
  transition(to: SessionState, reason?: string): void;
  canTransition(to: SessionState): boolean;

  // Buffer management
  appendOutput(data: string): void;
  getRecentOutput(lines?: number): string;
  getFullTranscript(): string[];
  clearBuffer(): void;

  // Task tracking
  startTask(description: string): void;
  completeTask(status: "success" | "failure" | "partial"): void;

  // Events (via EventBus)
  // Emits: "session:state_change", "session:task_complete"
}

interface TaskRecord {
  id: string;
  description: string;
  status: "success" | "failure" | "partial";
  startTime: Date;
  endTime: Date;
  outputSnapshot: string; // First/last 50 lines
}

interface SessionMetadata {
  startTime: Date;
  messageCount: number;
  errorCount: number;
  supervisorDecisionCount: number;
}
```

**Buffer Management:**

```typescript
interface OutputBuffers {
  // Ring buffer for recent output (pattern matching)
  recent: RingBuffer<string>;  // Last 100 lines, stripped ANSI

  // Full transcript with ANSI (for display/replay)
  full: string[];

  // Stripped version for analysis
  stripped: string[];
}
```

**Architecture Pattern:**
State Machine pattern with event-driven transitions. The SessionManager is the central coordinator - it doesn't do the work itself but orchestrates the other components through the EventBus.

---

### Output Analyzer

**Responsibilities:**
- Consume PTY output chunks via EventBus subscription
- Maintain a sliding window (ring buffer) of recent output
- Strip ANSI codes for reliable pattern matching
- Apply detection patterns for various states (completion, error, active)
- Calculate confidence scores based on multiple signals
- Emit detection events when confidence exceeds threshold

**Pattern Matching Approach:**

```typescript
// Three-tier pattern system
const PATTERNS = {
  // Tier 1: High-confidence explicit signals
  explicit: {
    completion: [
      /I've (finished|completed|done|implemented)/i,
      /Successfully (created|updated|fixed)/i,
      /Task completed/i,
    ],
    error: [
      /^Error:/m,
      /API error/i,
      /Rate limit exceeded/i,
    ],
  },

  // Tier 2: Medium-confidence contextual signals
  contextual: {
    awaitingInput: [
      /What would you like (to do|me to do) next\?/i,
      /Would you like me to/i,
      /Is there anything else/i,
    ],
    activeWork: [
      /Reading file/i,
      /Executing/i,
      /Running:/i,
    ],
  },

  // Tier 3: Low-confidence structural signals
  structural: {
    promptReady: [
      /^>\s*$/m,
      /claude>\s*$/m,
    ],
    summary: [
      /Total cost:/i,
      /Session summary:/i,
    ],
  },
};
```

**Confidence Scoring:**

```typescript
interface ConfidenceCalculation {
  // Each signal contributes weighted points
  weights: {
    explicit_completion: 40,
    explicit_error: 45,
    awaiting_input: 30,
    prompt_ready: 20,
    no_active_work: 10,
    summary_present: 15,
  };

  // Threshold for triggering supervisor
  completionThreshold: 70;
  errorThreshold: 60;
}

function calculateConfidence(signals: DetectionSignal[]): number {
  let score = 0;
  for (const signal of signals) {
    score += WEIGHTS[signal.type];
  }
  return Math.min(score, 100);
}
```

**ANSI Handling:**

```typescript
// Use strip-ansi for cleaning
import stripAnsi from 'strip-ansi';

// Preserve certain sequences for context
const MEANINGFUL_ANSI = {
  cursorReset: /\x1b\[0G/,  // Often precedes prompt
  clearLine: /\x1b\[2K/,    // Screen manipulation
};

function prepareForAnalysis(raw: string): string {
  // Strip colors but note structural codes
  return stripAnsi(raw);
}
```

**Interfaces:**

```typescript
interface OutputAnalyzer {
  // Main entry point
  analyze(chunk: string): void;

  // Query methods
  getLastDetection(): AnalysisResult | null;
  getRecentBuffer(): string;

  // Configuration
  setThreshold(type: DetectionType, threshold: number): void;
}

interface AnalysisResult {
  type: DetectionType;
  confidence: number;
  signals: DetectionSignal[];
  timestamp: Date;
  bufferSnapshot: string;
}

type DetectionType =
  | "task_complete"
  | "awaiting_input"
  | "error"
  | "active_work"
  | "idle"
  | "unknown";

interface DetectionSignal {
  type: string;
  pattern: string;
  match: string;
  weight: number;
}
```

**Architecture Pattern:**
Pipeline pattern with Observer. Output flows through a processing pipeline (receive -> buffer -> strip -> match -> score -> emit). The Analyzer observes PTY data events and emits detection events.

---

### Supervisor Agent

**Responsibilities:**
- Receive detection events and session context
- Construct prompts with relevant transcript sections
- Call Claude API (streaming) for decision
- Parse structured JSON response
- Validate and sanitize commands before injection
- Emit decision events for logging and action
- Handle API errors with retry logic

**API Integration:**

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function analyzeSession(context: SupervisorContext): Promise<SupervisorDecision> {
  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SUPERVISOR_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: formatContext(context),
    }],
  });

  let response = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta') {
      response += event.delta.text;
    }
  }

  return parseDecision(response);
}
```

**Decision Flow:**

```
Detection Event ──► Debounce (2s) ──► Build Context
                                           │
                                           ▼
                                    ┌─────────────────┐
                                    │ Recent Output   │ (last 100 lines)
                                    │ Current Task    │
                                    │ Task History    │
                                    │ Session Metadata│
                                    └────────┬────────┘
                                             │
                                             ▼
                                    Claude API (streaming)
                                             │
                                             ▼
                                    Parse JSON Response
                                             │
                                             ▼
                                    Validate Decision
                                             │
                        ┌────────────────────┼────────────────────┐
                        ▼                    ▼                    ▼
                   Valid JSON           Invalid JSON         API Error
                        │                    │                    │
                        ▼                    ▼                    ▼
               Execute Decision      Retry (max 3)      Emit Error Event
                        │                    │                    │
                        ▼                    ▼                    ▼
               Emit Decision Event    Fallback: wait      Human Review
```

**Command Injection:**

```typescript
interface CommandInjector {
  // Validate before injection
  validate(command: string): ValidationResult;

  // Safe injection with escaping
  inject(command: string): void;
}

// Safety checks
const DANGEROUS_PATTERNS = [
  /[;&|`$]/,           // Shell operators
  /rm\s+-rf/i,         // Destructive
  /sudo/i,             // Privilege escalation
  />\s*\/etc/i,        // System file writes
  /curl.*\|.*sh/i,     // Pipe to shell
];

function validateCommand(cmd: string): boolean {
  // Allow known safe commands
  if (['/clear', '/compact', '/cost', '/help'].includes(cmd)) {
    return true;
  }
  // Block dangerous patterns
  return !DANGEROUS_PATTERNS.some(p => p.test(cmd));
}
```

**Interfaces:**

```typescript
interface SupervisorAgent {
  // Main analysis
  analyzeSession(context: SupervisorContext): Promise<SupervisorDecision>;

  // Control
  enable(): void;
  disable(): void;
  isEnabled(): boolean;

  // Configuration
  setModel(model: string): void;
  setConfidenceThreshold(threshold: number): void;
}

interface SupervisorContext {
  transcript: string;           // Recent output (stripped)
  fullTranscript?: string;      // Complete session
  currentTask?: string;
  taskHistory: TaskRecord[];
  sessionMetadata: SessionMetadata;
  lastDetection: AnalysisResult;
}

interface SupervisorDecision {
  action: SupervisorAction;
  commands: string[];
  reasoning: string;
  confidence: number;
  taskStatus?: "success" | "failure" | "in_progress" | "unknown";
  suggestedNextTask?: string;
}

type SupervisorAction =
  | "continue"
  | "new_task"
  | "clear"
  | "compact"
  | "abort"
  | "wait"
  | "human_review";
```

**Architecture Pattern:**
Agent pattern with Strategy. The Supervisor acts as an intelligent agent making decisions based on context. The decision logic could be swapped (different prompts, different models) without changing the interface.

---

### HTTP/WebSocket Server

**Responsibilities:**
- Serve static web UI files
- Provide REST API for session control
- Manage WebSocket connections with topic-based pub/sub
- Broadcast real-time events to connected clients
- Handle client commands and relay to appropriate components

**Route Structure:**

```typescript
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';

const app = new Hono();

// REST API
app.get('/api/session', getSessionStatus);
app.post('/api/session/start', startSession);
app.post('/api/session/stop', stopSession);
app.get('/api/supervisor', getSupervisorStatus);
app.post('/api/supervisor/toggle', toggleSupervisor);
app.post('/api/command', sendCommand);
app.post('/api/abort', abortSession);

// WebSocket endpoint
app.get('/ws', upgradeWebSocket((c) => ({
  onOpen(event, ws) {
    // Subscribe to topics
    ws.raw.subscribe('terminal');
    ws.raw.subscribe('supervisor-log');
    ws.raw.subscribe('session-status');

    // Send initial state
    ws.send(JSON.stringify({
      type: 'connected',
      session: getSessionState(),
    }));
  },

  onMessage(event, ws) {
    handleClientMessage(ws, JSON.parse(event.data));
  },

  onClose() {
    // Cleanup subscriptions
  },
})));

// Static files
app.get('/*', serveStatic({ root: './public' }));
```

**Real-Time Streaming:**

```typescript
// Server-side broadcasting
class WebSocketHub {
  private server: Bun.Server;

  broadcast(topic: string, data: unknown): void {
    this.server.publish(topic, JSON.stringify(data));
  }

  // Topic-specific broadcasts
  broadcastTerminalData(data: string): void {
    this.broadcast('terminal', { type: 'pty:data', data });
  }

  broadcastSupervisorLog(entry: LogEntry): void {
    this.broadcast('supervisor-log', { type: 'supervisor:log', entry });
  }

  broadcastSessionStatus(status: SessionStatus): void {
    this.broadcast('session-status', { type: 'session:state', status });
  }
}
```

**Client Protocol:**

```typescript
// Server -> Client
type ServerMessage =
  | { type: 'connected'; session: SessionStatus }
  | { type: 'pty:data'; data: string }
  | { type: 'pty:exit'; code: number }
  | { type: 'session:state'; status: SessionStatus }
  | { type: 'supervisor:log'; entry: LogEntry }
  | { type: 'supervisor:decision'; decision: SupervisorDecision }
  | { type: 'error'; message: string };

// Client -> Server
type ClientMessage =
  | { type: 'pty:input'; data: string }
  | { type: 'pty:resize'; cols: number; rows: number }
  | { type: 'supervisor:toggle'; enabled: boolean }
  | { type: 'command:clear' }
  | { type: 'command:compact' }
  | { type: 'command:abort' };
```

**Architecture Pattern:**
Publisher-Subscriber with WebSocket topics. Bun's native pub/sub via `ws.raw.subscribe()` and `server.publish()` provides efficient multicasting without manual connection tracking.

---

## Build Order

Based on dependency analysis, build components in this order:

### Phase 1: Foundation (No dependencies)

```
1. EventBus (event-bus.ts)
   - TypedEventEmitter with type-safe events
   - Zero dependencies, used by everything
   - Build first, test in isolation

2. RingBuffer (buffer.ts)
   - Generic circular buffer implementation
   - Zero dependencies
   - Unit test thoroughly

3. Types (types/index.ts)
   - All shared interfaces and types
   - No runtime code
```

### Phase 2: Core I/O (Depends on: EventBus)

```
4. PTYManager (core/pty-manager.ts)
   - Depends on: EventBus, Types
   - Wrap Bun.Terminal API
   - Test with simple shell commands first

   Verification: Can spawn `echo "hello"` and receive output via event
```

### Phase 3: State Management (Depends on: EventBus, RingBuffer)

```
5. SessionManager (core/session-manager.ts)
   - Depends on: EventBus, RingBuffer, Types
   - Implement state machine
   - Connect to PTY events

   Verification: State transitions work, output buffered correctly
```

### Phase 4: Analysis (Depends on: EventBus, RingBuffer)

```
6. OutputAnalyzer (detection/analyzer.ts)
   - Depends on: EventBus, RingBuffer, Types
   - Build patterns incrementally
   - Test with captured Claude Code output samples

7. ANSI utilities (detection/ansi.ts)
   - strip-ansi wrapper
   - ANSI-aware line splitting

   Verification: Can detect task completion in sample transcripts
```

### Phase 5: Supervisor (Depends on: EventBus, Analyzer)

```
8. SupervisorAgent (supervisor/agent.ts)
   - Depends on: EventBus, Types, Anthropic SDK
   - Build prompt, test API calls
   - Add decision parsing

   Verification: Given sample transcript, returns valid decision JSON
```

### Phase 6: HTTP Layer (Depends on: Everything)

```
9. HTTP Server (server/app.ts)
   - Depends on: All core components
   - Build REST routes first
   - Add WebSocket last

10. WebSocket Hub (server/websocket.ts)
    - Depends on: EventBus, SessionManager
    - Connect event bus to broadcast

    Verification: WebSocket clients receive real-time PTY output
```

### Phase 7: Integration (Full system)

```
11. Main Entry (index.ts)
    - Wire everything together
    - CLI argument parsing
    - Configuration loading

12. Web UI (public/*)
    - xterm.js terminal
    - Status panel
    - Supervisor log
```

### Dependency Graph

```
                    Types
                      │
                      ▼
              ┌───────────────┐
              │   EventBus    │◄──────────────────────────────────┐
              └───────┬───────┘                                   │
                      │                                           │
         ┌────────────┼────────────┐                              │
         ▼            ▼            ▼                              │
   ┌──────────┐ ┌──────────┐ ┌──────────┐                         │
   │RingBuffer│ │PTYManager│ │   ANSI   │                         │
   └────┬─────┘ └────┬─────┘ └────┬─────┘                         │
        │            │            │                               │
        │            ▼            │                               │
        │     ┌──────────────┐    │                               │
        └────►│SessionManager│◄───┘                               │
              └──────┬───────┘                                    │
                     │                                            │
                     ▼                                            │
              ┌──────────────┐                                    │
              │OutputAnalyzer│                                    │
              └──────┬───────┘                                    │
                     │                                            │
                     ▼                                            │
              ┌──────────────┐         ┌──────────────────┐       │
              │  Supervisor  │────────►│  Anthropic SDK   │       │
              └──────┬───────┘         └──────────────────┘       │
                     │                                            │
                     ▼                                            │
              ┌──────────────┐         ┌──────────────────┐       │
              │  HTTP Server │────────►│      Hono        │       │
              └──────┬───────┘         └──────────────────┘       │
                     │                                            │
                     ▼                                            │
              ┌──────────────┐                                    │
              │WebSocket Hub │────────────────────────────────────┘
              └──────────────┘
```

---

## Key Interfaces

```typescript
// ============================================
// Event System
// ============================================

interface TypedEvents {
  // PTY events
  'pty:data': { data: string; raw: Uint8Array };
  'pty:exit': { code: number; signal?: string };
  'pty:error': { error: Error };

  // Session events
  'session:state_change': { from: SessionState; to: SessionState; reason?: string };
  'session:task_start': { task: TaskRecord };
  'session:task_complete': { task: TaskRecord };

  // Analyzer events
  'analyzer:detection': { result: AnalysisResult };

  // Supervisor events
  'supervisor:request': { context: SupervisorContext };
  'supervisor:decision': { decision: SupervisorDecision };
  'supervisor:log': { entry: LogEntry };
  'supervisor:error': { error: Error };

  // WebSocket events
  'ws:client_connected': { clientId: string };
  'ws:client_disconnected': { clientId: string };
  'ws:client_message': { clientId: string; message: ClientMessage };
}

type EventCallback<T> = (payload: T) => void;

interface EventBus {
  on<K extends keyof TypedEvents>(event: K, callback: EventCallback<TypedEvents[K]>): void;
  off<K extends keyof TypedEvents>(event: K, callback: EventCallback<TypedEvents[K]>): void;
  emit<K extends keyof TypedEvents>(event: K, payload: TypedEvents[K]>): void;
  once<K extends keyof TypedEvents>(event: K, callback: EventCallback<TypedEvents[K]>): void;
}

// ============================================
// Core Components
// ============================================

interface PTYManager {
  spawn(command: string, args?: string[], options?: PTYSpawnOptions): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: NodeJS.Signals): void;
  isRunning(): boolean;
  getDimensions(): { cols: number; rows: number };
}

interface SessionManager {
  readonly state: SessionState;
  readonly currentTask: string | null;
  readonly taskHistory: TaskRecord[];
  readonly metadata: SessionMetadata;

  transition(to: SessionState, reason?: string): void;
  appendOutput(data: string): void;
  getRecentOutput(lines?: number): string;
  getFullTranscript(): string[];
  startTask(description: string): void;
  completeTask(status: TaskStatus): void;
}

interface OutputAnalyzer {
  analyze(chunk: string): void;
  getLastDetection(): AnalysisResult | null;
  setThreshold(type: DetectionType, threshold: number): void;
}

interface SupervisorAgent {
  analyzeSession(context: SupervisorContext): Promise<SupervisorDecision>;
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
}

interface WebSocketHub {
  broadcast(topic: string, data: unknown): void;
  broadcastTerminalData(data: string): void;
  broadcastSupervisorLog(entry: LogEntry): void;
  broadcastSessionStatus(status: SessionStatus): void;
}

// ============================================
// Data Types
// ============================================

type SessionState =
  | 'idle'
  | 'task_running'
  | 'analyzing'
  | 'injecting'
  | 'paused'
  | 'error'
  | 'aborted';

type DetectionType =
  | 'task_complete'
  | 'awaiting_input'
  | 'error'
  | 'active_work'
  | 'idle'
  | 'unknown';

type SupervisorAction =
  | 'continue'
  | 'new_task'
  | 'clear'
  | 'compact'
  | 'abort'
  | 'wait'
  | 'human_review';

type TaskStatus = 'success' | 'failure' | 'partial';

interface TaskRecord {
  id: string;
  description: string;
  status: TaskStatus;
  startTime: Date;
  endTime: Date;
}

interface AnalysisResult {
  type: DetectionType;
  confidence: number;
  signals: DetectionSignal[];
  timestamp: Date;
}

interface SupervisorDecision {
  action: SupervisorAction;
  commands: string[];
  reasoning: string;
  confidence: number;
  taskStatus?: TaskStatus | 'in_progress' | 'unknown';
}

interface LogEntry {
  timestamp: Date;
  type: 'detect' | 'analyze' | 'decide' | 'inject' | 'error' | 'info';
  message: string;
  metadata?: Record<string, unknown>;
}

interface SessionStatus {
  state: SessionState;
  currentTask: string | null;
  taskCount: number;
  errorCount: number;
  runtime: number; // ms
  supervisorEnabled: boolean;
  lastDecision: SupervisorDecision | null;
}

// ============================================
// Configuration
// ============================================

interface Config {
  server: {
    port: number;
    host: string;
  };
  pty: {
    command: string;
    args: string[];
    cols: number;
    rows: number;
    env: Record<string, string>;
  };
  supervisor: {
    enabled: boolean;
    model: string;
    confidenceThreshold: number;
    debounceMs: number;
    maxRetries: number;
  };
  detection: {
    completionThreshold: number;
    errorThreshold: number;
    bufferLines: number;
  };
}

// ============================================
// Ring Buffer
// ============================================

interface RingBuffer<T> {
  push(item: T): void;
  toArray(): T[];
  clear(): void;
  readonly length: number;
  readonly capacity: number;
  get(index: number): T | undefined;
  peek(): T | undefined;  // Most recent
}
```

---

## References

### PTY and Terminal
- [Bun v1.3.5 Terminal API](https://bun.com/blog/bun-v1.3.5)
- [Microsoft node-pty](https://github.com/microsoft/node-pty)
- [tmux Client-Server Architecture](https://man7.org/linux/man-pages/man1/tmux.1.html)
- [xterm.js Terminal Emulator](https://xtermjs.org/)

### Event-Driven Architecture
- [Event Bus Pattern - This Dot Labs](https://www.thisdot.co/blog/how-to-implement-an-event-bus-in-typescript)
- [TypeScript Pub/Sub Patterns](https://softwarepatternslexicon.com/patterns-ts/6/13/)
- [Event-Based Architectures in JavaScript](https://www.freecodecamp.org/news/event-based-architectures-in-javascript-a-handbook-for-devs/)

### Real-Time WebSocket
- [Bun WebSocket Documentation](https://bun.sh/docs/api/websockets)
- [Hono WebSocket Helper](https://hono.dev/docs/helpers/websocket)
- [Real-Time Streaming with Node.js](https://www.aegissofttech.com/insights/data-streaming-with-node-js/)

### State Machines
- [TypeState - Strongly Typed FSM](https://github.com/eonarheim/TypeState)
- [State Pattern in TypeScript](https://softwarepatternslexicon.com/patterns-ts/6/8/3/)

### Ring Buffers
- [Ring Buffer in TypeScript](https://www.tuckerleach.com/blog/ring-buffer)
- [ring-buffer-ts npm Package](https://www.npmjs.com/package/ring-buffer-ts)

### ANSI Processing
- [strip-ansi Library](https://github.com/chalk/strip-ansi)
- [ANSI Escape Codes Reference](https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797)
- [VT100 ANSI Parser](https://vt100.net/emu/dec_ansi_parser)

### Claude API
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Agent SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)

### Multi-Agent Orchestration
- [Claude Code Official](https://github.com/anthropics/claude-code)
- [claude-flow Orchestration](https://github.com/ruvnet/claude-flow)
- [Awesome Claude Code](https://github.com/hesreallyhim/awesome-claude-code)
