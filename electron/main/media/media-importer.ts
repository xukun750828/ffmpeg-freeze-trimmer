import path from 'node:path';
import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron';
import { registerMediaPath } from './media-protocol';
import type { OpenVideoResult } from './types';

const OPEN_VIDEO_OPTIONS: OpenDialogOptions = {
  title: '导入本地 MP4',
  buttonLabel: '导入',
  properties: ['openFile'],
  filters: [
    {
      name: 'MP4 Video',
      extensions: ['mp4'],
    },
  ],
};

export async function openVideoDialog(
  parentWindow?: BrowserWindow,
): Promise<OpenVideoResult | null> {
  const result = parentWindow && !parentWindow.isDestroyed()
    ? await dialog.showOpenDialog(parentWindow, OPEN_VIDEO_OPTIONS)
    : await dialog.showOpenDialog(OPEN_VIDEO_OPTIONS);

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
