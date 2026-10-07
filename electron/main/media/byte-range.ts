export interface ByteRange {
  start: number;
  end: number;
}

export function parseByteRange(
  value: string | null,
  size: number,
): ByteRange | null {
  if (!value || !Number.isSafeInteger(size) || size <= 0) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) {
    return null;
  }

  let start: number;
  let end: number;

  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }

    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}
