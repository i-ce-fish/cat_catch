// 命名空间导入 + 解构：规避 Electron 43 + Node 24 对懒 getter 导出的 ESM 静态分析问题（见 main/index.js 注释）
import * as electron from 'electron';
import { IPC } from '../shared/constants.js';
import { loadSettings, saveSettings } from './settings-store.js';
import { startBilibiliLogin, logoutBilibili, getBilibiliLoginStatus } from './login-bilibili.js';

const { ipcMain, dialog, shell } = electron;

function splitBatchText(text) {
  return text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function registerIpcHandlers(mainWindow, runner) {
  ipcMain.handle(IPC.SETTINGS_GET, async () => loadSettings());
  ipcMain.handle(IPC.SETTINGS_SET, async (_e, patch) => saveSettings(patch));

  ipcMain.handle(IPC.SETTINGS_CHOOSE_DIR, async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle(IPC.SETTINGS_OPEN_DIR, async (_e, { path: targetPath }) => {
    if (!targetPath) return;
    shell.showItemInFolder(targetPath);
  });

  ipcMain.handle(IPC.TASK_LIST, async () => runner.list());

  ipcMain.handle(IPC.TASK_SUBMIT_SINGLE, async (_e, { url, config }) => {
    if (!url?.trim()) return [];
    return [runner.submit(url.trim(), config)];
  });

  ipcMain.handle(IPC.TASK_SUBMIT_BATCH, async (_e, { text, config }) => {
    const urls = splitBatchText(text ?? '');
    if (!urls.length) return [];
    return runner.submitMany(urls, config);
  });

  ipcMain.handle(IPC.TASK_RETRY, async (_e, { id }) => runner.retry(id));

  ipcMain.handle(IPC.TASK_OPEN_OUTPUT, async (_e, { path: targetPath }) => {
    if (!targetPath) return;
    shell.showItemInFolder(targetPath);
  });

  ipcMain.handle(IPC.LOGIN_START, async () => {
    startBilibiliLogin(mainWindow, (status) => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.LOGIN_STATUS_EVENT, status);
    });
  });

  ipcMain.handle(IPC.LOGIN_LOGOUT, async () => logoutBilibili());
  ipcMain.handle(IPC.LOGIN_GET_STATUS, async () => getBilibiliLoginStatus());
}
