// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  canUseAutoUpdate,
  normalizeUpdateVersion,
} from '../electron/main/update/update-policy';

describe('auto update policy', () => {
  it('enables updates only for packaged Windows production builds', () => {
    expect(
      canUseAutoUpdate({
        isDev: false,
        isPackaged: true,
        platform: 'win32',
      }),
    ).toBe(true);

    expect(
      canUseAutoUpdate({
        isDev: true,
        isPackaged: true,
        platform: 'win32',
      }),
    ).toBe(false);

    expect(
      canUseAutoUpdate({
        isDev: false,
        isPackaged: false,
        platform: 'win32',
      }),
    ).toBe(false);

    expect(
      canUseAutoUpdate({
        isDev: false,
        isPackaged: true,
        platform: 'darwin',
      }),
    ).toBe(false);
  });

  it('formats release versions consistently for user-facing messages', () => {
    expect(normalizeUpdateVersion('0.1.13')).toBe('v0.1.13');
    expect(normalizeUpdateVersion('v0.1.14')).toBe('v0.1.14');
    expect(normalizeUpdateVersion('  ')).toBe('未知版本');
  });
});
