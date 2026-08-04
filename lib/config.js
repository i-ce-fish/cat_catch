/**
 * 项目配置文件加载：cat_catch.config.json（项目根目录）。
 * 文件不存在或解析失败时静默回落默认值；CLI 参数优先级高于配置。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const CONFIG_FILE = 'cat_catch.config.json';

const DEFAULTS = {
  /** 单个 m4s（未参与音画配对的视频轨/音频轨）落盘时的输出格式；'m4s' 表示保留原样不转换 */
  singleM4sFormat: 'mp3',
};

/**
 * @param {string} projectRoot 项目根目录（catch.js 所在处）
 * @returns {Promise<typeof DEFAULTS>}
 */
export async function loadConfig(projectRoot) {
  let user = {};
  try {
    const text = await readFile(path.join(projectRoot, CONFIG_FILE), 'utf8');
    user = JSON.parse(text);
  } catch {
    // 无配置文件或 JSON 损坏：全默认
  }
  return { ...DEFAULTS, ...user };
}
