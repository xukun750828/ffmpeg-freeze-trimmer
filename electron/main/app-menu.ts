import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { openVideoDialog } from './media/media-importer';

export function installApplicationMenu(window: BrowserWindow): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '导入本地 MP4…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (window.isDestroyed()) return;

            window.focus();
            const selected = await openVideoDialog(window);

            if (selected && !window.isDestroyed()) {
              window.webContents.send('menu:video-selected', selected);
            }
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          role: 'quit',
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
