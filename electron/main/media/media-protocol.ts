import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { parseByteRange } from './byte-range';

const mediaRegistry = new Map<string, string>();

export function registerMediaPath(filePath: string): string {
  const token = randomUUID();
  mediaRegistry.set(token, filePath);
  return `app-media://video/${token}`;
}

export function registerMediaProtocol(): void {
  protocol.handle('app-media', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'video') {
      return new Response('Not found', { status: 404 });
    }

    const token = url.pathname.replace(/^\//, '');
    const filePath = mediaRegistry.get(token);
    if (!filePath) {
      return new Response('Not found', { status: 404 });
    }

    let mediaStat;
    try {
      mediaStat = await stat(filePath);
    } catch {
      return new Response('Not found', { status: 404 });
    }

    if (!mediaStat.isFile()) {
      return new Response('Not found', { status: 404 });
    }

    const size = mediaStat.size;
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Type': 'video/mp4',
    });

    const rangeHeader = request.headers.get('range');
    let start = 0;
    let end = size - 1;
    let status = 200;

    if (rangeHeader) {
      const range = parseByteRange(rangeHeader, size);
      if (!range) {
        headers.set('Content-Range', `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }

      start = range.start;
      end = range.end;
      status = 206;
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }

    headers.set('Content-Length', String(end - start + 1));

    if (request.method === 'HEAD') {
      return new Response(null, { status, headers });
    }

    const stream = createReadStream(filePath, { start, end });
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

    return new Response(body, {
      status,
      headers,
    });
  });
}

export function clearMediaRegistry(): void {
  mediaRegistry.clear();
}
