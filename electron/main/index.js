import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 命名导入在 Electron 43 + Node 24 下会因 CJS→ESM 静态导出分析（懒 getter 导出如 BrowserWindow）报错，
// 见 electron/electron#40184、wavetermdev/waveterm#3213；改用命名空间导入 + 解构规避。
import * as electron from 'electron';
import { registerIpcHandlers } from './ipc-handlers.js';
import { IPC } from '../shared/constants.js';

const { app, BrowserWindow } = electron;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.ELECTRON_RENDERER_URL;

// 打包后 Playwright Chromium 随应用分发在 extraResources 里，需在加载 playwright 之前设置好这个环境变量
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'playwright-browsers');
}

let mainWindow = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    title: 'cat_catch',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 动态 import：确保上面设置 PLAYWRIGHT_BROWSERS_PATH 之后才加载 task-runner.js（间接引入 playwright）
  const { TaskRunner } = await import('./task-runner.js');
  const runner = new TaskRunner({
    onUpdate: (task) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(IPC.TASK_UPDATE_EVENT, task);
    },
  });
  registerIpcHandlers(mainWindow, runner);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
