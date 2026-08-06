// 命名空间导入 + 解构：规避 Electron 43 + Node 24 对懒 getter 导出的 ESM 静态分析问题（见 main/index.js 注释）
import * as electron from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '../shared/constants.js';

const { app } = electron;

let cached = null;

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function defaultOutDir() {
  return path.join(app.getPath('downloads'), 'cat_catch');
}

export async function loadSettings() {
  if (cached) return cached;
  let stored = {};
  try {
    const text = await readFile(settingsFile(), 'utf8');
    stored = JSON.parse(text);
  } catch {
    // 首次运行或文件损坏：全部使用默认值
  }
  cached = { ...DEFAULT_SETTINGS, outDir: defaultOutDir(), ...stored };
  return cached;
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  cached = { ...current, ...patch };
  await mkdir(path.dirname(settingsFile()), { recursive: true });
  await writeFile(settingsFile(), JSON.stringify(cached, null, 2), 'utf8');
  return cached;
}
