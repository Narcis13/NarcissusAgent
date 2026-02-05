/**
 * Hooks Controller
 *
 * Event-driven orchestrator that replaces pattern matching with Claude Code's
 * native hooks system. Receives deterministic events via HTTP POST endpoints
 * and coordinates with the supervisor for decision making.
 */

import type {
  StopEvent,
  ToolEvent,
  SessionStartEvent,
  SessionEndEvent,
  HooksControllerState,
  HooksStats,
  HooksEventHandler,
  ToolHistoryEntry,
  SupervisorDecision,
} from './types';

/**
 * Supervisor function type - injected dependency
 */
export type SupervisorFn = (context: {
  taskDescription: string;
  /** Path to worker's session transcript JSONL */
  transcriptPath: string;
  sessionId: string;
}) => Promise<SupervisorDecision>;

export class HooksController {
  private state: HooksControllerState = 'idle';
  private stats: HooksStats;
  private eventHandler: HooksEventHandler;
  private supervisorFn: SupervisorFn | null = null;
  private taskDescription: string = '';
  private sessionId: string = '';
  private transcriptPath: string = '';
  private toolHistory: ToolHistoryEntry[] = [];
  private onInjectFn: ((command: string) => void) | null = null;
  private paused: boolean = false;

  constructor(eventHandler: HooksEventHandler = {}) {
    this.eventHandler = eventHandler;
    this.stats = this.initStats();
  }

  /**
   * Set the supervisor function (dependency injection)
   */
  setSupervisor(fn: SupervisorFn): void {
    this.supervisorFn = fn;
  }

  /**
   * Set the inject callback for PTY writes
   */
  setOnInject(fn: (command: string) => void): void {
    this.onInjectFn = fn;
  }

  /**
   * Start the hooks controller
   */
  start(taskDescription: string): void {
    if (this.state !== 'idle' && this.state !== 'stopped') {
      throw new Error(`Cannot start controller from state: ${this.state}`);
    }

    this.taskDescription = taskDescription;
    this.state = 'monitoring';
    this.stats = this.initStats();
    this.toolHistory = [];
    this.sessionId = '';
  }

  /**
   * Handle Stop event - Claude finished responding
   * This is the primary completion signal.
   */
  async onStop(event: StopEvent): Promise<{ continue: boolean }> {
    if (this.state !== 'monitoring') {
      return { continue: true };
    }

    this.state = 'processing';
    this.stats.stopEvents++;
    this.sessionId = event.session_id;
    this.transcriptPath = event.transcript_path;

    this.eventHandler.onStop?.(event);

    // Call supervisor for decision with transcript path
    await this.callSupervisor();

    return { continue: true };
  }

  /**
   * Handle Tool event - record tool usage, detect errors
   */
  async onTool(event: ToolEvent): Promise<{ continue: boolean }> {
    this.stats.toolCalls++;
    this.sessionId = event.session_id;

    // Record tool in history
    const entry: ToolHistoryEntry = {
      timestamp: new Date(),
      toolName: event.tool_name,
      input: event.tool_input,
      output: event.tool_response.output,
      error: event.tool_response.error,
    };
    this.toolHistory.push(entry);

    // Detect errors
    if (event.tool_response.error) {
      this.stats.errorsDetected++;
    }

    this.eventHandler.onTool?.(event);

    return { continue: true };
  }

  /**
   * Handle SessionStart event
   */
  async onSessionStart(event: SessionStartEvent): Promise<{ continue: boolean }> {
    this.sessionId = event.session_id;
    this.eventHandler.onSessionStart?.(event);
    return { continue: true };
  }

  /**
   * Handle SessionEnd event
   */
  async onSessionEnd(event: SessionEndEvent): Promise<{ continue: boolean }> {
    this.eventHandler.onSessionEnd?.(event);
    this.stop(`Session ended: ${event.reason}`);
    return { continue: true };
  }

  /**
   * Call the supervisor and handle the decision
   */
  private async callSupervisor(): Promise<void> {
    // Skip supervisor call if paused - stay in monitoring state
    if (this.paused) {
      this.state = 'monitoring';
      return;
    }

    if (!this.supervisorFn) {
      // No supervisor configured - default to stop
      const defaultDecision: SupervisorDecision = {
        action: 'stop',
        reason: 'No supervisor configured - task complete',
        confidence: 1.0,
      };
      await this.handleDecision(defaultDecision);
      return;
    }

    this.state = 'calling_supervisor';
    this.stats.supervisorCalls++;

    this.eventHandler.onSupervisorCall?.({ toolHistory: this.toolHistory });

    try {
      const decision = await this.supervisorFn({
        taskDescription: this.taskDescription,
        transcriptPath: this.transcriptPath,
        sessionId: this.sessionId,
      });

      this.eventHandler.onSupervisorDecision?.(decision);
      await this.handleDecision(decision);
    } catch (error) {
      this.eventHandler.onError?.(error as Error);
      this.state = 'monitoring'; // Resume monitoring on error
    }
  }

  /**
   * Handle supervisor decision
   */
  private async handleDecision(decision: SupervisorDecision): Promise<void> {
    switch (decision.action) {
      case 'inject':
        if (!decision.command) {
          throw new Error('inject action requires command');
        }
        this.state = 'injecting';
        this.stats.commandsInjected++;

        // Call the inject callback
        if (this.onInjectFn) {
          this.onInjectFn(decision.command);
        }
        this.eventHandler.onInject?.(decision.command);

        // Clear tool history after injection for fresh context
        this.toolHistory = [];
        this.state = 'monitoring';
        break;

      case 'stop':
        this.stop(decision.reason);
        break;

      case 'abort':
        this.stop(`Aborted: ${decision.reason}`);
        break;

      case 'continue':
        // Inject /clear to close the loop — clears context and keeps Claude going
        this.state = 'injecting';
        this.stats.commandsInjected++;
        if (this.onInjectFn) {
          this.onInjectFn('/clear');
        }
        this.eventHandler.onInject?.('/clear');
        this.toolHistory = [];
        this.state = 'monitoring';
        break;

      case 'clear':
      case 'compact':
        // Return to monitoring
        this.state = 'monitoring';
        break;
    }
  }

  /**
   * Request graceful stop
   */
  stop(reason: string): void {
    this.state = 'stopped';
    this.stats.endTime = new Date();
    this.eventHandler.onControllerStop?.(reason);
  }

  /**
   * Pause supervisor calls (keeps monitoring but won't call supervisor)
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume supervisor calls
   */
  resume(): void {
    this.paused = false;
  }

  /**
   * Check if paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Inject a command directly (for manual control from UI)
   */
  injectCommand(command: string): void {
    if (!this.onInjectFn) {
      throw new Error('No inject handler configured');
    }
    this.stats.commandsInjected++;
    this.onInjectFn(command);
    this.eventHandler.onInject?.(command);
  }

  /**
   * Get current controller state
   */
  getState(): HooksControllerState {
    return this.state;
  }

  /**
   * Get controller statistics
   */
  getStats(): HooksStats {
    return { ...this.stats };
  }

  /**
   * Get tool history
   */
  getToolHistory(): ToolHistoryEntry[] {
    return [...this.toolHistory];
  }

  /**
   * Check if controller is actively running
   */
  isRunning(): boolean {
    return this.state !== 'idle' && this.state !== 'stopped';
  }

  /**
   * Initialize stats for a new run
   */
  private initStats(): HooksStats {
    return {
      stopEvents: 0,
      toolCalls: 0,
      supervisorCalls: 0,
      commandsInjected: 0,
      errorsDetected: 0,
      startTime: new Date(),
      endTime: null,
    };
  }
}
