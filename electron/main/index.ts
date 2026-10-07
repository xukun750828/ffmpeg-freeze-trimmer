import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron';
import path from 'node:path';
import { installApplicationMenu } from './app-menu';
import { VideoExporter } from './export/video-exporter';
import type { ExportRequest } from './export/types';
import { detectFreezes } from './freeze/freeze-detector';
import type { DetectionOptions } from './freeze/types';
import { openVideoDialog } from './media/media-importer';
import { probeMedia } from './media/media-probe';
import { clearMediaRegistry, registerMediaProtocol } from './media/media-protocol';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const videoExporter = new VideoExporter();

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  installApplicationMenu(window);
  return window;
}

function validateDetectionOptions(options: DetectionOptions): void {
  if (
    !Number.isFinite(options.noise) ||
    options.noise <= 0 ||
    options.noise > 1 ||
    !Number.isFinite(options.minDurationSec) ||
    options.minDurationSec < 0.1 ||
    options.minDurationSec > 3600
  ) {
    throw new Error('INVALID_DETECTION_OPTIONS');
  }
}

app.whenReady().then(() => {
  registerMediaProtocol();

  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('media:open', () => openVideoDialog());
  ipcMain.handle('media:probe', (_event, mediaPath: string) => probeMedia(mediaPath));
  ipcMain.handle(
    'freeze:detect',
    (
      _event,
      request: {
        path: string;
        durationSec: number;
        options: DetectionOptions;
      },
    ) => {
      validateDetectionOptions(request.options);

      if (!Number.isFinite(request.durationSec) || request.durationSec <= 0) {
        throw new Error('INVALID_MEDIA_DURATION');
      }

      return detectFreezes(
        request.path,
        request.durationSec,
        request.options,
      );
    },
  );

  ipcMain.handle('export:choose-output', async (_event, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      title: '导出裁剪后的视频',
      defaultPath: defaultName,
      filters: [
        {
          name: 'MP4 Video',
          extensions: ['mp4'],
        },
      ],
    });

    return result.canceled ? null : result.filePath ?? null;
  });

  ipcMain.handle('export:start', (event, request: ExportRequest) => {
    return videoExporter.start(
      request,
      (progressEvent) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('export:progress', progressEvent);
        }
      },
      (finishedEvent) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('export:finished', finishedEvent);
        }
      },
    );
  });

  ipcMain.handle('export:cancel', (_event, jobId: string) => {
    videoExporter.cancel(jobId);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  clearMediaRegistry();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
