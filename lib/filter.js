/**
 * 媒体资源命中判定：扩展名表 + MIME 表 + resourceType=media 无条件放行。
 * 照抄猫抓 init.js:29-73 三张表与 background.js:166-193 的判定顺序。
 * 差异：ts 不直接收（m3u8 分片会刷屏，猫抓默认也关闭 ts）。
 */

const MEDIA_EXT = new Set(
  'flv hlv f4v mp4 mp3 wma wav m4a webm ogg ogv acc mov mkv m4s m3u8 m3u mpeg avi wmv asf movie divx mpeg4 vid aac mpd weba opus'.split(' ')
);

// 命中即彻底放弃（猫抓 CheckExtension 的 "break" 语义）：ts 分片刷屏、字幕非目标
const DISABLED_EXT = new Set(['ts', 'srt', 'vtt']);

const MIME_EXACT = new Set([
  'application/ogg',
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'application/mpegurl',
  'application/octet-stream-m3u8',
  'application/dash+xml',
  'application/m4s',
]);

const FILENAME_RE = /filename="?([^";]+)"?/;

export function extOfPath(pathname) {
  const seg = pathname.split('/').pop() ?? '';
  const dot = seg.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = seg.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

/**
 * 判定一个 response 是否为可下载媒体。
 * @param {object} input
 * @param {string} input.url
 * @param {string} input.method
 * @param {string|undefined} input.contentType
 * @param {string|undefined} input.contentDisposition
 * @param {string} input.resourceType Playwright request.resourceType()
 * @returns {{ext: string, via: 'ext'|'mime'|'disposition'|'media'} | null}
 */
export function sniffResponse({ url, method, contentType, contentDisposition, resourceType }) {
  if (method === 'OPTIONS') return null;
  if (url.startsWith('blob:') || url.startsWith('data:')) return null;
  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const ext = extOfPath(pathname);
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();

  // 0. 禁用扩展名命中即彻底放弃（不再查 MIME/media，对齐猫抓 break 语义）
  if (ext && DISABLED_EXT.has(ext)) return null;
  // 1. 扩展名表
  if (ext && MEDIA_EXT.has(ext)) return { ext, via: 'ext' };
  // 2. MIME 表
  if (type && (type.startsWith('audio/') || type.startsWith('video/') || MIME_EXACT.has(type))) {
    return { ext: ext || inferExt(type), via: 'mime' };
  }
  // 3. content-disposition 附件文件名
  if (contentDisposition) {
    const m = FILENAME_RE.exec(contentDisposition);
    if (m) {
      const dExt = extOfPath(m[1]);
      if (dExt && MEDIA_EXT.has(dExt)) return { ext: dExt, via: 'disposition' };
    }
  }
  // 4. video/audio 元素发出的请求无条件放行
  if (resourceType === 'media') return { ext: ext || 'mp4', via: 'media' };
  return null;
}

function inferExt(mime) {
  const sub = (mime.split('/')[1] ?? '').toLowerCase();
  if (sub.includes('mpegurl')) return 'm3u8';
  if (sub.includes('dash')) return 'mpd';
  if (sub === 'mp4') return 'mp4';
  if (sub === 'mpeg') return 'mp3';
  if (sub === 'x-m4s' || sub === 'm4s') return 'm4s';
  return sub.split('+')[0] || 'bin';
}
