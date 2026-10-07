import { describe, expect, it } from 'vitest';
import { getUserFriendlyError } from '../src/utils/error-message';

describe('getUserFriendlyError', () => {
  it('maps known backend error codes to user-friendly Chinese messages', () => {
    expect(getUserFriendlyError(new Error('NO_KEEP_RANGE'), 'fallback')).toContain('删除整个视频');
    expect(getUserFriendlyError(new Error('FFPROBE_FAILED'), 'fallback')).toContain('媒体信息');
  });

  it('falls back to the raw backend message when no code mapping exists', () => {
    expect(getUserFriendlyError(new Error('custom failure'), 'fallback')).toBe('custom failure');
  });

  it('uses fallback when there is no useful error detail', () => {
    expect(getUserFriendlyError(null, 'fallback')).toBe('fallback');
  });
});
