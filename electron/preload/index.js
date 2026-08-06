// 命名空间导入 + 解构：规避 Electron 43 + Node 24 对懒 getter 导出的 ESM 静态分析问题（见 main/index.js 注释）
import * as electron from 'electron';
import { IPC } from '../shared/constants.js';

const { contextBridge, ipcRenderer } = electron;

function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('catCatch', {
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (patch) => ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
  chooseOutputDir: () => ipcRenderer.invoke(IPC.SETTINGS_CHOOSE_DIR),

  listTasks: () => ipcRenderer.invoke(IPC.TASK_LIST),
  submitSingle: (url, config) => ipcRenderer.invoke(IPC.TASK_SUBMIT_SINGLE, { url, config }),
  submitBatch: (text, config) => ipcRenderer.invoke(IPC.TASK_SUBMIT_BATCH, { text, config }),
  retryTask: (id) => ipcRenderer.invoke(IPC.TASK_RETRY, { id }),
  openOutput: (path) => ipcRenderer.invoke(IPC.TASK_OPEN_OUTPUT, { path }),
  onTaskUpdate: (callback) => on(IPC.TASK_UPDATE_EVENT, callback),

  bilibiliLogin: {
    start: () => ipcRenderer.invoke(IPC.LOGIN_START),
    logout: () => ipcRenderer.invoke(IPC.LOGIN_LOGOUT),
    getStatus: () => ipcRenderer.invoke(IPC.LOGIN_GET_STATUS),
    onStatus: (callback) => on(IPC.LOGIN_STATUS_EVENT, callback),
  },
});
