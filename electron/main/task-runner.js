// 命名空间导入 + 解构：规避 Electron 43 + Node 24 对懒 getter 导出的 ESM 静态分析问题（见 main/index.js 注释）
import * as electron from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sniff, UnsupportedError } from '../../lib/sniffer.js';
import { pickResources, dashPair } from '../../lib/picker.js';
import { downloadResources } from '../../lib/download/index.js';
import { ensureCookie, ensureReferer } from '../../lib/headers.js';
import { MAX_SNIFF_ATTEMPTS, MEDIA_TYPE, TASK_STATUS } from '../shared/constants.js';
import { loadBilibiliCookies } from './login-bilibili.js';

const { app } = electron;

const MEDIA_URL_RE = /\.(m3u8|m3u|mpd|mp4|m4s|flv|mp3|m4a|aac|webm|mkv|mov|wav|ogg)(\?|#|$)/i;
const BILIBILI_RE = /bilibili\.com/;

function profileDir() {
  return path.join(app.getPath('userData'), 'catch-profile');
}

/**
 * 内存任务队列：嗅探（0 资源重试 ≤3 次）→ 选取 → 下载，全程通过 onUpdate 推送状态快照。
 */
export class TaskRunner {
  constructor({ onUpdate = () => {}, concurrency = 2 } = {}) {
    this.tasks = new Map();
    this.onUpdate = onUpdate;
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  list() {
    return [...this.tasks.values()];
  }

  /** @param {string} url @param {object} config {outDir, mediaType, transcode, format, concurrency} */
  submit(url, config) {
    const id = randomUUID();
    const task = {
      id,
      url,
      config,
      status: TASK_STATUS.QUEUED,
      attempt: 0,
      phase: '',
      percent: 0,
      error: null,
      outputFiles: [],
    };
    this.tasks.set(id, task);
    this._emit(task);
    this.queue.push(id);
    this._pump();
    return task;
  }

  submitMany(urls, config) {
    return urls.map((url) => this.submit(url, config));
  }

  retry(id) {
    const task = this.tasks.get(id);
    if (!task) return null;
    task.status = TASK_STATUS.QUEUED;
    task.attempt = 0;
    task.error = null;
    task.percent = 0;
    task.phase = '';
    this._emit(task);
    this.queue.push(id);
    this._pump();
    return task;
  }

  _pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const id = this.queue.shift();
      const task = this.tasks.get(id);
      if (!task) continue;
      this.running++;
      this._run(task).finally(() => {
        this.running--;
        this._pump();
      });
    }
  }

  _emit(task) {
    this.onUpdate({ ...task });
  }

  async _run(task) {
    const { url, config } = task;
    const log = (msg) => this._debug(task, msg);

    try {
      let resources = [];
      let cookies = [];
      let userAgent;
      let pageTitle = '';

      const directMatch = MEDIA_URL_RE.exec(url);
      if (directMatch) {
        resources = [{ url, ext: directMatch[1].toLowerCase(), source: 'direct', headers: {} }];
      } else {
        const isBilibili = BILIBILI_RE.test(url);
        const presetCookies = isBilibili ? await loadBilibiliCookies() : null;

        for (let attempt = 1; attempt <= MAX_SNIFF_ATTEMPTS; attempt++) {
          task.attempt = attempt;
          task.status = attempt === 1 ? TASK_STATUS.SNIFFING : TASK_STATUS.RETRYING;
          task.phase = attempt === 1 ? '嗅探中' : `嗅探重试 ${attempt}/${MAX_SNIFF_ATTEMPTS}`;
          this._emit(task);

          let result;
          try {
            result = await sniff(url, {
              profileDir: profileDir(),
              cookies: presetCookies ?? undefined,
              log,
              infoLog: log,
            });
          } catch (err) {
            if (err instanceof UnsupportedError) {
              task.status = TASK_STATUS.FAILED;
              task.error = err.message;
              this._emit(task);
              return;
            }
            throw err;
          }

          resources = result.resources;
          cookies = result.cookies;
          userAgent = result.userAgent;
          pageTitle = result.pageTitle;

          if (result.dashInfo) {
            const pair = dashPair(result.dashInfo, pageTitle);
            if (pair) resources.unshift(pair.video, pair.audio);
          }

          if (resources.length > 0) break;
          if (attempt < MAX_SNIFF_ATTEMPTS) await new Promise((r) => setTimeout(r, 800 * attempt));
        }
      }

      if (resources.length === 0) {
        task.status = TASK_STATUS.FAILED;
        task.error = '未嗅探到任何媒体资源（已重试 3 次）';
        this._emit(task);
        return;
      }

      for (const res of resources) {
        res.headers = ensureReferer(res.headers ?? {}, res.pageUrl ?? url);
        res.headers = ensureCookie(res.headers, cookies);
      }

      const pickMode = config.mediaType === MEDIA_TYPE.AUDIO ? 'audio' : 'best';
      const selected = pickResources(resources, pickMode);
      if (!selected.length) {
        task.status = TASK_STATUS.FAILED;
        task.error = '未选中任何资源';
        this._emit(task);
        return;
      }

      task.status = TASK_STATUS.DOWNLOADING;
      task.phase = '下载中';
      task.percent = 0;
      this._emit(task);

      const format = config.transcode ? 'mp4' : 'ts';
      const singleM4sFormat = config.transcode ? config.format : 'm4s';

      const { results, errors } = await downloadResources(selected, {
        outDir: config.outDir,
        format,
        singleM4sFormat,
        concurrency: config.concurrency ?? 6,
        userAgent,
        log,
        onProgress: (info) => this._onProgress(task, info),
      });

      if (errors?.length && !results.length) {
        task.status = TASK_STATUS.FAILED;
        task.error = errors.map((e) => e.err.message).join('; ');
        this._emit(task);
        return;
      }

      task.status = TASK_STATUS.SUCCESS;
      task.phase = '完成';
      task.percent = 100;
      task.outputFiles = results;
      this._emit(task);
    } catch (err) {
      task.status = TASK_STATUS.FAILED;
      task.error = err.message;
      this._emit(task);
    }
  }

  _onProgress(task, info) {
    if (info.stage === 'merge' || info.stage === 'convert') {
      task.phase = info.stage === 'merge' ? '合并中' : '转码中';
    } else if (info.total) {
      task.phase = info.stage ?? '下载中';
      task.percent = Math.min(99, Math.round((info.received / info.total) * 100));
    } else if (info.type === 'progress' && info.total) {
      task.phase = '分片下载中';
      task.percent = Math.min(99, Math.round((info.done / info.total) * 100));
    }
    this._emit(task);
  }

  _debug(task, msg) {
    // 调试日志暂不持久化，仅用于未来扩展（如任务详情日志面板）
  }
}
