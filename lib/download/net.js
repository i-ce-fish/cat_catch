/**
 * Node fetch 封装：统一超时、UA、白名单请求头重放。
 * 对照猫抓 function.js:125-156 的 DNR 注入思路——下载请求必须带与页面一致的指纹头。
 */

/**
 * @param {string} url
 * @param {Record<string,string>} headers 白名单筛选后的请求头（referer/cookie/...）
 * @param {object} [opts]
 * @param {number} [opts.timeout] 毫秒
 * @param {string} [opts.userAgent]
 * @param {Record<string,string>} [opts.extra] 附加头（Range/sec-fetch 重试阶梯用）
 * @returns {Promise<Response>}
 */
export async function fetchRaw(url, headers = {}, opts = {}) {
  const { timeout = 30000, userAgent, extra = {} } = opts;
  const finalHeaders = { ...headers, ...extra };
  if (userAgent && !hasHeader(finalHeaders, 'user-agent')) {
    finalHeaders['user-agent'] = userAgent;
  }
  const fetchOpts = { headers: finalHeaders, redirect: 'follow' };
  // timeout <= 0 表示不加超时（大文件下载场景，依赖 undici 内建的 headers/body 超时）
  if (timeout > 0) fetchOpts.signal = AbortSignal.timeout(timeout);
  return fetch(url, fetchOpts);
}

export async function fetchText(url, headers, opts) {
  const resp = await fetchRaw(url, headers, opts);
  if (!resp.ok) throw new HttpError(resp.status, url);
  return resp.text();
}

export async function fetchBuffer(url, headers, opts) {
  const resp = await fetchRaw(url, headers, opts);
  if (!resp.ok) throw new HttpError(resp.status, url);
  return Buffer.from(await resp.arrayBuffer());
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

function hasHeader(headers, name) {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

/** 分片级重试：失败最多 retries 次，延迟 500ms×n（对照猫抓 m3u8.downloader.js:324-332） */
export async function withRetry(fn, { retries = 3, baseDelay = 500, onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        onRetry?.(err, attempt + 1);
        await new Promise((r) => setTimeout(r, baseDelay * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}
