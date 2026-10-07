import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

export function installApplicationMenu(window: BrowserWindow): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '导入本地 MP4…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (!window.isDestroyed()) {
              window.webContents.send('menu:open-video');
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
