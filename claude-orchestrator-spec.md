# Claude Code Orchestrator (CCO)

> A terminal orchestrator that runs Claude Code with AI supervisor capabilities, enabling autonomous multi-task workflows.

**Version:** 0.1.0-prototype  
**Stack:** Bun.js (TypeScript)  
**Author:** Narcis  
**Status:** Draft Specification

---

## Table of Contents

1. [Vision & Goals](#vision--goals)
2. [Architecture Overview](#architecture-overview)
3. [Core Components](#core-components)
4. [Claude Code Detection Patterns](#claude-code-detection-patterns)
5. [Supervisor Agent Design](#supervisor-agent-design)
6. [Web UI Specification](#web-ui-specification)
7. [API Specification](#api-specification)
8. [Data Models](#data-models)
9. [Implementation Plan](#implementation-plan)
10. [File Structure](#file-structure)
11. [Configuration](#configuration)
12. [Security Considerations](#security-considerations)

---

## Vision & Goals

### Vision

Create a meta-layer orchestration system that supervises Claude Code sessions, enabling:
- Autonomous task chaining without human intervention
- Quality assurance through AI-powered output analysis
- Session monitoring and control via web interface
- Seamless terminal experience matching native macOS Terminal

### Goals for Prototype

| Goal | Success Criteria |
|------|------------------|
| Native terminal feel | Full ANSI color support, proper cursor handling, real-time output |
| Reliable detection | 95%+ accuracy in detecting Claude Code task completion |
| Supervisor intelligence | Correctly decides next action based on output analysis |
| Web monitoring | Real-time session view with <100ms latency |
| Keystroke injection | Successfully send commands back to Claude Code |

### Non-Goals (Prototype)

- Multiple simultaneous sessions
- User authentication
- Persistent session history (database)
- Mobile-responsive UI

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              CCO Main Process                               │
│                                (Bun.js)                                     │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────┐ │
│  │   PTY Manager    │    │  Session Manager │    │    HTTP Server       │ │
│  │                  │    │                  │    │    (Hono.js)         │ │
│  │  - Spawn claude  │◄──►│  - State machine │◄──►│                      │ │
│  │  - Raw I/O       │    │  - Buffer mgmt   │    │  - REST API          │ │
│  │  - ANSI pass-thru│    │  - Event emitter │    │  - WebSocket         │ │
│  └────────┬─────────┘    └────────┬─────────┘    │  - Static files      │ │
│           │                       │              └──────────┬───────────┘ │
│           │                       │                         │             │
│           ▼                       ▼                         ▼             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                         Event Bus (EventEmitter)                      │ │
│  │                                                                       │ │
│  │  Events: pty:data, pty:exit, session:complete, supervisor:command     │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│           │                       │                         │             │
│           ▼                       ▼                         ▼             │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────┐ │
│  │ Output Analyzer  │    │ Supervisor Agent │    │   WebSocket Hub      │ │
│  │                  │    │                  │    │                      │ │
│  │  - Pattern match │───►│  - Claude API    │───►│  - Broadcast output  │ │
│  │  - State detect  │    │  - Decision logic│    │  - Push events       │ │
│  └──────────────────┘    └──────────────────┘    └──────────────────────┘ │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ localhost:3000
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                              Web UI (Browser)                               │
│                                                                            │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────┐ │
│  │      Terminal View          │  │         Control Panel               │ │
│  │                             │  │                                     │ │
│  │  xterm.js renderer          │  │  - Session status                   │ │
│  │  Real-time output stream    │  │  - Manual command input             │ │
│  │  ANSI color support         │  │  - Supervisor toggle                │ │
│  │                             │  │  - Task queue view                  │ │
│  └─────────────────────────────┘  └─────────────────────────────────────┘ │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. PTY Manager

Handles the pseudo-terminal interface with Claude Code.

```typescript
interface PTYManager {
  // Lifecycle
  spawn(command: string, args?: string[]): void;
  kill(signal?: string): void;
  
  // I/O
  write(data: string | Uint8Array): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (code: number) => void): void;
  
  // Terminal
  resize(cols: number, rows: number): void;
  getCols(): number;
  getRows(): number;
}
```

**Implementation Notes:**
- Use `bun-pty` or fallback to `node-pty` via Bun compatibility
- Set `TERM=xterm-256color` for full color support
- Default size: 120 cols × 30 rows (adjustable via WebSocket)

### 2. Session Manager

Manages session state and orchestration logic.

```typescript
type SessionState = 
  | "idle"           // Waiting for task
  | "task_running"   // Claude Code working
  | "analyzing"      // Supervisor analyzing output
  | "injecting"      // Sending commands back
  | "paused"         // Manual pause
  | "error";         // Error state

interface SessionManager {
  state: SessionState;
  buffer: RingBuffer<string>;
  fullTranscript: string[];
  
  // State transitions
  transition(to: SessionState): void;
  
  // Buffer management
  appendOutput(data: string): void;
  getRecentOutput(lines: number): string;
  clearBuffer(): void;
  
  // Task management
  currentTask: string | null;
  taskHistory: TaskRecord[];
}
```

### 3. Output Analyzer

Detects Claude Code states and task completion.

```typescript
interface OutputAnalyzer {
  analyze(chunk: string, context: AnalysisContext): AnalysisResult;
  
  // Detection methods
  detectTaskComplete(buffer: string): boolean;
  detectError(buffer: string): ErrorInfo | null;
  detectPromptReady(buffer: string): boolean;
  detectToolUse(buffer: string): ToolUseInfo | null;
}

interface AnalysisResult {
  detected: DetectionType;
  confidence: number;
  metadata: Record<string, unknown>;
}

type DetectionType = 
  | "task_complete"
  | "awaiting_input"
  | "error"
  | "tool_executing"
  | "idle"
  | "unknown";
```

### 4. Supervisor Agent

AI-powered decision maker using Claude API.

```typescript
interface SupervisorAgent {
  // Main analysis
  analyzeSession(transcript: string, context: SupervisorContext): Promise<SupervisorDecision>;
  
  // Decision types
  decide(analysis: AnalysisResult): Promise<SupervisorDecision>;
}

interface SupervisorDecision {
  action: "continue" | "new_task" | "clear" | "compact" | "abort" | "wait" | "human_review";
  commands: string[];
  reasoning: string;
  confidence: number;
}
```

---

## Claude Code Detection Patterns

### Terminal Output Patterns

Based on Claude Code CLI behavior, these patterns indicate different states:

#### 1. Task Completion Indicators

```typescript
const COMPLETION_PATTERNS = {
  // Direct completion statements
  explicit: [
    /I've (finished|completed|done|implemented|created|updated|fixed)/i,
    /Task (completed|done|finished)/i,
    /Successfully (created|updated|implemented|fixed|deployed)/i,
    /All (done|set|ready)/i,
  ],
  
  // Question patterns indicating ready for next input
  awaitingInput: [
    /What would you like (to do|me to do) next\?/i,
    /Would you like me to/i,
    /Do you want me to/i,
    /Is there anything else/i,
    /Let me know if/i,
    /Shall I/i,
  ],
  
  // Cost/summary display (often appears at end)
  summary: [
    /Total cost:/i,
    /Session cost:/i,
    /API calls?:/i,
  ],
};
```

#### 2. Error Indicators

```typescript
const ERROR_PATTERNS = {
  // Claude Code errors
  apiError: [
    /Error:/i,
    /Failed to/i,
    /API error/i,
    /Rate limit/i,
    /Connection (refused|failed|timeout)/i,
  ],
  
  // Tool execution errors
  toolError: [
    /Command failed/i,
    /Permission denied/i,
    /No such file/i,
    /Syntax error/i,
  ],
  
  // Claude's own error acknowledgment
  selfError: [
    /I apologize/i,
    /I made (a |an )?(mistake|error)/i,
    /Let me try again/i,
    /That didn't work/i,
  ],
};
```

#### 3. Active Work Indicators

```typescript
const ACTIVE_PATTERNS = {
  // Tool usage
  toolUse: [
    /Reading file/i,
    /Writing to/i,
    /Executing/i,
    /Running/i,
    /Searching/i,
    /Creating/i,
  ],
  
  // Thinking/processing
  thinking: [
    /Let me/i,
    /I'll/i,
    /I will/i,
    /Analyzing/i,
    /Looking at/i,
  ],
};
```

#### 4. ANSI Escape Sequences

Claude Code uses ANSI codes for formatting. Important sequences to handle:

```typescript
const ANSI_PATTERNS = {
  // Cursor to beginning of line (often used before prompts)
  cursorReset: /\x1b\[0G/,
  
  // Clear line
  clearLine: /\x1b\[2K/,
  
  // Color codes (preserve for display)
  color: /\x1b\[\d+(;\d+)*m/,
  
  // Cursor movement
  cursorMove: /\x1b\[(\d+)?[ABCD]/,
  
  // Clear screen
  clearScreen: /\x1b\[2J/,
};
```

#### 5. Prompt Detection

The Claude Code prompt pattern:

```typescript
const PROMPT_PATTERNS = {
  // Main prompt variations
  mainPrompt: [
    /^>\s*$/m,                    // Simple ">" prompt
    /claude>\s*$/m,               // "claude>" prompt
    /\x1b\[\d+m>\x1b\[0m\s*$/m,  // Colored prompt
  ],
  
  // After clearing/compacting
  freshPrompt: /^\s*>\s*$/m,
};
```

### Detection State Machine

```
┌─────────┐
│  IDLE   │◄────────────────────────────────────┐
└────┬────┘                                     │
     │ user input / injected command            │
     ▼                                          │
┌─────────┐                                     │
│ ACTIVE  │──── error detected ────►┌───────┐  │
└────┬────┘                         │ ERROR │──┘
     │                              └───────┘
     │ completion pattern + prompt ready
     ▼
┌──────────┐
│ COMPLETE │
└────┬─────┘
     │ supervisor decision
     ▼
┌──────────┐
│ANALYZING │───► next command ───► IDLE
└──────────┘
```

### Confidence Scoring

```typescript
interface DetectionConfidence {
  // Multiple signals increase confidence
  calculateConfidence(signals: DetectionSignal[]): number;
}

// Example confidence calculation
function calculateCompletionConfidence(buffer: string): number {
  let score = 0;
  
  // Explicit completion phrase: +40
  if (COMPLETION_PATTERNS.explicit.some(p => p.test(buffer))) score += 40;
  
  // Awaiting input question: +30
  if (COMPLETION_PATTERNS.awaitingInput.some(p => p.test(buffer))) score += 30;
  
  // Prompt ready: +20
  if (PROMPT_PATTERNS.mainPrompt.some(p => p.test(buffer))) score += 20;
  
  // No active tool execution: +10
  if (!ACTIVE_PATTERNS.toolUse.some(p => p.test(recentBuffer))) score += 10;
  
  return Math.min(score, 100);
}

// Threshold: 70+ confidence triggers supervisor
const COMPLETION_THRESHOLD = 70;
```

---

## Supervisor Agent Design

### System Prompt

```typescript
const SUPERVISOR_SYSTEM_PROMPT = `You are a Supervisor Agent monitoring a Claude Code session.

## Your Role
You observe the output of a Claude Code session and decide the next action. You act as an autonomous orchestrator, enabling multi-step workflows without human intervention.

## Context You Receive
- Full or recent transcript of the Claude Code session
- Current task description (if any)
- Session history (previous tasks and outcomes)
- Current orchestration state

## Decision Framework

### 1. Analyze the Output
- Did the task complete successfully?
- Were there any errors or issues?
- Is the output quality acceptable?
- Are there follow-up actions needed?

### 2. Decide Next Action
Choose ONE of these actions:

**continue** - The task needs more work, let Claude Code continue
- Use when: Claude is mid-task, asking clarifying questions, or fixing an error

**new_task** - Start a new task
- Use when: Current task is complete, provide the next task description
- Include clear, specific instructions in commands[]

**clear** - Clear the session (/clear command)
- Use when: Context is getting long, task complete, starting fresh topic

**compact** - Compact the session (/compact command)  
- Use when: Need to preserve some context but reduce size

**abort** - Stop execution
- Use when: Critical error, infinite loop detected, dangerous operation

**wait** - Do nothing, wait for more output
- Use when: Uncertain if task is complete, need more data

**human_review** - Flag for human attention
- Use when: Sensitive operation, uncertain decision, quality concerns

### 3. Confidence Level
Rate your confidence 0-100:
- 90-100: Very certain, clear signals
- 70-89: Fairly confident, proceed with action
- 50-69: Uncertain, consider waiting
- Below 50: Request human review

## Response Format
You MUST respond with valid JSON only:
{
  "action": "continue|new_task|clear|compact|abort|wait|human_review",
  "commands": ["command1", "command2"],
  "reasoning": "Brief explanation of your decision",
  "confidence": 85,
  "taskStatus": "success|failure|in_progress|unknown",
  "suggestedNextTask": "Optional: description if you recommend a follow-up"
}

## Important Rules
1. Never make up or hallucinate task results - only analyze what's in the transcript
2. Be conservative with abort - prefer wait or human_review if unsure
3. When starting new_task, be specific and clear in your commands
4. Track context length - suggest clear/compact proactively
5. If you see repeated errors (3+), recommend human_review`;
```

### Request Format

```typescript
interface SupervisorRequest {
  transcript: string;          // Recent output (last ~100 lines)
  fullTranscript?: string;     // Complete session (optional, for complex analysis)
  currentTask?: string;        // What was asked
  taskHistory: TaskRecord[];   // Previous tasks in session
  sessionMetadata: {
    startTime: string;
    messageCount: number;
    errorCount: number;
    contextLength: number;     // Approximate token count
  };
}

interface TaskRecord {
  task: string;
  status: "success" | "failure" | "partial";
  completedAt: string;
}
```

### Example Interactions

#### Example 1: Task Complete, Ready for Next

**Input Transcript:**
```
I've finished implementing the authentication middleware. Here's what I did:

1. Created `middleware/auth.ts` with JWT validation
2. Added rate limiting (100 req/min)
3. Updated routes to use the middleware

The tests are passing. What would you like to do next?

>
```

**Supervisor Response:**
```json
{
  "action": "new_task",
  "commands": ["Now implement the user registration endpoint with email verification"],
  "reasoning": "Task completed successfully - auth middleware implemented with tests passing. Ready for next task in the workflow.",
  "confidence": 95,
  "taskStatus": "success",
  "suggestedNextTask": "Implement user registration with email verification"
}
```

#### Example 2: Error Detected

**Input Transcript:**
```
Let me try to run the tests...

Running: npm test

Error: Cannot find module '../utils/helpers'
  at Object.<anonymous> (tests/auth.test.ts:3:1)

The test file is importing a module that doesn't exist. Would you like me to create the helpers file?

>
```

**Supervisor Response:**
```json
{
  "action": "continue",
  "commands": ["Yes, please create the helpers file with the necessary exports"],
  "reasoning": "Claude identified a missing module error and is asking for confirmation to fix it. Allow it to continue and resolve the issue.",
  "confidence": 90,
  "taskStatus": "in_progress"
}
```

#### Example 3: Long Context, Suggest Compact

**Input Transcript (at end of long session):**
```
Done! All 15 endpoints are now implemented and tested.

Session summary:
- Created 15 REST endpoints
- Added validation for all inputs
- Wrote 45 test cases
- Fixed 3 bugs found during testing

What's next?

>
```

**Supervisor Response:**
```json
{
  "action": "compact",
  "commands": ["/compact"],
  "reasoning": "Large task completed with 15 endpoints implemented. Context is likely long. Compacting before starting new work to maintain performance.",
  "confidence": 85,
  "taskStatus": "success",
  "suggestedNextTask": "Add API documentation with OpenAPI spec"
}
```

---

## Web UI Specification

### Technology Stack

- **Framework:** Vanilla TypeScript + minimal dependencies
- **Terminal:** xterm.js (industry standard terminal emulator)
- **Styling:** Tailwind CSS (via CDN for prototype)
- **Real-time:** Native WebSocket API

### Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Claude Code Orchestrator                           [⚙️] [🔴 Recording] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────┐  ┌─────────────────┐ │
│  │                                               │  │ Session Status  │ │
│  │                                               │  │                 │ │
│  │                                               │  │ State: ACTIVE   │ │
│  │            Terminal View                      │  │ Tasks: 3        │ │
│  │            (xterm.js)                         │  │ Errors: 0       │ │
│  │                                               │  │ Runtime: 12:34  │ │
│  │            120 cols × 30 rows                 │  │                 │ │
│  │                                               │  │ ─────────────── │ │
│  │                                               │  │                 │ │
│  │                                               │  │ Supervisor      │ │
│  │                                               │  │ [✓] Enabled     │ │
│  │                                               │  │ Confidence: 85  │ │
│  │                                               │  │                 │ │
│  │                                               │  │ Last Decision:  │ │
│  │                                               │  │ "new_task"      │ │
│  └───────────────────────────────────────────────┘  │ @ 12:34:56      │ │
│                                                     │                 │ │
│  ┌───────────────────────────────────────────────┐  │ ─────────────── │ │
│  │ Manual Input                                  │  │                 │ │
│  │ ┌───────────────────────────────────────────┐ │  │ Quick Actions   │ │
│  │ │ Type command or message...                │ │  │                 │ │
│  │ └───────────────────────────────────────────┘ │  │ [/clear]        │ │
│  │ [Send] [/clear] [/compact] [Pause Supervisor] │  │ [/compact]      │ │
│  └───────────────────────────────────────────────┘  │ [/cost]         │ │
│                                                     │ [Abort]         │ │
│  ┌───────────────────────────────────────────────┐  │                 │ │
│  │ Supervisor Log                     [Clear]    │  └─────────────────┘ │
│  │ ─────────────────────────────────────────────│                       │
│  │ 12:34:56 [DETECT] Task completion (conf: 92) │                       │
│  │ 12:34:57 [ANALYZE] Sending to supervisor...  │                       │
│  │ 12:34:58 [DECIDE] new_task (conf: 88)        │                       │
│  │ 12:34:58 [INJECT] "implement user auth..."   │                       │
│  └───────────────────────────────────────────────┘                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Components

#### 1. Terminal View

```typescript
interface TerminalView {
  // xterm.js instance
  terminal: Terminal;
  fitAddon: FitAddon;
  webLinksAddon: WebLinksAddon;
  
  // Methods
  write(data: string): void;
  clear(): void;
  focus(): void;
  resize(cols: number, rows: number): void;
  
  // Events
  onInput(callback: (data: string) => void): void;
}
```

**Features:**
- Full ANSI color support
- Clickable links
- Copy/paste support
- Scrollback buffer (1000 lines)
- Search functionality (Ctrl+F)

#### 2. Status Panel

```typescript
interface StatusPanel {
  state: SessionState;
  taskCount: number;
  errorCount: number;
  runtime: string;
  supervisorEnabled: boolean;
  lastDecision: SupervisorDecision | null;
  
  // Updates via WebSocket
  update(status: SessionStatus): void;
}
```

#### 3. Supervisor Log

```typescript
interface LogEntry {
  timestamp: string;
  type: "detect" | "analyze" | "decide" | "inject" | "error" | "info";
  message: string;
  metadata?: Record<string, unknown>;
}

interface SupervisorLog {
  entries: LogEntry[];
  maxEntries: number; // 100
  
  append(entry: LogEntry): void;
  clear(): void;
  filter(type: LogEntry["type"]): LogEntry[];
}
```

#### 4. Manual Input

```typescript
interface ManualInput {
  // Send raw input to PTY
  send(text: string): void;
  
  // Quick actions
  sendClear(): void;    // /clear
  sendCompact(): void;  // /compact
  sendCost(): void;     // /cost
  
  // Supervisor control
  pauseSupervisor(): void;
  resumeSupervisor(): void;
  
  // Emergency
  abort(): void;
}
```

### WebSocket Protocol

```typescript
// Server -> Client messages
type ServerMessage =
  | { type: "pty:data"; data: string }
  | { type: "pty:exit"; code: number }
  | { type: "session:state"; state: SessionState }
  | { type: "supervisor:log"; entry: LogEntry }
  | { type: "supervisor:decision"; decision: SupervisorDecision }
  | { type: "error"; message: string };

// Client -> Server messages
type ClientMessage =
  | { type: "pty:input"; data: string }
  | { type: "pty:resize"; cols: number; rows: number }
  | { type: "supervisor:toggle"; enabled: boolean }
  | { type: "command:clear" }
  | { type: "command:compact" }
  | { type: "command:abort" };
```

---

## API Specification

### REST Endpoints

#### Session Management

```
GET /api/session
Response: {
  state: SessionState;
  startTime: string;
  taskCount: number;
  errorCount: number;
  supervisorEnabled: boolean;
  currentTask: string | null;
}

POST /api/session/start
Body: { task?: string }
Response: { success: boolean }

POST /api/session/stop
Response: { success: boolean }
```

#### Supervisor Control

```
GET /api/supervisor
Response: {
  enabled: boolean;
  lastDecision: SupervisorDecision | null;
  decisionCount: number;
}

POST /api/supervisor/toggle
Body: { enabled: boolean }
Response: { enabled: boolean }

POST /api/supervisor/analyze
Body: { transcript: string }
Response: SupervisorDecision
```

#### Manual Control

```
POST /api/command
Body: { command: string }
Response: { success: boolean }

POST /api/abort
Response: { success: boolean }
```

### WebSocket Endpoint

```
WS /ws

// Connection established
<- { type: "connected", sessionId: string }

// Real-time PTY output
<- { type: "pty:data", data: "..." }

// Send input
-> { type: "pty:input", data: "hello\n" }
```

---

## Data Models

### Core Types

```typescript
// Session
interface Session {
  id: string;
  state: SessionState;
  startTime: Date;
  endTime?: Date;
  supervisorEnabled: boolean;
  tasks: Task[];
  logs: LogEntry[];
}

// Task
interface Task {
  id: string;
  description: string;
  status: "pending" | "running" | "success" | "failure" | "aborted";
  startTime: Date;
  endTime?: Date;
  output: string;
  supervisorDecisions: SupervisorDecision[];
}

// Buffer
interface OutputBuffer {
  recent: RingBuffer<string>;  // Last 100 lines
  full: string[];              // Complete transcript
  ansiStripped: string[];      // For analysis (no ANSI codes)
}

// Ring Buffer implementation
class RingBuffer<T> {
  private buffer: T[];
  private head: number = 0;
  private size: number;
  
  constructor(capacity: number);
  push(item: T): void;
  toArray(): T[];
  get length(): number;
}
```

### Configuration Schema

```typescript
interface Config {
  // Server
  server: {
    port: number;           // default: 3000
    host: string;           // default: "localhost"
  };
  
  // PTY
  pty: {
    shell: string;          // default: "claude"
    args: string[];         // default: []
    cols: number;           // default: 120
    rows: number;           // default: 30
    env: Record<string, string>;
  };
  
  // Supervisor
  supervisor: {
    enabled: boolean;       // default: true
    apiKey: string;         // ANTHROPIC_API_KEY
    model: string;          // default: "claude-sonnet-4-5-20250929"
    confidenceThreshold: number;  // default: 70
    maxRetries: number;     // default: 3
    debounceMs: number;     // default: 2000 (wait before analyzing)
  };
  
  // Detection
  detection: {
    completionThreshold: number;  // default: 70
    bufferLines: number;          // default: 100
  };
  
  // Logging
  logging: {
    level: "debug" | "info" | "warn" | "error";
    file?: string;          // Optional file output
  };
}
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Day 1-2)

**Tasks:**
1. [ ] Project setup with Bun
2. [ ] PTY Manager implementation
3. [ ] Basic event bus
4. [ ] Session state machine
5. [ ] Output buffer management

**Deliverable:** Can spawn Claude Code and see output in terminal

### Phase 2: Detection Engine (Day 2-3)

**Tasks:**
1. [ ] ANSI parser/stripper
2. [ ] Pattern matching engine
3. [ ] Confidence scoring
4. [ ] State detection tests
5. [ ] Fine-tune patterns with real Claude Code output

**Deliverable:** Reliable task completion detection

### Phase 3: Supervisor Agent (Day 3-4)

**Tasks:**
1. [ ] Claude API integration
2. [ ] Supervisor prompt implementation
3. [ ] Decision parsing
4. [ ] Command injection
5. [ ] Feedback loop prevention

**Deliverable:** Autonomous task chaining works

### Phase 4: HTTP Server & API (Day 4-5)

**Tasks:**
1. [ ] Hono server setup
2. [ ] REST endpoints
3. [ ] WebSocket server
4. [ ] API documentation

**Deliverable:** Full API functional

### Phase 5: Web UI (Day 5-7)

**Tasks:**
1. [ ] HTML structure
2. [ ] xterm.js integration
3. [ ] WebSocket client
4. [ ] Status panel
5. [ ] Supervisor log view
6. [ ] Manual controls
7. [ ] Styling with Tailwind

**Deliverable:** Complete web interface

### Phase 6: Testing & Polish (Day 7-8)

**Tasks:**
1. [ ] End-to-end testing
2. [ ] Error handling improvements
3. [ ] Performance optimization
4. [ ] Documentation
5. [ ] Demo video/screenshots

**Deliverable:** Production-ready prototype

---

## File Structure

```
claude-orchestrator/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── .env.example
├── README.md
│
├── src/
│   ├── index.ts                 # Entry point
│   ├── config.ts                # Configuration loader
│   │
│   ├── core/
│   │   ├── pty-manager.ts       # PTY handling
│   │   ├── session-manager.ts   # Session state machine
│   │   ├── event-bus.ts         # Event emitter
│   │   └── buffer.ts            # Ring buffer implementation
│   │
│   ├── detection/
│   │   ├── analyzer.ts          # Output analyzer
│   │   ├── patterns.ts          # Detection patterns
│   │   ├── ansi.ts              # ANSI handling
│   │   └── confidence.ts        # Confidence scoring
│   │
│   ├── supervisor/
│   │   ├── agent.ts             # Supervisor agent
│   │   ├── prompt.ts            # System prompt
│   │   └── decisions.ts         # Decision types
│   │
│   ├── server/
│   │   ├── app.ts               # Hono app
│   │   ├── routes/
│   │   │   ├── session.ts       # Session routes
│   │   │   ├── supervisor.ts    # Supervisor routes
│   │   │   └── command.ts       # Command routes
│   │   └── websocket.ts         # WebSocket handler
│   │
│   └── types/
│       └── index.ts             # Shared types
│
├── public/
│   ├── index.html               # Main HTML
│   ├── styles.css               # Custom styles
│   │
│   └── js/
│       ├── app.ts               # Main app
│       ├── terminal.ts          # Terminal component
│       ├── status.ts            # Status panel
│       ├── log.ts               # Supervisor log
│       └── websocket.ts         # WebSocket client
│
└── tests/
    ├── detection.test.ts        # Detection tests
    ├── supervisor.test.ts       # Supervisor tests
    └── e2e.test.ts              # End-to-end tests
```

---

## Configuration

### Environment Variables

```bash
# .env

# Server
PORT=3000
HOST=localhost

# Anthropic API
ANTHROPIC_API_KEY=sk-ant-...

# Supervisor
SUPERVISOR_MODEL=claude-sonnet-4-5-20250929
SUPERVISOR_ENABLED=true
CONFIDENCE_THRESHOLD=70

# PTY
PTY_SHELL=claude
PTY_COLS=120
PTY_ROWS=30

# Logging
LOG_LEVEL=info
```

### Config File (Optional)

```typescript
// cco.config.ts
import type { Config } from "./src/types";

export default {
  server: {
    port: 3000,
    host: "localhost",
  },
  supervisor: {
    enabled: true,
    model: "claude-sonnet-4-5-20250929",
    confidenceThreshold: 70,
  },
  // ...
} satisfies Config;
```

---

## Security Considerations

### Prototype Scope

Since this is a local development tool, security is simplified but still important:

#### 1. Localhost Only

```typescript
// Only bind to localhost
const server = Bun.serve({
  hostname: "localhost", // Not 0.0.0.0
  port: 3000,
  // ...
});
```

#### 2. Environment Variable Protection

```typescript
// Never log or expose API key
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error("ANTHROPIC_API_KEY is required");
}

// Redact in logs
function redactSensitive(obj: Record<string, unknown>) {
  const redacted = { ...obj };
  if (redacted.apiKey) redacted.apiKey = "[REDACTED]";
  return redacted;
}
```

#### 3. Command Injection Prevention

```typescript
// Validate supervisor commands before injection
const ALLOWED_COMMANDS = ["/clear", "/compact", "/cost", "/help"];

function validateCommand(cmd: string): boolean {
  // Only allow safe patterns
  if (ALLOWED_COMMANDS.includes(cmd)) return true;
  
  // Check for dangerous patterns
  const dangerous = [
    /[;&|`$]/,           // Shell operators
    /rm\s+-rf/i,         // Destructive commands
    /sudo/i,             // Privilege escalation
    />\s*\/etc/,         // Writing to system files
  ];
  
  return !dangerous.some(pattern => pattern.test(cmd));
}
```

#### 4. Rate Limiting

```typescript
// Prevent supervisor API abuse
const rateLimiter = {
  requests: 0,
  resetTime: Date.now() + 60000,
  maxRequests: 30, // 30 per minute
  
  check(): boolean {
    if (Date.now() > this.resetTime) {
      this.requests = 0;
      this.resetTime = Date.now() + 60000;
    }
    return ++this.requests <= this.maxRequests;
  }
};
```

### Future Considerations (Production)

For a production version, add:
- API key authentication for endpoints
- HTTPS/WSS
- Request signing
- Audit logging
- Session encryption
- Input sanitization

---

## Appendix: Sample Supervisor Decisions

### Decision Tree Reference

```
┌─────────────────────────────────────────────────────────────────┐
│                    Task Complete?                                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
         [YES]          [PARTIAL]         [NO]
            │               │               │
            ▼               ▼               ▼
    ┌───────────┐   ┌───────────┐   ┌───────────┐
    │  Errors?  │   │  Errors?  │   │  Error?   │
    └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
          │               │               │
     ┌────┴────┐     ┌────┴────┐     ┌────┴────┐
     │         │     │         │     │         │
     ▼         ▼     ▼         ▼     ▼         ▼
   [NO]      [YES] [NO]      [YES] [NO]      [YES]
     │         │     │         │     │         │
     ▼         ▼     ▼         ▼     ▼         ▼
  new_task  human  continue  human  wait    continue
  or clear  review          review          (let fix)
```

---

## Appendix: xterm.js Configuration

```typescript
// Recommended xterm.js settings for Claude Code output
const terminalOptions: ITerminalOptions = {
  cols: 120,
  rows: 30,
  cursorBlink: true,
  cursorStyle: "block",
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
  theme: {
    background: "#1a1b26",      // Tokyo Night background
    foreground: "#a9b1d6",      // Tokyo Night foreground
    cursor: "#c0caf5",
    cursorAccent: "#1a1b26",
    selectionBackground: "#33467c",
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#f7768e",
    brightGreen: "#9ece6a",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#c0caf5",
  },
  allowTransparency: false,
  scrollback: 1000,
  tabStopWidth: 4,
  bellStyle: "none",
  convertEol: true,
  screenReaderMode: false,
};
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2025-XX-XX | Initial prototype specification |

---

*End of Specification*
