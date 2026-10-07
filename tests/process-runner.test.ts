// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { runProcess } from '../electron/main/process/process-runner';

describe('runProcess', () => {
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
