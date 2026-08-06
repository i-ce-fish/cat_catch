import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const browsersDir = path.join(root, 'playwright-browsers');
const cli = path.join(root, 'node_modules/playwright/cli.js');

// Linux 无头环境跑 Chromium 缺系统库是常见坑：--with-deps 让 Playwright 自己 apt 装齐
// （GitHub Actions 的 ubuntu-latest runner 自带免密 sudo，可直接用）
const args = ['install', 'chromium'];
if (process.platform === 'linux') args.push('--with-deps');

console.log(`[fetch-playwright-browsers] 下载 Chromium 到 ${browsersDir} ...`);
execFileSync(process.execPath, [cli, ...args], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir },
});
console.log('[fetch-playwright-browsers] 完成');
