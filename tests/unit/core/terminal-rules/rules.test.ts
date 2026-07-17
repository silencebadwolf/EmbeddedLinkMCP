import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERMINAL_RULES,
  appendLineEnding,
  mergeRules,
  parseMarkerSpec,
} from '@/core/terminal-rules/rules.js';
import {
  COMPLETION_BUFFER_MAX_BYTES,
  DEFAULT_LINE_ENDING,
  TERMINAL_RULES_DEFAULT_SETTLE_MS,
  TERMINAL_RULES_DEFAULT_TIMEOUT_MS,
} from '@/shared/constants.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const decode = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('terminal-rules / rules', () => {
  describe('DEFAULT_TERMINAL_RULES', () => {
    it('uses constants from src/shared/constants.ts', () => {
      expect(DEFAULT_TERMINAL_RULES.lineEnding).toBe(DEFAULT_LINE_ENDING);
      expect(DEFAULT_TERMINAL_RULES.defaultTimeoutMs).toBe(TERMINAL_RULES_DEFAULT_TIMEOUT_MS);
      expect(DEFAULT_TERMINAL_RULES.defaultSettleMs).toBe(TERMINAL_RULES_DEFAULT_SETTLE_MS);
      expect(DEFAULT_TERMINAL_RULES.completionBufferMaxBytes).toBe(COMPLETION_BUFFER_MAX_BYTES);
      expect(DEFAULT_TERMINAL_RULES.echoStrategy).toBe('auto');
      expect(DEFAULT_TERMINAL_RULES.completionMarkers).toEqual([]);
    });

    it('CRLF default is \\r\\n', () => {
      expect(DEFAULT_TERMINAL_RULES.lineEnding).toBe('\r\n');
    });
  });

  describe('mergeRules', () => {
    it('returns a fresh copy when override is undefined', () => {
      const out = mergeRules(DEFAULT_TERMINAL_RULES);
      expect(out).not.toBe(DEFAULT_TERMINAL_RULES);
      expect(out.completionMarkers).not.toBe(DEFAULT_TERMINAL_RULES.completionMarkers);
      expect(out.lineEnding).toBe(DEFAULT_TERMINAL_RULES.lineEnding);
    });

    it('overrides individual fields', () => {
      const out = mergeRules(DEFAULT_TERMINAL_RULES, {
        lineEnding: '\n',
        defaultTimeoutMs: 1234,
        defaultSettleMs: 321,
        echoStrategy: 'keep',
      });
      expect(out.lineEnding).toBe('\n');
      expect(out.defaultTimeoutMs).toBe(1234);
      expect(out.defaultSettleMs).toBe(321);
      expect(out.echoStrategy).toBe('keep');
      expect(out.completionMarkers).toEqual([]);
    });

    it('overrides completionMarkers (including with an explicit empty array)', () => {
      const re = /OK\r\n/;
      const merged = mergeRules(DEFAULT_TERMINAL_RULES, { completionMarkers: ['# ', re] });
      expect(merged.completionMarkers).toEqual(['# ', re]);
      // override with [] should result in []
      const cleared = mergeRules(merged, { completionMarkers: [] });
      expect(cleared.completionMarkers).toEqual([]);
    });

    it('does not mutate the base ruleset', () => {
      const base = mergeRules(DEFAULT_TERMINAL_RULES, { completionMarkers: ['# '] });
      mergeRules(base, { completionMarkers: ['$ '] });
      expect(base.completionMarkers).toEqual(['# ']);
    });
  });

  describe('appendLineEnding', () => {
    it('appends CRLF to a payload', () => {
      const out = appendLineEnding(utf8('ls'), '\r\n');
      expect(decode(out)).toBe('ls\r\n');
    });

    it('returns a copy when lineEnding is empty string', () => {
      const src = utf8('hi');
      const out = appendLineEnding(src, '');
      expect(out).toEqual(src);
      expect(out).not.toBe(src);
    });

    it('handles empty payload', () => {
      const out = appendLineEnding(new Uint8Array(0), '\r\n');
      expect(decode(out)).toBe('\r\n');
    });
  });

  describe('parseMarkerSpec', () => {
    it('returns string spec untouched', () => {
      expect(parseMarkerSpec('OK')).toBe('OK');
    });

    it('builds RegExp from object spec', () => {
      const re = parseMarkerSpec({ pattern: '\\d+>', flags: 'i' });
      expect(re).toBeInstanceOf(RegExp);
      const r = re as RegExp;
      expect(r.source).toBe('\\d+>');
      expect(r.flags).toBe('i');
    });

    it('defaults flags to empty when not provided', () => {
      const re = parseMarkerSpec({ pattern: 'foo' }) as RegExp;
      expect(re.flags).toBe('');
    });

    it('throws SyntaxError on invalid pattern (caller decides INVALID_ARGUMENT translation)', () => {
      expect(() => parseMarkerSpec({ pattern: '[unterminated' })).toThrow();
    });
  });
});
