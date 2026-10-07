import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';

const mediaRegistry = new Map<string, string>();

export function registerMediaPath(filePath: string): string {
  const token = randomUUID();
  mediaRegistry.set(token, filePath);
  return `app-media://video/${token}`;
}

export function registerMediaProtocol(): void {
  protocol.handle('app-media', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'video') {
      return new Response('Not found', { status: 404 });
    }

    const token = url.pathname.replace(/^\//, '');
    const filePath = mediaRegistry.get(token);
    if (!filePath) {
      return new Response('Not found', { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

export function clearMediaRegistry(): void {
  mediaRegistry.clear();
}
