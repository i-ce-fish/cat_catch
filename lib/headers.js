/**
 * 请求头白名单筛选与 cookie 兜底。
 * 对照猫抓 background.js:932-964（getRequestHeaders）——只重放这些头，其余丢弃。
 */

const DIRECT_INCLUDE = new Set([
  'referer',
  'origin',
  'cookie',
  'authorization',
  'auth',
  'token',
  'key',
  'access-token',
  'api-key',
  'app-token',
  'authtoken',
  'session-id',
]);
const X_AUTH_REG = /(auth|token|sign|key|ticket|session)/;

/**
 * 从 Playwright request.allHeaders() 结果筛选白名单头（key 统一小写）。
 * @param {Record<string,string>} allHeaders
 * @returns {Record<string,string>}
 */
export function filterHeaders(allHeaders) {
  const out = {};
  for (const [name, value] of Object.entries(allHeaders ?? {})) {
    const lower = name.toLowerCase();
    if (DIRECT_INCLUDE.has(lower)) out[lower] = value;
    else if (lower.startsWith('x-') && X_AUTH_REG.test(lower)) out[lower] = value;
  }
  return out;
}

/** Playwright context.cookies() 返回数组 → Cookie 头字符串 */
export function cookieHeader(cookies) {
  return (cookies ?? []).map((c) => `${c.name}=${c.value}`).join('; ');
}

/** headers 缺 cookie 时用页面 cookie 兜底补齐（SW/缓存命中的请求 allHeaders 可能缺 cookie） */
export function ensureCookie(headers, contextCookies) {
  if (headers.cookie) return headers;
  const c = cookieHeader(contextCookies);
  return c ? { ...headers, cookie: c } : headers;
}

/** 下载 m4s/直链时确保有 referer：缺失时用页面 URL 回填（猫抓 background.js:265-267 同款） */
export function ensureReferer(headers, pageUrl) {
  if (headers.referer || !pageUrl) return headers;
  return { ...headers, referer: pageUrl };
}
