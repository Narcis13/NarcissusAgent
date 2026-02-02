/**
 * Pattern Definitions
 *
 * Regex patterns for detecting terminal output states.
 * Based on Claude Code output analysis from research phase.
 *
 * Patterns are categorized and weighted for confidence scoring.
 * Multiple matching patterns increase confidence; contradictions decrease it.
 */

import type { PatternWeight, PatternCategory } from './types.ts';

/**
 * All detection patterns with their categories and weights
 *
 * Weight guidelines:
 * - 0.1-0.2: Weak signal, needs corroboration
 * - 0.3-0.4: Moderate signal
 * - 0.5+: Strong signal (use exclusive flag)
 */
export const PATTERNS: PatternWeight[] = [
  // === COMPLETION PATTERNS ===
  // Strong signals that task is done
  {
    pattern: /(?:I'?ve|I have) (?:finished|completed|done)/i,
    category: 'completion',
    weight: 0.4,
  },
  {
    pattern: /(?:Successfully|Completed) (?:created|updated|fixed|implemented|added)/i,
    category: 'completion',
    weight: 0.3,
  },
  {
    pattern: /What (?:would you like|else|should I)/i,
    category: 'completion',
    weight: 0.35,
  },
  {
    pattern: /Let me know if/i,
    category: 'completion',
    weight: 0.25,
  },
  {
    pattern: /Is there anything else/i,
    category: 'completion',
    weight: 0.3,
  },
  // Claude's typical greeting/ready prompts
  {
    pattern: /How can I help you/i,
    category: 'completion',
    weight: 0.35,
  },
  {
    pattern: /What can I (?:help|do|assist)/i,
    category: 'completion',
    weight: 0.35,
  },
  // Exit code 0 is definitive completion
  {
    pattern: /exited? with code:?\s*0/i,
    category: 'completion',
    weight: 0.6,
    exclusive: true,
  },

  // === ERROR PATTERNS ===
  // Signals that something went wrong
  {
    pattern: /(?:Error|Exception|Failed|Failure):/i,
    category: 'error',
    weight: 0.35,
  },
  {
    pattern: /(?:Cannot|Could not|Unable to)/i,
    category: 'error',
    weight: 0.25,
  },
  {
    pattern: /(?:ENOENT|EACCES|EPERM|ENOTFOUND)/i,
    category: 'error',
    weight: 0.4,
  },
  {
    pattern: /command not found/i,
    category: 'error',
    weight: 0.35,
  },
  // Non-zero exit is definitive error
  {
    pattern: /exited? with code:?\s*[1-9]\d*/i,
    category: 'error',
    weight: 0.6,
    exclusive: true,
  },
  {
    pattern: /(?:fatal|critical|panic):/i,
    category: 'error',
    weight: 0.45,
  },

  // === PROMPT READY PATTERNS ===
  // Signals waiting for input
  {
    pattern: /^\s*>\s*$/m,
    category: 'prompt_ready',
    weight: 0.3,
  },
  {
    pattern: /^\s*\$\s*$/m,
    category: 'prompt_ready',
    weight: 0.25,
  },
  {
    pattern: /waiting for (?:input|response)/i,
    category: 'prompt_ready',
    weight: 0.3,
  },
  {
    pattern: /Press (?:Enter|any key)/i,
    category: 'prompt_ready',
    weight: 0.35,
  },

  // === RUNNING PATTERNS ===
  // Signals active work in progress
  {
    pattern: /(?:Reading|Writing|Creating|Updating|Deleting) (?:file|directory)/i,
    category: 'running',
    weight: 0.3,
  },
  {
    pattern: /(?:Running|Executing|Installing|Building)/i,
    category: 'running',
    weight: 0.25,
  },
  {
    pattern: /(?:Analyzing|Processing|Parsing)/i,
    category: 'running',
    weight: 0.2,
  },
  {
    pattern: /\.\.\.\s*$/m,
    category: 'running',
    weight: 0.15,
  },
  {
    pattern: /(?:please wait|in progress)/i,
    category: 'running',
    weight: 0.25,
  },
  // Claude Code TUI progress indicators
  {
    pattern: /Baking/i,
    category: 'running',
    weight: 0.3,
  },
  {
    pattern: /thinking/i,
    category: 'running',
    weight: 0.25,
  },
];

/**
 * Get patterns filtered by category
 */
export function getPatternsByCategory(category: PatternCategory): PatternWeight[] {
  return PATTERNS.filter(p => p.category === category);
}

/**
 * Default confidence threshold for triggering supervisor
 * Based on requirements: 70%
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Categories that should trigger supervisor analysis
 */
export const TRIGGER_CATEGORIES: PatternCategory[] = ['completion', 'error'];
