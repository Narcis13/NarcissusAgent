/**
 * Loop Controller
 *
 * Orchestrates the autonomous loop: monitor -> detect -> analyze -> (supervisor) -> inject
 *
 * The supervisor call is a placeholder in Phase 2 - actual Claude API integration is Phase 3.
 * For now, the controller provides the infrastructure and can be tested with mock supervisors.
 */

import { OutputAnalyzer } from '../output/analyzer.ts';
import { OutputBuffer } from '../output/buffer.ts';
import { Cooldown } from './cooldown.ts';
import type { AnalysisResult } from '../output/types.ts';
import type {
  LoopState,
  LoopConfig,
  LoopEventHandler,
  LoopStats,
  SupervisorDecision,
} from './types.ts';
import { DEFAULT_LOOP_CONFIG } from './types.ts';

/**
 * Supervisor function type - injected dependency for Phase 3 integration
 */
export type SupervisorFn = (context: {
  taskDescription: string;
  recentOutput: string;
  analysis: AnalysisResult;
}) => Promise<SupervisorDecision>;

export class LoopController {
  private state: LoopState = 'idle';
  private config: LoopConfig;
  private analyzer: OutputAnalyzer;
  private buffer: OutputBuffer;
  private cooldown: Cooldown;
  private stats: LoopStats;
  private eventHandler: LoopEventHandler;
  private supervisorFn: SupervisorFn | null = null;
  private taskDescription: string = '';
  private stopRequested: boolean = false;

  constructor(
    config: Partial<LoopConfig> = {},
    eventHandler: LoopEventHandler = {}
  ) {
    this.config = { ...DEFAULT_LOOP_CONFIG, ...config };
    this.analyzer = new OutputAnalyzer();
    this.buffer = new OutputBuffer(this.config.bufferSize);
    this.cooldown = new Cooldown(this.config.minCooldownMs);
    this.eventHandler = eventHandler;
    this.stats = this.initStats();
  }

  /**
   * Set the supervisor function (dependency injection for Phase 3)
   */
  setSupervisor(fn: SupervisorFn): void {
    this.supervisorFn = fn;
  }

  /**
   * Start the autonomous loop
   * @param taskDescription Initial task being executed
   */
  start(taskDescription: string): void {
    if (this.state !== 'idle' && this.state !== 'stopped') {
      throw new Error(`Cannot start loop from state: ${this.state}`);
    }

    this.taskDescription = taskDescription;
    this.state = 'monitoring';
    this.stopRequested = false;
    this.stats = this.initStats();
    this.buffer.clear();
    this.cooldown.reset();
  }

  /**
   * Process incoming PTY output
   * Called by PTYManager.onData handler
   *
   * @param data Raw output bytes from PTY
   */
  async processOutput(data: Uint8Array): Promise<void> {
    if (this.state !== 'monitoring') {
      // Not actively monitoring, just buffer the output
      const text = new TextDecoder().decode(data);
      this.buffer.append(text);
      return;
    }

    // Add to buffer
    const text = new TextDecoder().decode(data);
    this.buffer.append(text);

    // Analyze recent output
    this.state = 'analyzing';
    const recentOutput = this.buffer.getRecent(50);
    const analysis = this.analyzer.analyze(recentOutput);

    this.eventHandler.onAnalysis?.(analysis);

    // Check if we should call supervisor
    if (await this.shouldCallSupervisor(analysis)) {
      await this.callSupervisor(analysis);
    } else {
      // Return to monitoring
      this.state = 'monitoring';
    }

    // Check iteration limit
    this.stats.iterations++;
    if (this.stats.iterations >= this.config.maxIterations) {
      this.stop('Max iterations reached');
    }
  }

  /**
   * Determine if supervisor should be called based on analysis and cooldown
   */
  private async shouldCallSupervisor(analysis: AnalysisResult): Promise<boolean> {
    // Check confidence threshold
    if (analysis.confidence < this.config.confidenceThreshold) {
      return false;
    }

    // Only trigger on completion or error states
    if (analysis.state !== 'completed' && analysis.state !== 'error') {
      return false;
    }

    // Check cooldown
    if (!this.cooldown.canProceed()) {
      this.state = 'waiting_cooldown';
      this.eventHandler.onAnalysis?.(analysis); // Notify that we're waiting
      return false;
    }

    return true;
  }

  /**
   * Call the supervisor and handle the decision
   */
  private async callSupervisor(analysis: AnalysisResult): Promise<void> {
    if (!this.supervisorFn) {
      // No supervisor configured - default to stop on completion, continue on error
      const defaultDecision: SupervisorDecision = {
        action: analysis.state === 'completed' ? 'stop' : 'continue',
        reason: 'No supervisor configured - using default behavior',
        confidence: 1.0,
      };
      await this.handleDecision(defaultDecision);
      return;
    }

    this.state = 'calling_supervisor';
    const recentOutput = this.buffer.getRecent(50);

    this.eventHandler.onSupervisorCall?.({ recentOutput, analysis });

    try {
      this.cooldown.mark(); // Start cooldown before async call
      this.stats.supervisorCalls++;

      const decision = await this.supervisorFn({
        taskDescription: this.taskDescription,
        recentOutput,
        analysis,
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
        this.eventHandler.onInject?.(decision.command);
        this.stats.commandsInjected++;
        // Note: Actual PTY write is handled by caller
        this.state = 'monitoring';
        break;

      case 'stop':
        this.stop(decision.reason);
        break;

      case 'abort':
        this.stop(`Aborted: ${decision.reason}`);
        break;

      case 'continue':
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
    this.stopRequested = true;
    this.eventHandler.onStop?.(reason);
  }

  /**
   * Get current loop state
   */
  getState(): LoopState {
    return this.state;
  }

  /**
   * Get loop statistics
   */
  getStats(): LoopStats {
    return { ...this.stats };
  }

  /**
   * Check if loop is actively running
   */
  isRunning(): boolean {
    return this.state !== 'idle' && this.state !== 'stopped';
  }

  /**
   * Get the output buffer (for external access to recent output)
   */
  getBuffer(): OutputBuffer {
    return this.buffer;
  }

  /**
   * Get the analyzer (for external access to analysis capabilities)
   */
  getAnalyzer(): OutputAnalyzer {
    return this.analyzer;
  }

  /**
   * Initialize stats for a new loop run
   */
  private initStats(): LoopStats {
    return {
      iterations: 0,
      supervisorCalls: 0,
      commandsInjected: 0,
      startTime: new Date(),
      endTime: null,
    };
  }
}
