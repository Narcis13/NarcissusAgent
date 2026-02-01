# Phase 2: Output Analysis & Autonomous Loop - Research

**Researched:** 2026-02-01
**Domain:** ANSI parsing, pattern detection, autonomous loop state machines, Anthropic SDK
**Confidence:** HIGH

## Summary

Phase 2 requires building the autonomous loop that chains commands by detecting task completion in Claude Code output. This involves three core capabilities: (1) ANSI escape code stripping for clean pattern matching, (2) pattern detection for completion/error/prompt-ready states, and (3) a supervised loop with cooldown to prevent feedback loops.

The standard approach is:
1. Use `strip-ansi` (7.x) for ANSI stripping - battle-tested, handles edge cases
2. Build a pattern detector that classifies output into states with confidence scores
3. Use `@anthropic-ai/sdk` to call Claude as supervisor for decision-making
4. Implement cooldown using simple timestamp tracking (not debounce - different pattern)
5. Use an output buffer (ring buffer pattern) to accumulate recent output for analysis

**Primary recommendation:** Use strip-ansi for ANSI handling, implement pattern detection as a classifier with multiple heuristics contributing to a confidence score, call Claude supervisor via streaming API with structured output, and enforce 2-5 second cooldown between supervisor calls.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| strip-ansi | 7.x | Strip ANSI escape codes | 250M weekly downloads, handles all edge cases |
| @anthropic-ai/sdk | latest | Call Claude as supervisor | Official SDK, TypeScript-native, streaming support |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ansi-regex | 6.x | Detect ANSI codes (preserve positions) | When need to know WHERE codes are, not just strip |
| ring-buffer-ts | latest | Fixed-size output buffer | Memory-bounded output accumulation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| strip-ansi | Manual regex | Edge cases with partial sequences, unicode |
| @anthropic-ai/sdk | Raw fetch | No streaming helpers, no type safety |
| ring-buffer-ts | Array with shift/push | Memory grows unbounded or manual truncation |

**Installation:**
```bash
bun add strip-ansi @anthropic-ai/sdk
```

**Note:** strip-ansi 7.x is ESM-only. This matches the project's `"type": "module"` setting.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── output/
│   ├── types.ts           # OutputState, PatternMatch, ConfidenceScore
│   ├── analyzer.ts        # OutputAnalyzer class - strips ANSI, runs patterns
│   ├── patterns.ts        # Pattern definitions for completion/error/prompt
│   └── buffer.ts          # OutputBuffer - ring buffer for recent output
├── supervisor/
│   ├── types.ts           # SupervisorDecision, SupervisorRequest
│   ├── client.ts          # SupervisorClient - wraps Anthropic SDK
│   └── prompts.ts         # System prompts for supervisor
├── loop/
│   ├── types.ts           # LoopState, LoopConfig
│   ├── controller.ts      # LoopController - orchestrates the autonomous loop
│   └── cooldown.ts        # Cooldown tracker
└── (existing)
    ├── pty/               # From Phase 1
    └── session/           # From Phase 1
```

### Pattern 1: Output Analyzer with Confidence Scoring
**What:** Analyzer that strips ANSI, runs multiple pattern matchers, aggregates confidence
**When to use:** All output analysis - central processing point
**Example:**
```typescript
// Source: Project-specific pattern based on ML confidence score concepts
import stripAnsi from 'strip-ansi';

interface PatternMatch {
  pattern: string;
  matched: boolean;
  confidence: number; // 0-1
  evidence: string[];
}

interface AnalysisResult {
  state: 'running' | 'completed' | 'error' | 'prompt_ready';
  confidence: number; // 0-1, aggregated
  matches: PatternMatch[];
  cleanOutput: string;
}

class OutputAnalyzer {
  private patterns: Map<string, RegExp[]>;

  analyze(rawOutput: string): AnalysisResult {
    const cleanOutput = stripAnsi(rawOutput);
    const matches: PatternMatch[] = [];

    // Run each pattern category
    for (const [category, regexes] of this.patterns) {
      const categoryMatch = this.matchCategory(cleanOutput, regexes);
      matches.push(categoryMatch);
    }

    // Aggregate confidence using weighted average
    const state = this.determineState(matches);
    const confidence = this.calculateConfidence(matches, state);

    return { state, confidence, matches, cleanOutput };
  }

  private calculateConfidence(matches: PatternMatch[], state: string): number {
    // Multiple signals increase confidence
    // Contradictory signals decrease confidence
    const relevant = matches.filter(m => m.pattern.startsWith(state));
    const contradicting = matches.filter(m => !m.pattern.startsWith(state) && m.matched);

    let score = relevant.reduce((sum, m) => sum + m.confidence, 0) / relevant.length;
    score -= contradicting.length * 0.1; // Penalty for contradictions

    return Math.max(0, Math.min(1, score));
  }
}
```

### Pattern 2: Supervisor Client with Streaming
**What:** Wrapper around Anthropic SDK for calling Claude as supervisor
**When to use:** When output analyzer has >= 70% confidence of completion
**Example:**
```typescript
// Source: https://github.com/anthropics/anthropic-sdk-typescript
import Anthropic from '@anthropic-ai/sdk';

interface SupervisorDecision {
  action: 'continue' | 'inject' | 'stop';
  command?: string; // Required if action === 'inject'
  reason: string;
}

class SupervisorClient {
  private client: Anthropic;
  private model = 'claude-sonnet-4-5-20250929';

  constructor() {
    this.client = new Anthropic(); // Uses ANTHROPIC_API_KEY env var
  }

  async decide(context: {
    taskDescription: string;
    recentOutput: string;
    analysisResult: AnalysisResult;
  }): Promise<SupervisorDecision> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: this.buildPrompt(context),
      }],
    });

    const message = await stream.finalMessage();
    return this.parseDecision(message);
  }
}
```

### Pattern 3: Loop Controller with Cooldown
**What:** State machine that orchestrates spawn -> monitor -> detect -> analyze -> inject
**When to use:** Main entry point for autonomous operation
**Example:**
```typescript
// Source: Project-specific state machine pattern
interface LoopConfig {
  minCooldownMs: number;  // Minimum 2000ms
  maxCooldownMs: number;  // Maximum 5000ms
  confidenceThreshold: number; // 0.7 = 70%
}

class LoopController {
  private lastSupervisorCall: number = 0;
  private config: LoopConfig;

  async shouldCallSupervisor(analysis: AnalysisResult): Promise<boolean> {
    // Check confidence threshold
    if (analysis.confidence < this.config.confidenceThreshold) {
      return false;
    }

    // Check cooldown
    const elapsed = Date.now() - this.lastSupervisorCall;
    if (elapsed < this.config.minCooldownMs) {
      return false;
    }

    return true;
  }

  async handleSupervisorDecision(decision: SupervisorDecision): Promise<void> {
    this.lastSupervisorCall = Date.now();

    switch (decision.action) {
      case 'inject':
        // Transition session to 'injecting'
        // Write command to PTY
        // Transition session to 'task_running'
        break;
      case 'stop':
        // Transition session to 'idle'
        // Stop the loop
        break;
      case 'continue':
        // Keep monitoring
        break;
    }
  }
}
```

### Pattern 4: Output Buffer (Ring Buffer)
**What:** Fixed-size buffer that keeps last N bytes/lines of output
**When to use:** Accumulating output for analysis without unbounded memory growth
**Example:**
```typescript
// Source: ring-buffer-ts pattern
class OutputBuffer {
  private buffer: string[] = [];
  private maxLines: number;

  constructor(maxLines: number = 100) {
    this.maxLines = maxLines;
  }

  append(text: string): void {
    const lines = text.split('\n');
    this.buffer.push(...lines);

    // Trim to max size
    if (this.buffer.length > this.maxLines) {
      this.buffer = this.buffer.slice(-this.maxLines);
    }
  }

  getRecent(lines: number = 50): string {
    return this.buffer.slice(-lines).join('\n');
  }

  clear(): void {
    this.buffer = [];
  }
}
```

### Anti-Patterns to Avoid
- **Calling supervisor on every output chunk:** Expensive and creates feedback loops. Use confidence threshold and cooldown.
- **Unbounded output accumulation:** Memory leak. Use ring buffer with fixed size.
- **Blocking on supervisor response:** Use async/streaming. Don't freeze the PTY output handling.
- **Pattern matching on raw ANSI output:** Escape codes break regex. Always strip first.
- **Hardcoded patterns:** Make patterns configurable. Claude Code output format may change.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ANSI stripping | Regex like `/\x1b\[[0-9;]*m/g` | strip-ansi | Partial sequences, OSC, unicode edge cases |
| Claude API calls | Raw fetch with SSE parsing | @anthropic-ai/sdk | Auth, retry, streaming, types |
| Ring buffer | Array + slice | ring-buffer-ts | Memory-efficient, tested |
| Debounce | setTimeout chains | Simple timestamp check | Not debounce pattern - we want cooldown |

**Key insight:** ANSI escape codes have many forms (CSI, OSC, DCS) and can be split across chunks. strip-ansi handles all these cases. The regex `/\x1b\[[0-9;]*m/g` only handles basic SGR codes.

## Common Pitfalls

### Pitfall 1: Feedback Loop from Rapid Supervisor Calls
**What goes wrong:** Supervisor output triggers analysis which triggers another supervisor call
**Why it happens:** No cooldown, or cooldown too short
**How to avoid:** Enforce minimum 2-5 second cooldown between supervisor calls
**Warning signs:** Multiple supervisor calls per second, API costs spiking

### Pitfall 2: Pattern Matching on Partial Output
**What goes wrong:** Patterns match mid-line, causing false positives
**Why it happens:** PTY output arrives in chunks, not complete lines
**How to avoid:** Buffer output and analyze at line boundaries or after idle timeout
**Warning signs:** Completion detected mid-task, spurious state transitions

### Pitfall 3: ANSI Codes Breaking Regex
**What goes wrong:** Patterns like `/error:/i` fail because "error:" has ANSI codes inside
**Why it happens:** Terminal output includes color codes between/within words
**How to avoid:** Always strip ANSI before pattern matching
**Warning signs:** Patterns that work in tests fail on real output

### Pitfall 4: Blocking the Event Loop
**What goes wrong:** UI/output streaming freezes during supervisor call
**Why it happens:** Awaiting supervisor response in the PTY data handler
**How to avoid:** Queue analysis work, don't block onData callback
**Warning signs:** Output appears in bursts, not smooth streaming

### Pitfall 5: False Confidence from Single Pattern
**What goes wrong:** 100% confidence from one pattern match leads to wrong decision
**Why it happens:** Single regex match without corroboration
**How to avoid:** Require multiple signals for high confidence. Use weighted scoring.
**Warning signs:** High confidence but wrong state detection

### Pitfall 6: Memory Leak from Output Accumulation
**What goes wrong:** Long-running sessions consume gigabytes of memory
**Why it happens:** Appending all output to unbounded string/array
**How to avoid:** Use ring buffer with fixed size (e.g., last 100 lines)
**Warning signs:** Memory usage grows linearly with runtime

## Code Examples

Verified patterns from official sources:

### Stripping ANSI Codes
```typescript
// Source: https://github.com/chalk/strip-ansi
import stripAnsi from 'strip-ansi';

// Basic usage
const clean = stripAnsi('\u001B[4mUnicorn\u001B[0m');
// => 'Unicorn'

// Handles hyperlinks (OSC 8)
const cleanLink = stripAnsi('\u001B]8;;https://github.com\u0007Click\u001B]8;;\u0007');
// => 'Click'

// For dual-purpose (display + analysis)
function processOutput(raw: Uint8Array): { display: string; analyze: string } {
  const text = new TextDecoder().decode(raw);
  return {
    display: text,           // Preserve ANSI for terminal
    analyze: stripAnsi(text) // Strip for pattern matching
  };
}
```

### Anthropic SDK Streaming
```typescript
// Source: https://github.com/anthropics/anthropic-sdk-typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// Using stream helper (recommended for events)
const stream = client.messages.stream({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Your prompt here' }],
})
.on('text', (text) => console.log(text))
.on('message', (message) => console.log('Done:', message.stop_reason));

const finalMessage = await stream.finalMessage();
console.log('Usage:', finalMessage.usage);

// Using async iterator (lower memory)
const rawStream = await client.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Your prompt here' }],
  stream: true,
});

for await (const event of rawStream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text);
  }
}
```

### Simple Cooldown Implementation
```typescript
// Source: Project-specific pattern (not debounce)
class Cooldown {
  private lastCall: number = 0;

  constructor(private minMs: number) {}

  canProceed(): boolean {
    const now = Date.now();
    if (now - this.lastCall >= this.minMs) {
      return true;
    }
    return false;
  }

  mark(): void {
    this.lastCall = Date.now();
  }

  timeRemaining(): number {
    const elapsed = Date.now() - this.lastCall;
    return Math.max(0, this.minMs - elapsed);
  }
}

// Usage in loop
const cooldown = new Cooldown(3000); // 3 second minimum

async function maybeCallSupervisor(analysis: AnalysisResult) {
  if (!cooldown.canProceed()) {
    console.log(`Cooldown: ${cooldown.timeRemaining()}ms remaining`);
    return;
  }

  cooldown.mark();
  const decision = await supervisor.decide(analysis);
  // ... handle decision
}
```

### Confidence Score Calculation
```typescript
// Source: ML confidence scoring best practices
interface PatternWeight {
  pattern: RegExp;
  category: 'completion' | 'error' | 'prompt_ready';
  weight: number; // 0-1, contribution to confidence
  exclusive?: boolean; // If true, other categories get penalty
}

const PATTERNS: PatternWeight[] = [
  // Completion patterns
  { pattern: /Task completed?\.?/i, category: 'completion', weight: 0.4 },
  { pattern: /Successfully (?:created|updated|fixed)/i, category: 'completion', weight: 0.3 },
  { pattern: /\[CCO\].*exited with code: 0/i, category: 'completion', weight: 0.5, exclusive: true },

  // Error patterns
  { pattern: /(?:Error|Exception|Failed):/i, category: 'error', weight: 0.3 },
  { pattern: /exited with code: [1-9]/i, category: 'error', weight: 0.5, exclusive: true },

  // Prompt-ready patterns
  { pattern: /\$\s*$/, category: 'prompt_ready', weight: 0.2 },
  { pattern: />\s*$/, category: 'prompt_ready', weight: 0.2 },
];

function calculateConfidence(output: string): Map<string, number> {
  const scores = new Map<string, number>();
  const penalties = new Map<string, number>();

  for (const { pattern, category, weight, exclusive } of PATTERNS) {
    if (pattern.test(output)) {
      const current = scores.get(category) || 0;
      scores.set(category, Math.min(1, current + weight));

      if (exclusive) {
        // Other categories get penalized
        for (const other of ['completion', 'error', 'prompt_ready']) {
          if (other !== category) {
            const penalty = penalties.get(other) || 0;
            penalties.set(other, penalty + 0.2);
          }
        }
      }
    }
  }

  // Apply penalties
  for (const [category, penalty] of penalties) {
    const current = scores.get(category) || 0;
    scores.set(category, Math.max(0, current - penalty));
  }

  return scores;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual ANSI regex | strip-ansi library | 2020+ | Handles all edge cases |
| Raw HTTP for Claude API | @anthropic-ai/sdk | 2023+ | Streaming, types, auth |
| Expect-style exact matching | Confidence scoring | 2024+ | Handles variability in LLM output |
| Debounce for rate limiting | Cooldown pattern | N/A | Different semantics - cooldown is simpler |

**Deprecated/outdated:**
- **chalk 4.x ansi stripping:** Use strip-ansi directly for stripping
- **Manual SSE parsing:** SDK handles streaming properly

## Open Questions

Things that couldn't be fully resolved:

1. **Claude Code specific output patterns**
   - What we know: Claude Code uses ANSI colors, has task/tool output sections
   - What's unclear: Exact patterns for "task complete", specific prompt format
   - Recommendation: Implement with configurable patterns, tune based on real output observation

2. **Optimal confidence threshold**
   - What we know: 70% was specified in requirements
   - What's unclear: Whether 70% is too high/low for real-world output
   - Recommendation: Start with 70%, make configurable, add logging to tune

3. **Optimal cooldown duration**
   - What we know: 2-5 seconds specified in requirements
   - What's unclear: Best value depends on typical task duration
   - Recommendation: Start with 3 seconds, make configurable

4. **Claude Code SDK vs PTY approach**
   - What we know: Claude Code has a headless SDK mode (`claude -p`)
   - What's unclear: Whether SDK mode provides better programmatic hooks
   - Recommendation: Stay with PTY approach per project design, but note SDK alternative exists

## Sources

### Primary (HIGH confidence)
- [strip-ansi npm](https://www.npmjs.com/package/strip-ansi) - Version 7.1.2, 250M weekly downloads
- [strip-ansi GitHub](https://github.com/chalk/strip-ansi) - Official repo, TypeScript support
- [ansi-regex GitHub](https://github.com/chalk/ansi-regex) - Version 6.2.2, underlying regex
- [@anthropic-ai/sdk npm](https://www.npmjs.com/package/@anthropic-ai/sdk) - Official TypeScript SDK
- [anthropic-sdk-typescript GitHub](https://github.com/anthropics/anthropic-sdk-typescript) - Streaming examples

### Secondary (MEDIUM confidence)
- [ANSI Escape Codes Reference](https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797) - Comprehensive CSI/OSC documentation
- [ring-buffer-ts npm](https://www.npmjs.com/package/ring-buffer-ts) - TypeScript ring buffer
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) - Output formats, flags

### Tertiary (LOW confidence)
- [Confidence Scoring Best Practices](https://www.mindee.com/blog/how-use-confidence-scores-ml-models) - ML confidence patterns
- Expect man page - Pattern matching concepts (applied differently here)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official packages with extensive documentation
- Architecture: HIGH - Patterns are established, adapted to this domain
- Pitfalls: HIGH - Well-documented issues from similar systems
- Pattern detection specifics: MEDIUM - Claude Code output format may vary

**Research date:** 2026-02-01
**Valid until:** 2026-03-01 (30 days - SDK stable, strip-ansi stable)

**Dependencies from Phase 1:**
- PTYManager.onData provides raw Uint8Array output
- SessionManager tracks state transitions
- Session state machine has 'analyzing' and 'injecting' states ready
