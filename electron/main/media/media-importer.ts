import path from 'node:path';
import { dialog } from 'electron';
import { registerMediaPath } from './media-protocol';
import type { OpenVideoResult } from './types';

export async function openVideoDialog(): Promise<OpenVideoResult | null> {
  const result = await dialog.showOpenDialog({
    title: '打开 MP4 视频',
    properties: ['openFile'],
    filters: [
      {
        name: 'MP4 Video',
        extensions: ['mp4'],
      },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  return {
    path: filePath,
    name: path.basename(filePath),
    sourceUrl: registerMediaPath(filePath),
  };
}
