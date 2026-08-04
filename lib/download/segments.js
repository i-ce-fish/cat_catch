/**
 * HLS 分片下载主循环：并发下载 → AES 解密 → 伪装头裁剪 → 落 .parts 目录 → 按序流式合并。
 * 刻意偏离猫抓"全驻内存"策略：分片落盘、合并时单分片读入，保护 2015 MBP 的内存。
 */
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pool } from './pool.js';
import { fetchBuffer, withRetry } from './net.js';
import { aes128Decrypt, defaultIV, ivToBuffer } from './aes.js';
import { resolveUrl } from './m3u8.js';

const PNG_MAGIC = '89504e470d0a1a0a';
const IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

/**
 * @param {object} input
 * @param {object} input.manifest 已解析（且已过 master 选择）的清单
 * @param {string} input.baseUrl 清单 URL（相对分片 resolve 用）
 * @param {Record<string,string>} [input.headers]
 * @param {string} [input.userAgent]
 * @param {string} input.outPath 输出 ts 文件路径
 * @param {number} [input.concurrency]
 * @param {(info: object) => void} [input.onProgress]
 * @returns {Promise<string>} outPath
 */
export async function downloadSegments(input) {
  const { manifest, baseUrl, headers = {}, userAgent, outPath, concurrency = 6, onProgress } = input;
  const segs = manifest.segments ?? [];
  const mediaSeq = manifest.mediaSequence ?? 0;

  // key 缓存：同一 key URI 只拉一次（猫抓 keyContent Map 同款）
  const keyCache = new Map();
  async function getKey(keyInfo) {
    const uri = resolveUrl(baseUrl, keyInfo.uri);
    if (!keyCache.has(uri)) {
      const buf = await fetchBuffer(uri, headers, { userAgent });
      if (buf.length !== 16) throw new Error(`AES key 长度应为 16 字节，实际 ${buf.length}（${uri}）`);
      keyCache.set(uri, buf);
    }
    return keyCache.get(uri);
  }

  // EXT-X-MAP initSegment 预取（fmp4 场景）
  let initBuf = null;
  const mapInfo = segs.find((s) => s.map?.uri)?.map;
  if (mapInfo) {
    initBuf = await fetchBuffer(resolveUrl(baseUrl, mapInfo.uri), headers, { userAgent });
  }

  const partsDir = outPath + '.parts';
  await mkdir(partsDir, { recursive: true });

  let done = 0;
  await pool(segs, concurrency, async (seg, i) => {
    const segUrl = resolveUrl(baseUrl, seg.uri);
    const extra = seg.byterange
      ? { range: `bytes=${seg.byterange.offset}-${seg.byterange.offset + seg.byterange.length - 1}` }
      : {};
    let buf = await withRetry(() => fetchBuffer(segUrl, headers, { userAgent, extra, timeout: 60000 }), {
      retries: 3,
      onRetry: (err, n) => onProgress?.({ type: 'retry', index: i, attempt: n, error: err.message }),
    });
    if (seg.key?.method === 'AES-128') {
      const key = await getKey(seg.key);
      const iv = seg.key.iv ? ivToBuffer(seg.key.iv) : defaultIV(mediaSeq + i);
      buf = aes128Decrypt(buf, key, iv);
    }
    buf = stripFakeImageHeader(buf);
    await writeFile(partPath(partsDir, i), buf);
    done++;
    onProgress?.({ type: 'progress', done, total: segs.length });
  });

  // 按序流式合并（单分片读入内存，逐片 append）
  const out = createWriteStream(outPath);
  try {
    if (initBuf) await writeToStream(out, initBuf);
    for (let i = 0; i < segs.length; i++) {
      const part = await readFile(partPath(partsDir, i));
      await writeToStream(out, part);
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
  }
  await rm(partsDir, { recursive: true, force: true });
  return outPath;
}

function partPath(dir, i) {
  return path.join(dir, `${String(i).padStart(6, '0')}.part`);
}

function writeToStream(stream, buf) {
  return new Promise((resolve, reject) => {
    stream.write(buf, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * 伪装图片头裁剪：某些站点把 ts 分片伪装成 PNG/JPG。
 * 正常分片以 0x47（TS 同步字节）或 ftyp（fmp4）开头，否则找图片结束标记后的第一个同步字节。
 * 对照猫抓 m3u8.js:1518-1553 的 preprocess 思路。
 */
export function stripFakeImageHeader(buf) {
  if (buf.length < 8) return buf;
  if (buf[0] === 0x47) return buf; // 正常 TS
  if (buf.toString('ascii', 4, 8) === 'ftyp') return buf; // 正常 fmp4
  if (buf.toString('hex', 0, 8) === PNG_MAGIC) {
    const iend = buf.indexOf(IEND);
    if (iend >= 0) {
      const rest = buf.subarray(iend + 8);
      const sync = rest.indexOf(0x47);
      if (sync >= 0) return rest.subarray(sync);
      return rest;
    }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const eoi = buf.indexOf(JPEG_EOI);
    if (eoi >= 0) {
      const rest = buf.subarray(eoi + 2);
      const sync = rest.indexOf(0x47);
      if (sync >= 0) return rest.subarray(sync);
      return rest;
    }
  }
  return buf;
}
