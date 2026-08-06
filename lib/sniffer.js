/**
 * 嗅探主编排：Playwright persistent context 打开页面，三路嗅探（response 监听 +
 * 深度 hook + DOM 扫描），settle 后返回资源清单。
 * 对照猫抓 background.js 的 webRequest 监听 + content-script 注入体系。
 */
import { chromium } from 'playwright';
import readline from 'node:readline';
import { Registry } from './registry.js';
import { sniffResponse } from './filter.js';
import { filterHeaders } from './headers.js';
import { triggerAutoplay } from './autoplay.js';
import { scanDomMedia } from './domscan.js';
import { deepHookSource } from './hook-source.js';

/** 与真实 Chrome 一致的 UA（页面与下载请求共用同一指纹） */
export const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const LIVE_PAGE_RE = /live\.bilibili\.com|live\.douyu\.com|huya\.com\/\d+|\/live\//;
const LIVE_RES_RE = /live-bvc|\.flv\?.*wsTime|pull-.*\.(flv|m3u8)/;

export class UnsupportedError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'UnsupportedError';
  }
}

/**
 * @param {string} url 目标页面 URL（也可是 m3u8/mp4 直链，走 dryRun 短路）
 * @param {object} [opts]
 * @param {string} [opts.profileDir]
 * @param {boolean} [opts.headed]
 * @param {number} [opts.timeout] 硬超时 ms
 * @param {number} [opts.quietMs] 静默判定窗口 ms
 * @param {number} [opts.maxResources]
 * @param {boolean} [opts.autoplay]
 * @param {boolean} [opts.deepHook]
 * @param {boolean} [opts.blockAssets]
 * @param {object[]} [opts.cookies] 预置登录态 cookie（Playwright 格式），goto 前注入
 * @param {(msg: string) => void} [opts.log] 调试日志（-v 才显示）
 * @param {(msg: string) => void} [opts.infoLog] 用户必须看到的提示（headed 等待等），总是显示
 * @returns {Promise<{resources: object[], keys: object[], pageTitle: string, cookies: object[], userAgent: string}>}
 */
export async function sniff(url, opts = {}) {
  const {
    profileDir = '.catch-profile',
    headed = false,
    timeout = 45000,
    quietMs = 4000,
    maxResources = 50,
    autoplay = true,
    deepHook = true,
    blockAssets = true,
    cookies: presetCookies,
    log = () => {},
    infoLog = () => {},
  } = opts;

  if (LIVE_PAGE_RE.test(url)) {
    throw new UnsupportedError(`疑似直播页面，暂不支持（猫抓默认也屏蔽直播流）: ${url}`);
  }

  const registry = new Registry();
  const userAgent = DEFAULT_UA;

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !headed,
    userAgent,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled', '--autoplay-policy=no-user-gesture-required'],
  });

  try {
    // 反检测：去 webdriver 标记
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // 深度 hook：先注册 binding 再注入（顺序不能反）
    if (deepHook) {
      await context.exposeBinding('__catchReport', (_source, payload) => {
        handleHookPayload(registry, payload, log);
      });
      await context.addInitScript(deepHookSource);
    }

    // 预置登录态 cookie（如 Electron 扫码登录得到的 B 站 cookie）：必须在 goto 前注入才能让首次请求带上登录态
    if (presetCookies?.length) {
      await context.addCookies(presetCookies).catch((e) => log(`预置 cookie 注入失败（忽略，继续匿名嗅探）: ${e.message}`));
    }

    const page = await context.newPage();

    if (blockAssets) {
      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (type === 'image' || type === 'font' || type === 'stylesheet') return route.abort();
        return route.continue();
      });
    }

    page.on('response', (response) => {
      handleResponse(response, registry).catch(() => {});
    });

    log(`打开页面: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => {
      log(`页面加载异常（继续嗅探）: ${e.message}`);
    });

    // headed 且终端可交互：等用户在窗口里完成登录等手动操作。
    // 回车后刷新页面——让 playurl 等接口用登录态 cookie 重新请求（否则拿到的还是登录前的低清地址）。
    // 注意：这些提示是用户操作的必要指引，必须走 infoLog（总是显示），不能进 debug 通道。
    if (headed && process.stdin.isTTY) {
      infoLog('--------------------------------------------------------');
      infoLog('浏览器窗口已打开。如需登录，请现在窗口中完成（B站：右上角「登录」→ 扫码，并在手机上点确认）。');
      infoLog('完成后回到本终端，按【回车】继续（页面将自动刷新应用登录态）...');
      infoLog('--------------------------------------------------------');
      await waitForEnter();
      infoLog('继续执行，刷新页面应用登录态...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }

    if (autoplay) {
      await page.waitForTimeout(1000);
      await triggerAutoplay(page, { log });
    }

    // settle 循环：静默 quietMs / 硬超时 / 数量上限，任一满足即收工
    let lastFoundAt = Date.now();
    registry.on('found', () => {
      lastFoundAt = Date.now();
    });
    const start = Date.now();
    for (;;) {
      await page.waitForTimeout(500);
      const now = Date.now();
      if (registry.size >= 1 && now - lastFoundAt > quietMs) break;
      if (now - start > timeout) break;
      if (registry.size >= maxResources) break;
    }
    log(`嗅探结束：发现 ${registry.size} 个资源（耗时 ${Math.round((Date.now() - start) / 1000)}s）`);

    // DOM 扫描补一刀（有些站点资源不走网络层或直接写在 DOM 里）
    const domUrls = await scanDomMedia(page);
    for (const u of domUrls) {
      const hit = sniffResponse({ url: u, method: 'GET', resourceType: 'dom' });
      registry.add({ url: u, ext: hit?.ext ?? 'mp4', source: 'dom' });
    }

    const pageTitle = await page.title().catch(() => '');
    const cookies = await context.cookies().catch(() => []);

    // 统一回填页面信息
    for (const res of registry.list()) {
      res.pageTitle ||= pageTitle;
      res.pageUrl ||= url;
      res.userAgent ||= userAgent;
    }

    return { resources: registry.list(), keys: registry.keys, dashInfo: registry.dashInfo ?? null, pageTitle, cookies, userAgent };
  } finally {
    await context.close().catch(() => {});
  }
}

/** response 事件处理：等价猫抓 onResponseStarted + findMedia */
async function handleResponse(response, registry) {
  const request = response.request();
  const url = response.url();
  if (LIVE_RES_RE.test(url)) return; // 直播流刷屏，跳过

  const respHeaders = await response.headers();
  const hit = sniffResponse({
    url,
    method: request.method(),
    contentType: respHeaders['content-type'],
    contentDisposition: respHeaders['content-disposition'],
    resourceType: request.resourceType(),
  });
  if (!hit) return;

  // 请求头白名单（allHeaders 走 CDP 含 cookie；失败回退 headers()）
  let reqHeaders = {};
  try {
    reqHeaders = filterHeaders(await request.allHeaders());
  } catch {
    try {
      reqHeaders = filterHeaders(request.headers());
    } catch {}
  }

  // 大小：content-length 优先，Range 响应从 content-range 取总长（猫抓 background.js:906-925 同款）
  let size = parseInt(respHeaders['content-length'] ?? '', 10) || undefined;
  const contentRange = respHeaders['content-range'];
  if (contentRange) {
    const total = parseInt(contentRange.split('/')[1] ?? '', 10);
    if (Number.isFinite(total)) size = total;
  }

  registry.add({
    url,
    ext: hit.ext,
    mime: (respHeaders['content-type'] ?? '').split(';')[0].trim() || undefined,
    size,
    source: 'network',
    headers: reqHeaders,
  });
}

/** 等待用户在终端按回车（headed 登录流程用） */
function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

/** 深度 hook 上报处理 */
function handleHookPayload(registry, payload, log) {
  if (!payload) return;
  if (payload.bilibiliDash) {
    const d = payload.bilibiliDash;
    log(`深度 hook：捕获 B 站 playurl（${d.videos.length} 档视频 + ${d.audios.length} 档音频，时长 ${d.duration}s）`);
    registry.dashInfo = d;
    return;
  }
  if (payload.keyB64) {
    log(`深度 hook：捕获候选 AES key（来自 ${payload.keyUrl ?? '页面'}）`);
    registry.addKey(payload);
    return;
  }
  if (payload.m3u8Text) {
    log('深度 hook：捕获 m3u8 清单文本');
    registry.add({ url: null, ext: 'm3u8', source: 'hook', m3u8Text: payload.m3u8Text, pageUrl: payload.pageUrl });
    return;
  }
  if (payload.url) {
    registry.add({ url: payload.url, ext: payload.ext, source: 'hook' });
  }
}
