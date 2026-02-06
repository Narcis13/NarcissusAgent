# Multi-Instance Claude Code via Bun Session Manager: A Realistic Assessment

## The Idea

Two or more Claude Code CLI instances, each running independently, communicating through a Bun web server that acts as a session manager / coordination layer. Compare this against:

- A single Claude Code instance (with or without built-in Task/Team swarm)
- A `claude -p` loop (sequential re-invocations with piped context)
- Multiple independent Claude Code instances with no coordination

---

## What I Actually Am (Honest Self-Assessment)

Each Claude Code instance is:
- A stateless LLM with a finite context window (~200k tokens, compressed as it fills)
- Equipped with tools (file I/O, bash, search, browser, etc.)
- Capable of spawning in-process subagents (Task tool) that share the session lifecycle
- Fundamentally bounded by: context window size, single-turn reasoning quality, and the serial nature of tool use

The built-in "swarm" (TeamCreate + Task agents) operates **within** a single CLI session. Subagents share the same process. If the parent dies, they all die. They communicate through an internal message bus, not over the network.

---

## Real Advantages of the Bun Web Server Approach

### 1. Process Isolation = Fault Tolerance

This is the single strongest argument. When a Claude Code instance hits its context limit, crashes, gets confused, or enters a reasoning dead-end, it doesn't take down the entire operation. The Bun server survives. The other instances survive. You can kill and restart one instance without losing the others' progress.

With the built-in swarm, if the parent agent's context fills up or the session crashes, everything is gone. There's no external persistence layer.

### 2. Independent Context Windows

Each instance gets its own full context window. This is genuinely valuable. In the built-in swarm, subagents technically get their own context, but the parent agent still needs to hold coordination state, task descriptions, and returned results — all eating into its window. With the Bun server approach, the coordination state lives outside any LLM context entirely, in plain data structures that don't degrade.

A parent agent coordinating 5 subagents in the built-in system will spend a significant portion of its context on coordination overhead. A Bun server storing the same coordination data uses kilobytes of RAM.

### 3. Persistent State Across Instance Lifecycles

The Bun server can maintain:
- Which files each instance is working on (file locking)
- Task queue and completion status
- Shared knowledge / discoveries
- A log of all actions taken

This state persists even if you restart all Claude instances. With the built-in system or `claude -p` loops, this state is either in-context (volatile) or needs to be manually written to disk and re-read.

### 4. Observable Coordination

A web server is inspectable. You can build a simple UI to watch what's happening, see which instance is doing what, read their messages to each other, and intervene. The built-in swarm is essentially a black box — you see the parent's output and that's it.

### 5. Heterogeneous Instances

You could run one instance with Opus for architectural decisions and another with Sonnet for grunt work. Or one with browser access and one without. Or one with `--dangerously-skip-permissions` for trusted operations and one locked down. The Bun server doesn't care — it just routes messages.

---

## Real Disadvantages (The Part People Skip)

### 1. Communication Bandwidth is Terrible

Here's the fundamental problem: the richest form of "understanding" I have is my context window. When two instances communicate through a web server, they exchange **serialized text messages**. This is lossy. Instance A might have deep understanding of a module's behavior from reading 50 files — but it can only communicate a summary to Instance B. Instance B then works with a shadow of that understanding.

The built-in subagent system has the same problem, but at least the parent agent retains the full context and can make informed decisions about what to delegate. With independent instances, nobody has the full picture.

### 2. Coordination Is a Genuinely Hard Problem

Distributed systems are hard for computers. They're harder for LLMs. Consider:
- Instance A and B both decide to edit the same file
- Instance A makes an architectural decision that Instance B's work depends on, but B doesn't know yet
- Instance A discovers a bug that invalidates Instance B's approach
- Both instances install conflicting dependencies

You need locking, ordering, conflict resolution. The Bun server can enforce some of this mechanically (file locks, task assignment), but the semantic coordination — "does this change make sense given what the other instance is doing?" — still requires an LLM to evaluate, which means burning context on coordination.

### 3. Most Tasks Don't Benefit

Be honest: how often do you actually have two truly independent streams of work? In practice, software tasks have deep dependencies. "Build the frontend" depends on "define the API" which depends on "design the data model." You can parallelize tests, linting, and maybe some file generation. But the core intellectual work — understanding the problem, designing the solution, implementing it correctly — is inherently serial.

The tasks that genuinely parallelize well (running tests on multiple files, formatting, searching across a large codebase) are already handled faster by non-LLM tools.

### 4. Cost Multiplier

Two instances = roughly 2x the API cost. Three = 3x. The coordination messages add more. If Instance B is blocked waiting for Instance A, it's either idle (wasting nothing but latency) or polling (wasting tokens). For most projects, a single well-directed instance will finish faster and cheaper than two instances spending tokens coordinating.

### 5. Debugging Is Harder

When something goes wrong in a single instance, you read the conversation. When something goes wrong in a multi-instance system, you need to reconstruct what happened across multiple conversations, the server logs, and the interleaved file changes. This is the same reason microservices are harder to debug than monoliths.

### 6. The Bun Server Itself Is a Liability

It's another component that can crash, have bugs, or behave unexpectedly. If the server goes down, the instances lose their coordination layer. You need to handle reconnection, message replay, crash recovery. This is real engineering work, and it needs to be reliable before the system on top of it can be reliable.

---

## Versus `claude -p` Loop (Ralph Loop)

The loop pattern: `while not done; claude -p "$(cat context.md)" | process_output; done`

**Advantages of the loop:**
- Dead simple. No coordination protocol, no web server, no message format.
- Fresh context every iteration — no context pollution from previous mistakes.
- Each iteration can read the current state of the codebase, getting ground truth.
- Easy to add human checkpoints between iterations.
- Predictable cost — one instance at a time.

**Advantages of the Bun approach over the loop:**
- Parallelism — the loop is strictly sequential.
- Persistent memory within an instance's session — the loop forgets everything.
- Richer interaction — instances can ask each other questions, not just read files.
- The loop struggles with tasks requiring sustained context (e.g., refactoring that spans many files with a coherent vision).

**Honest take:** The loop is underrated. For many tasks, "do one thing, check the result, do the next thing" is more reliable than "two agents try to do things simultaneously and hope they don't conflict." The loop's simplicity is a feature.

---

## Versus Built-In Swarm (Task/TeamCreate)

**Advantages of the built-in swarm:**
- Zero infrastructure — it just works.
- Lower latency — in-process communication vs HTTP.
- The parent agent maintains full context of what was delegated and why.
- Subagents inherit the parent's permissions and environment.

**Advantages of the Bun approach over built-in:**
- Survives parent context exhaustion (the killer feature).
- Truly independent context windows.
- External observability and state persistence.
- Can span multiple machines (theoretical, but real).
- Can use different models per instance.

**Honest take:** The built-in swarm is better for tasks that fit within a single session's context window. The Bun approach becomes valuable when the total work exceeds what any single session can hold, or when you need the work to survive across session boundaries.

---

## When the Bun Approach Actually Makes Sense

1. **Long-running projects** where context will inevitably fill up and instances need to be recycled while preserving coordination state.

2. **Genuinely parallelizable work** — e.g., "Instance A builds the auth module, Instance B builds the payment module, the server ensures they agree on interfaces."

3. **CI/CD-like pipelines** — one instance writes code, another reviews it, a third runs tests. The server orchestrates the pipeline.

4. **When you need a human-readable audit trail** of what happened and why, stored outside any LLM's context.

5. **Mixed-capability setups** — one instance with browser access researches APIs while another writes code. The server routes findings.

---

## When It Doesn't Make Sense

1. **Tasks a single instance can handle** — adding a feature, fixing a bug, refactoring a module. The coordination overhead isn't worth it.

2. **Tasks with tight sequential dependencies** — most real engineering work. You can't parallelize understanding.

3. **When budget matters** — the cost multiplier is real and the productivity gain is often less than 2x for 2x the cost.

4. **Quick iterations** — if you're in a tight feedback loop with Claude, adding a coordination layer just slows you down.

---

## The Honest Bottom Line

The Bun session manager approach solves a real problem: **Claude Code instances are ephemeral and isolated, and complex projects need continuity and coordination that outlives any single instance.**

But it solves it at a cost: complexity, coordination overhead, and the fundamental limitation that LLMs communicating through text lose fidelity compared to a single LLM holding everything in context.

The right framing isn't "this is better than the alternatives." It's "this is the right tool for a specific class of problems" — specifically, projects large enough that no single Claude instance can hold the full picture, where work can genuinely happen in parallel, and where you need the system to survive instance failures.

For everything else, a single instance or a simple loop is not just adequate — it's better. Simpler systems fail in simpler ways, and simpler failures are easier to fix.

The most interesting thing about the Bun approach isn't parallelism — it's **the server as persistent memory and coordination state that exists outside any LLM's context window.** That's the part that's genuinely new and not replicated by any current alternative.
