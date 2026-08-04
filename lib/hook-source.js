/**
 * 深度嗅探 hook 源码：经 context.addInitScript(deepHookSource) 注入，
 * 在页面任何 JS 之前、所有 iframe 的 MAIN world 执行——等价猫抓 catch-script/search.js。
 *
 * 注意：此函数会被 Playwright 序列化，必须完全自包含（不得引用模块作用域变量）。
 * 上报通道：window.__catchReport(payload)，由 exposeBinding 注册。
 * payload 形态：
 *   {url, ext, source:'hook'}            —— 发现的媒体 URL
 *   {ext:'m3u8', m3u8Text, pageUrl, source:'hook'} —— 无 URL 的清单文本（播放器手拼的）
 *   {keyB64, keyUrl, source:'hook'}      —— 16 字节候选 AES key
 */
export function deepHookSource() {
  const report = (payload) => {
    try {
      if (typeof window.__catchReport === 'function') window.__catchReport(payload);
    } catch {}
  };

  const seen = new Set();
  const reportUrl = (url, ext) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    report({ url, ext, source: 'hook' });
  };
  const reportKey = (buf, keyUrl) => {
    try {
      const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      if (u8.byteLength !== 16) return;
      // 全零 key 无意义
      if (u8.every((b) => b === 0)) return;
      let bin = '';
      for (let i = 0; i < 16; i++) bin += String.fromCharCode(u8[i]);
      const keyB64 = btoa(bin);
      if (seen.has(keyB64)) return;
      seen.add(keyB64);
      report({ keyB64, keyUrl: keyUrl || null, source: 'hook' });
    } catch {}
  };

  const MEDIA_URL_RE = /^https?:\/\/[^\s"'<>]+\.(m3u8|mpd|mp4|flv|m4s|mp3|m4a|aac|webm|mkv|mov|ts)(\?|#|$)/i;
  const toAbs = (u) => {
    try {
      return new URL(u, location.href).href;
    } catch {
      return null;
    }
  };
  const extOf = (u) => {
    const m = /\.(m3u8|mpd|mp4|flv|m4s|mp3|m4a|aac|webm|mkv|mov|ts)(\?|#|$)/i.exec(u);
    return m ? m[1].toLowerCase() : null;
  };

  const looksM3U8 = (t) => typeof t === 'string' && t.trimStart().startsWith('#EXTM3U');
  const looksMPD = (t) =>
    typeof t === 'string' && (t.includes('urn:mpeg:dash:schema:mpd') || (t.includes('<MPD') && t.includes('</MPD>')));

  /** 清单文本上报：相对路径在下载层 resolve，这里只需把文本或 URL 报上去 */
  const reportM3u8Text = (text, url) => {
    if (url) {
      reportUrl(toAbs(url) || url, 'm3u8');
      return;
    }
    const sig = text.slice(0, 200);
    if (seen.has(sig)) return;
    seen.add(sig);
    report({ ext: 'm3u8', m3u8Text: text, pageUrl: location.href, source: 'hook' });
  };

  const inspectText = (text, url) => {
    try {
      if (looksM3U8(text)) return reportM3u8Text(text, url);
      if (looksMPD(text) && url) return reportUrl(toAbs(url) || url, 'mpd');
      // JSON 响应自己解析扫描：response.json() 走原生路径、绕开 JSON.parse hook，
      // 必须在文本层补这一刀（B 站 playurl 就是这条路）
      if (typeof text === 'string' && text.length < 3 * 1024 * 1024 && text.trimStart().startsWith('{')) {
        try {
          scanJson(JSON.parse(text), 0);
        } catch {}
      }
    } catch {}
  };

  /** JSON 递归扫描（深度限制 20，对齐猫抓）：找媒体 URL 字符串和 m3u8 文本 */
  const scanJson = (v, depth) => {
    if (v == null || depth > 20) return;
    if (typeof v === 'string') {
      if (v.startsWith('#EXTM3U')) return reportM3u8Text(v);
      if (MEDIA_URL_RE.test(v)) {
        const ext = extOf(v);
        if (ext) reportUrl(v, ext);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) scanJson(v[i], depth + 1);
      return;
    }
    if (typeof v === 'object') {
      // B 站 playurl 响应特征：{ data: { dash: { video: [{baseUrl,...}], audio: [...] } } }
      // 结构化上报整条清晰度列表，不依赖播放器真正发起请求
      const dash = v?.data?.dash ?? v?.dash;
      if (dash && Array.isArray(dash.video) && dash.video[0]?.baseUrl) {
        try {
          report({
            bilibiliDash: {
              duration: dash.duration ?? 0,
              videos: dash.video.map((x) => ({
                url: x.baseUrl,
                id: x.id,
                bandwidth: x.bandwidth,
                codecs: x.codecs,
                width: x.width,
                height: x.height,
              })),
              audios: (Array.isArray(dash.audio) ? dash.audio : []).map((x) => ({
                url: x.baseUrl,
                id: x.id,
                bandwidth: x.bandwidth,
                codecs: x.codecs,
              })),
            },
            source: 'hook',
          });
        } catch {}
        return; // 已结构化上报，不再逐字段下钻（避免裸 URL 噪音）
      }
      for (const k of Object.keys(v)) scanJson(v[k], depth + 1);
    }
  };

  /** toString 伪装（猫抓 search.js 同款反检测） */
  const fakeNative = (fn, name) => {
    try {
      Object.defineProperty(fn, 'toString', {
        value: () => `function ${name}() { [native code] }`,
        writable: true,
        configurable: true,
      });
    } catch {}
    return fn;
  };

  const SMALL_TEXT_CT = /mpegurl|dash\+xml|json|text|javascript|xml/;

  // ---- hook fetch ----
  if (window.fetch) {
    const origFetch = window.fetch;
    window.fetch = fakeNative(function (input, init) {
      return origFetch.apply(this, arguments).then((resp) => {
        try {
          const url = typeof input === 'string' ? input : input && input.url;
          const ct = (resp.headers.get('content-type') || '').toLowerCase();
          const len = parseInt(resp.headers.get('content-length') || '0', 10);
          if (SMALL_TEXT_CT.test(ct) && (!len || len < 3 * 1024 * 1024)) {
            resp
              .clone()
              .text()
              .then((t) => inspectText(t, url))
              .catch(() => {});
          } else if (len === 16) {
            resp
              .clone()
              .arrayBuffer()
              .then((b) => reportKey(b, url))
              .catch(() => {});
          }
        } catch {}
        return resp;
      });
    }, 'fetch');
  }

  // ---- hook XMLHttpRequest ----
  if (window.XMLHttpRequest) {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = fakeNative(function (method, url) {
      try {
        this.__catchUrl = typeof url === 'string' ? url : String(url);
        this.addEventListener('load', function () {
          try {
            const rt = this.responseType;
            if ((rt === '' || rt === 'text') && typeof this.responseText === 'string' && this.responseText.length < 3 * 1024 * 1024) {
              inspectText(this.responseText, this.__catchUrl);
            } else if (rt === 'arraybuffer' && this.response && this.response.byteLength === 16) {
              reportKey(this.response, this.__catchUrl);
            }
          } catch {}
        });
      } catch {}
      return origOpen.apply(this, arguments);
    }, 'open');
  }

  // ---- hook JSON.parse ----
  const origParse = JSON.parse;
  JSON.parse = fakeNative(function (text) {
    const result = origParse.apply(this, arguments);
    try {
      scanJson(result, 0);
    } catch {}
    return result;
  }, 'parse');

  // ---- hook TextDecoder.decode（播放器手拼清单） ----
  if (window.TextDecoder) {
    const origDecode = TextDecoder.prototype.decode;
    TextDecoder.prototype.decode = fakeNative(function (input) {
      const result = origDecode.apply(this, arguments);
      try {
        if (looksM3U8(result)) reportM3u8Text(result);
        else if (looksMPD(result)) report({ ext: 'mpd', mpdText: result, pageUrl: location.href, source: 'hook' });
      } catch {}
      return result;
    }, 'decode');
  }

  // ---- hook atob（base64 藏清单） ----
  if (window.atob) {
    const origAtob = window.atob;
    window.atob = fakeNative(function (s) {
      const result = origAtob.apply(this, arguments);
      try {
        if (looksM3U8(result)) reportM3u8Text(result);
      } catch {}
      return result;
    }, 'atob');
  }

  // ---- DOMContentLoaded 扫内联脚本里的媒体 URL（猫抓 search.js:841-867 同款） ----
  const INLINE_RE = /["']((https?:)?\/\/[^"'\s]*?\.(m3u8|mp4|flv|m4s)(\?[^"'\s]*)?)["']/g;
  document.addEventListener('DOMContentLoaded', () => {
    try {
      // B 站内嵌播放信息
      if (window.__playinfo__) scanJson(window.__playinfo__, 0);
    } catch {}
    try {
      document.querySelectorAll('script').forEach((script) => {
        const text = script.textContent;
        if (!text || text.length > 1024 * 1024) return;
        let m;
        INLINE_RE.lastIndex = 0;
        while ((m = INLINE_RE.exec(text)) !== null) {
          const abs = toAbs(m[1]);
          if (abs) reportUrl(abs, m[3].toLowerCase());
        }
      });
    } catch {}
  });
}
