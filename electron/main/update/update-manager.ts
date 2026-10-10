import { app, dialog, type BrowserWindow } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { canUseAutoUpdate, normalizeUpdateVersion } from './update-policy';

const AUTO_CHECK_DELAY_MS = 5_000;

type CheckSource = 'automatic' | 'manual';

interface CheckContext {
  source: CheckSource;
  window: BrowserWindow;
}

export class AppUpdateManager {
  private checking = false;
  private downloading = false;
  private automaticCheckScheduled = false;
  private activeCheck: CheckContext | null = null;
  private downloadWindow: BrowserWindow | null = null;
  private availableVersion: string | null = null;

  constructor(private readonly isDev: boolean) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('update-available', (info) => {
      void this.handleUpdateAvailable(info);
    });
    autoUpdater.on('update-not-available', () => {
      void this.handleUpdateNotAvailable();
    });
    autoUpdater.on('download-progress', (progress) => {
      const window = this.downloadWindow;
      if (!window || window.isDestroyed()) return;
      window.setProgressBar(Math.max(0, Math.min(1, progress.percent / 100)));
    });
    autoUpdater.on('update-downloaded', (info) => {
      void this.handleUpdateDownloaded(info);
    });
    autoUpdater.on('error', (error) => {
      void this.handleError(error);
    });
  }

  scheduleAutomaticCheck(window: BrowserWindow): void {
    if (this.automaticCheckScheduled || !this.isEnabled()) return;
    this.automaticCheckScheduled = true;

    const schedule = () => {
      setTimeout(() => {
        if (!window.isDestroyed()) {
          void this.checkForUpdates(window, 'automatic');
        }
      }, AUTO_CHECK_DELAY_MS);
    };

    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', schedule);
    } else {
      schedule();
    }
  }

  async checkForUpdates(
    window: BrowserWindow,
    source: CheckSource = 'manual',
  ): Promise<void> {
    if (!this.isEnabled()) {
      if (source === 'manual' && !window.isDestroyed()) {
        await dialog.showMessageBox(window, {
          type: 'info',
          title: '检查更新',
          message: '开发环境不执行自动更新检查',
          detail: '请使用已安装的 Windows 正式版本测试自动升级。',
          buttons: ['知道了'],
        });
      }
      return;
    }

    if (this.downloading) {
      if (source === 'manual' && !window.isDestroyed()) {
        await dialog.showMessageBox(window, {
          type: 'info',
          title: '正在下载更新',
          message: this.availableVersion
            ? `正在下载 ${normalizeUpdateVersion(this.availableVersion)}`
            : '正在下载新版本',
          buttons: ['知道了'],
        });
      }
      return;
    }

    if (this.checking) {
      if (source === 'manual' && !window.isDestroyed()) {
        await dialog.showMessageBox(window, {
          type: 'info',
          title: '检查更新',
          message: '正在检查更新，请稍候…',
          buttons: ['知道了'],
        });
      }
      return;
    }

    this.checking = true;
    this.activeCheck = { source, window };

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      if (this.checking) {
        await this.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private isEnabled(): boolean {
    return canUseAutoUpdate({
      isDev: this.isDev,
      isPackaged: app.isPackaged,
      platform: process.platform,
    });
  }

  private takeCheckContext(): CheckContext | null {
    const context = this.activeCheck;
    this.activeCheck = null;
    this.checking = false;
    return context;
  }

  private async handleUpdateAvailable(info: UpdateInfo): Promise<void> {
    const context = this.takeCheckContext();
    if (!context || context.window.isDestroyed()) return;

    this.availableVersion = info.version;
    const result = await dialog.showMessageBox(context.window, {
      type: 'info',
      title: '发现新版本',
      message: `发现 ${normalizeUpdateVersion(info.version)}`,
      detail: `当前版本 ${normalizeUpdateVersion(app.getVersion())}。是否现在后台下载更新？`,
      buttons: ['下载更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (result.response !== 0) return;

    this.downloading = true;
    this.downloadWindow = context.window;
    context.window.setProgressBar(0);

    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      if (this.downloading) {
        await this.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private async handleUpdateNotAvailable(): Promise<void> {
    const context = this.takeCheckContext();
    if (
      !context ||
      context.source !== 'manual' ||
      context.window.isDestroyed()
    ) {
      return;
    }

    await dialog.showMessageBox(context.window, {
      type: 'info',
      title: '检查更新',
      message: '当前已是最新版本',
      detail: `当前版本 ${normalizeUpdateVersion(app.getVersion())}`,
      buttons: ['知道了'],
    });
  }

  private async handleUpdateDownloaded(info: UpdateInfo): Promise<void> {
    const window = this.downloadWindow;
    this.downloading = false;
    this.availableVersion = info.version;
    this.downloadWindow = null;

    if (!window || window.isDestroyed()) return;
    window.setProgressBar(-1);

    const result = await dialog.showMessageBox(window, {
      type: 'info',
      title: '更新已下载',
      message: `${normalizeUpdateVersion(info.version)} 已准备就绪`,
      detail: '可以立即重启并安装，也可以稍后关闭应用时自动安装。',
      buttons: ['立即重启安装', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  }

  private async handleError(error: Error): Promise<void> {
    const context = this.takeCheckContext();
    const window = this.downloadWindow ?? context?.window ?? null;
    const shouldNotify = context?.source === 'manual' || this.downloading;

    this.downloading = false;
    this.downloadWindow = null;
    this.availableVersion = null;

    if (window && !window.isDestroyed()) {
      window.setProgressBar(-1);
    }

    console.error('[auto-update]', error);

    if (shouldNotify && window && !window.isDestroyed()) {
      await dialog.showMessageBox(window, {
        type: 'warning',
        title: '更新检查失败',
        message: '暂时无法完成更新检查或下载',
        detail: '不会影响当前功能，请稍后从“帮助 → 检查更新…”重试。',
        buttons: ['知道了'],
      });
    }
  }
}
