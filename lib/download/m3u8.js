/**
 * M3U8 清单加载与解析（m3u8-parser，videojs 出品）。
 * 对照猫抓 m3u8.js 用 hls.js 做解析器的角色：master 选最高带宽子清单、直播/DRM 检测。
 */
import { Parser } from 'm3u8-parser';
import { fetchText } from './net.js';

export class HlsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HlsError';
  }
}

/** 拉取并解析清单；master 清单自动选最高带宽子清单并二次拉取 */
export async function loadHlsManifest(url, headers, opts = {}) {
  const text = await fetchText(url, headers, opts);
  return resolveMaster(text, url, headers, opts);
}

/** 已有清单文本（深度 hook 上报场景）时直接解析 */
export async function resolveMaster(text, baseUrl, headers, opts = {}) {
  let manifest = parseHls(text);
  if (manifest.playlists?.length) {
    const best = pickBestPlaylist(manifest);
    const subUrl = resolveUrl(baseUrl, best.uri);
    const subText = await fetchText(subUrl, headers, opts);
    manifest = parseHls(subText);
    manifest.__resolvedUrl = subUrl;
  } else {
    manifest.__resolvedUrl = baseUrl;
  }
  checkSupported(manifest);
  return manifest;
}

export function parseHls(text) {
  if (!text || !text.trimStart().startsWith('#EXTM3U')) {
    throw new HlsError('不是有效的 m3u8 清单（缺少 #EXTM3U 头）');
  }
  const parser = new Parser();
  parser.push(text);
  parser.end();
  return parser.manifest;
}

/** master 清单选 BANDWIDTH 最大的子清单（猫抓 m3u8.js:343-458 默认策略） */
export function pickBestPlaylist(manifest) {
  const playlists = manifest.playlists ?? [];
  if (!playlists.length) return null;
  let best = playlists[0];
  for (const p of playlists) {
    if ((p.attributes?.BANDWIDTH ?? 0) > (best.attributes?.BANDWIDTH ?? 0)) best = p;
  }
  return best;
}

/** 直播与 DRM 检测（猫抓：SAMPLE-AES-CTR 直接拒，m3u8.js:781） */
export function checkSupported(manifest) {
  const segs = manifest.segments ?? [];
  for (const s of segs) {
    const method = s.key?.method;
    if (method && method !== 'AES-128' && method !== 'NONE') {
      throw new HlsError(`不支持的加密方式（疑似 DRM，无法处理）: ${method}`);
    }
  }
  if (!manifest.endList) {
    throw new HlsError('直播流（清单无 #EXT-X-ENDLIST），暂不支持');
  }
  if (segs.length === 0) {
    throw new HlsError('清单为空（无分片）');
  }
}

export function resolveUrl(base, uri) {
  try {
    return new URL(uri, base).href;
  } catch {
    return uri;
  }
}
