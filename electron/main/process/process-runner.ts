import { spawn } from 'node:child_process';

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunOptions {
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

class LineAccumulator {
  private pending = '';

  constructor(private readonly onLine?: (line: string) => void) {}

  push(chunk: Buffer | string): void {
    this.pending += chunk.toString();

    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? '';

    for (const line of lines) {
      this.onLine?.(line);
    }
  }

  flush(): void {
    if (this.pending.length > 0) {
      this.onLine?.(this.pending);
      this.pending = '';
    }
  }
}

export function runProcess(
  executable: string,
  args: string[],
  options: ProcessRunOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const stdoutLines = new LineAccumulator(options.onStdoutLine);
    const stderrLines = new LineAccumulator(options.onStderrLine);

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const abortHandler = () => {
      child.kill();
      finishReject(new Error('PROCESS_ABORTED'));
    };

    options.signal?.addEventListener('abort', abortHandler, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      stdoutLines.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      stderrLines.push(chunk);
    });

    child.on('error', () => {
      finishReject(new Error('PROCESS_START_FAILED'));
    });

    child.on('close', (exitCode) => {
      stdoutLines.flush();
      stderrLines.flush();
      options.signal?.removeEventListener('abort', abortHandler);

      if (settled) return;
      settled = true;

      resolve({
        exitCode: exitCode ?? -1,
        stdout,
        stderr,
      });
    });
  });
}
