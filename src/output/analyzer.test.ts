/**
 * Output Analyzer Tests
 *
 * TDD test suite for OutputAnalyzer - the core component that strips ANSI codes,
 * runs pattern matching, and calculates confidence scores for state detection.
 */

import { describe, test, expect } from 'bun:test';
import { OutputAnalyzer } from './analyzer.ts';

describe('OutputAnalyzer', () => {
  const analyzer = new OutputAnalyzer();

  describe('ANSI stripping', () => {
    test('strips ANSI codes before matching', () => {
      const result = analyzer.analyze('\x1b[32mI\'ve finished\x1b[0m');
      expect(result.cleanOutput).toBe("I've finished");
      expect(result.state).toBe('completed');
    });

    test('handles complex ANSI sequences', () => {
      const result = analyzer.analyze('\x1b[1;31mError:\x1b[0m something failed');
      expect(result.cleanOutput).toBe('Error: something failed');
    });

    test('handles multiple ANSI codes', () => {
      const result = analyzer.analyze('\x1b[33m[\x1b[1mWARN\x1b[0m\x1b[33m]\x1b[0m Cannot find file');
      expect(result.cleanOutput).toBe('[WARN] Cannot find file');
    });
  });

  describe('completion detection', () => {
    test('detects "I\'ve finished" as completed', () => {
      const result = analyzer.analyze("I've finished the task");
      expect(result.state).toBe('completed');
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });

    test('detects "I have completed" as completed', () => {
      const result = analyzer.analyze('I have completed the implementation');
      expect(result.state).toBe('completed');
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });

    test('detects "Successfully created" as completed', () => {
      const result = analyzer.analyze('Successfully created the file');
      expect(result.state).toBe('completed');
    });

    test('detects "What would you like" as completed', () => {
      const result = analyzer.analyze('What would you like me to do next?');
      expect(result.state).toBe('completed');
    });

    test('detects exit code 0 as completed with high confidence', () => {
      const result = analyzer.analyze('Process exited with code: 0');
      expect(result.state).toBe('completed');
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    test('detects "Is there anything else" as completed', () => {
      const result = analyzer.analyze('Is there anything else I can help with?');
      expect(result.state).toBe('completed');
    });
  });

  describe('error detection', () => {
    test('detects "Error:" as error', () => {
      const result = analyzer.analyze('Error: file not found');
      expect(result.state).toBe('error');
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });

    test('detects "Failed:" as error', () => {
      const result = analyzer.analyze('Failed: compilation failed with errors');
      expect(result.state).toBe('error');
    });

    test('detects exit code 1 as error with high confidence', () => {
      const result = analyzer.analyze('Process exited with code: 1');
      expect(result.state).toBe('error');
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    test('detects ENOENT as error', () => {
      const result = analyzer.analyze('ENOENT: no such file or directory');
      expect(result.state).toBe('error');
    });

    test('detects "command not found" as error', () => {
      const result = analyzer.analyze('bash: xyz: command not found');
      expect(result.state).toBe('error');
    });

    test('detects "Cannot" as error', () => {
      const result = analyzer.analyze('Cannot read property of undefined');
      expect(result.state).toBe('error');
    });

    test('detects fatal/critical/panic as error', () => {
      const result = analyzer.analyze('fatal: not a git repository');
      expect(result.state).toBe('error');
    });
  });

  describe('prompt_ready detection', () => {
    test('detects standalone > prompt', () => {
      const result = analyzer.analyze('some output\n>\n');
      expect(result.state).toBe('prompt_ready');
    });

    test('detects "waiting for input"', () => {
      const result = analyzer.analyze('waiting for input from user');
      expect(result.state).toBe('prompt_ready');
    });

    test('detects "Press Enter"', () => {
      const result = analyzer.analyze('Press Enter to continue');
      expect(result.state).toBe('prompt_ready');
    });
  });

  describe('running detection', () => {
    test('detects "Running" as running', () => {
      const result = analyzer.analyze('Running npm install');
      expect(result.state).toBe('running');
    });

    test('detects "Installing" as running', () => {
      const result = analyzer.analyze('Installing dependencies');
      expect(result.state).toBe('running');
    });

    test('detects ellipsis as running', () => {
      const result = analyzer.analyze('Processing...');
      expect(result.state).toBe('running');
    });
  });

  describe('confidence scoring', () => {
    test('multiple matching patterns increase confidence', () => {
      const singleMatch = analyzer.analyze("I've finished");
      const multiMatch = analyzer.analyze("I've finished. What would you like next?");
      expect(multiMatch.confidence).toBeGreaterThan(singleMatch.confidence);
    });

    test('confidence is capped at 1.0', () => {
      const result = analyzer.analyze(
        "I've finished. Successfully created. What would you like? Let me know if needed. Is there anything else?"
      );
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    test('no matches returns running state with 0 confidence', () => {
      const result = analyzer.analyze('some random text that matches nothing');
      expect(result.state).toBe('running');
      expect(result.confidence).toBe(0);
    });

    test('confidence is between 0 and 1', () => {
      const result = analyzer.analyze("I've finished the task");
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('exclusive patterns', () => {
    test('exit code 0 penalizes error category', () => {
      const result = analyzer.analyze('Error: something happened\nexited with code: 0');
      // Exit code 0 is exclusive for completion, should win over error
      expect(result.state).toBe('completed');
    });

    test('exit code 1 penalizes completion category', () => {
      const result = analyzer.analyze("I've finished\nexited with code: 1");
      // Exit code 1 is exclusive for error, should win
      expect(result.state).toBe('error');
    });

    test('exit code 255 is detected as error', () => {
      const result = analyzer.analyze('Process exited with code: 255');
      expect(result.state).toBe('error');
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('category scores', () => {
    test('provides per-category breakdown', () => {
      const result = analyzer.analyze("I've finished");
      expect(result.categoryScores).toBeDefined();
      expect(result.categoryScores.get('completion')).toBeGreaterThan(0);
    });

    test('error category has score when error detected', () => {
      const result = analyzer.analyze('Error: failed');
      expect(result.categoryScores.get('error')).toBeGreaterThan(0);
    });

    test('multiple categories can have scores', () => {
      const result = analyzer.analyze("Error: but I've finished anyway");
      expect(result.categoryScores.get('error')).toBeGreaterThan(0);
      expect(result.categoryScores.get('completion')).toBeGreaterThan(0);
    });
  });

  describe('matches array', () => {
    test('includes all pattern match results', () => {
      const result = analyzer.analyze("I've finished");
      expect(result.matches).toBeDefined();
      expect(Array.isArray(result.matches)).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
    });

    test('matched patterns have evidence', () => {
      const result = analyzer.analyze("I've finished the task");
      const matchedPattern = result.matches.find(m => m.matched);
      expect(matchedPattern).toBeDefined();
      expect(matchedPattern!.evidence.length).toBeGreaterThan(0);
    });

    test('unmatched patterns have empty evidence', () => {
      const result = analyzer.analyze("I've finished");
      const unmatchedPattern = result.matches.find(m => !m.matched);
      expect(unmatchedPattern).toBeDefined();
      expect(unmatchedPattern!.evidence).toEqual([]);
    });
  });
});
