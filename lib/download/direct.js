/**
 * 直链下载（mp4/m4s/flv 等）：流式落盘 + 三级重试阶梯。
 * 重试阶梯照抄猫抓 downloader.js:246-257：裸请求 → +Range: bytes=0- → +sec-fetch-* 伪装站内。
 */
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fetchRaw, HttpError } from './net.js';
import { createProgress } from '../progress.js';

const RETRY_LADDER = [
  {},
  { range: 'bytes=0-' },
  { range: 'bytes=0-', 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'same-site' },
];

/**
 * @param {object} res 资源对象 {url, headers, size?, ext}
 * @param {string} outPath
 * @param {object} [opts]
 * @param {string} [opts.userAgent]
 * @param {boolean} [opts.showProgress]
 * @returns {Promise<string>} outPath
 */
export async function downloadDirect(res, outPath, opts = {}) {
  const { userAgent, showProgress = true } = opts;
  const label = path.basename(outPath).slice(0, 40);
  let lastErr;

  for (let level = 0; level < RETRY_LADDER.length; level++) {
    const extra = RETRY_LADDER[level];
    let progress = null;
    try {
      const resp = await fetchRaw(res.url, res.headers, { userAgent, extra, timeout: 0 });
      if (!resp.ok || !resp.body) throw new HttpError(resp.status, res.url);

      const total = parseInt(resp.headers.get('content-length') ?? '', 10) || res.size || 0;
      if (showProgress) progress = createProgress(label);

      let received = 0;
      const reader = resp.body.getReader();
      const out = createWriteStream(outPath);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
          if (!out.write(Buffer.from(value))) await once(out, 'drain');
          progress?.update(received, total);
        }
      } finally {
        await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      }
      progress?.done();

      // 完整性校验：已知总长却明显短缺视为失败（进下一级重试）
      if (total > 0 && received < total) {
        throw new Error(`下载不完整：${received}/${total} 字节`);
      }
      const st = await stat(outPath);
      if (st.size === 0) throw new Error('下载结果为空文件');
      return outPath;
    } catch (err) {
      progress?.done();
      lastErr = err;
      if (level < RETRY_LADDER.length - 1) {
        process.stderr.write(`下载失败（${err.message}），切换策略重试 ${level + 2}/${RETRY_LADDER.length}...\n`);
      }
    }
  }
  throw lastErr;
}
