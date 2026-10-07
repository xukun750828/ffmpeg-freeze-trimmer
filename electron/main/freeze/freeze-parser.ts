import type { FreezeInterval } from './types';

const startRe = /lavfi\.freezedetect\.freeze_start:\s*([0-9.]+)/;
const durationRe = /lavfi\.freezedetect\.freeze_duration:\s*([0-9.]+)/;
const endRe = /lavfi\.freezedetect\.freeze_end:\s*([0-9.]+)/;

interface PendingFreeze {
  startSec: number;
  reportedDurationSec?: number;
}

export class FreezeParser {
  private pending: PendingFreeze | null = null;
  private readonly intervals: FreezeInterval[] = [];
  private nextId = 1;

  pushLine(line: string): void {
    const startMatch = line.match(startRe);
    if (startMatch) {
      const startSec = Number(startMatch[1]);
      if (Number.isFinite(startSec)) {
        this.pending = { startSec };
      }
      return;
    }

    const durationMatch = line.match(durationRe);
    if (durationMatch && this.pending) {
      const durationSec = Number(durationMatch[1]);
      if (Number.isFinite(durationSec)) {
        this.pending.reportedDurationSec = durationSec;
      }
      return;
    }

    const endMatch = line.match(endRe);
    if (endMatch && this.pending) {
      const endSec = Number(endMatch[1]);
      this.completePending(endSec);
    }
  }

  finish(mediaDurationSec?: number): FreezeInterval[] {
    if (
      this.pending &&
      Number.isFinite(mediaDurationSec) &&
      (mediaDurationSec ?? 0) > this.pending.startSec
    ) {
      this.completePending(mediaDurationSec as number);
    }

    this.pending = null;

    return [...this.intervals].sort((a, b) => a.startSec - b.startSec);
  }

  private completePending(endSec: number): void {
    if (!this.pending || !Number.isFinite(endSec) || endSec <= this.pending.startSec) {
      this.pending = null;
      return;
    }

    const startSec = this.pending.startSec;
    this.intervals.push({
      id: `freeze-${String(this.nextId).padStart(4, '0')}`,
      startSec,
      endSec,
      durationSec: endSec - startSec,
      selectedForRemoval: false,
    });

    this.nextId += 1;
    this.pending = null;
  }
}
