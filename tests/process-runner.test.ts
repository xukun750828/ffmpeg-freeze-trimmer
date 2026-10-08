// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  runProcess,
  runProcessBinary,
} from '../electron/main/process/process-runner';

describe('runProcess', () => {
  it('captures binary stdout without converting bytes to text', async () => {
    const result = await runProcessBinary(process.execPath, [
      '-e',
      "process.stdout.write(Buffer.from([0, 255, 1, 128])); process.stderr.write('binary-warn\\n');",
    ]);

    expect(result.exitCode).toBe(0);
    expect([...result.stdout]).toEqual([0, 255, 1, 128]);
    expect(result.stderr).toContain('binary-warn');
  });

  it('captures stdout, stderr, exit code, and line callbacks', async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const result = await runProcess(
      process.execPath,
      [
        '-e',
        "process.stdout.write('one\\ntwo\\n'); process.stderr.write('warn\\n');",
      ],
      {
        onStdoutLine: (line) => stdoutLines.push(line),
        onStderrLine: (line) => stderrLines.push(line),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('one');
    expect(result.stderr).toContain('warn');
    expect(stdoutLines).toEqual(['one', 'two']);
    expect(stderrLines).toEqual(['warn']);
  });
});
