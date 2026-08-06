/**
 * 下载编排：按资源类型分发（直链/HLS），B 站音画配对合并。
 */
import { mkdir, rm } from 'node:fs/promises';
import { downloadDirect } from './direct.js';
import { loadHlsManifest, resolveMaster } from './m3u8.js';
import { downloadSegments } from './segments.js';
import { pool } from './pool.js';
import { mergeAV, remuxToMp4, convertToFormat, ffmpegAvailable } from '../ffmpeg.js';
import { cleanTitle, renderNameTemplate, uniquePath } from '../filename.js';
import { createProgress } from '../progress.js';

/**
 * @param {object[]} resources 选中待下载的资源（headers 已补齐）
 * @param {object} opts
 * @param {string} opts.outDir
 * @param {string} [opts.format] 'mp4' | 'ts'
 * @param {number} [opts.concurrency] 分片并发
 * @param {string} [opts.nameTpl]
 * @param {boolean} [opts.keepParts]
 * @param {string} [opts.userAgent]
 * @param {boolean} [opts.verbose]
 * @param {(msg: string) => void} [opts.log]
 * @param {(info: object) => void} [opts.onProgress] 进度回调（UI 用），info 含 stage 字段区分阶段
 * @returns {Promise<string[]>} 产出文件路径列表
 */
export async function downloadResources(resources, opts) {
  const { outDir, concurrency = 6, keepParts = false, userAgent, verbose = false, log = () => {}, onProgress = () => {} } = opts;
  await mkdir(outDir, { recursive: true });
  const results = [];

  // 1. B 站音画配对：选中资源里 network 来源的 video/* m4s 与 audio/* m4s 各取体积最大者
  const { pair, rest } = extractAVPair(resources);

  if (pair) {
    const title = cleanTitle(pair.video.pageTitle);
    log(`音画配对：视频 ${formatSize(pair.video.size)} + 音频 ${formatSize(pair.audio.size)}`);
    const vPath = await uniquePath(outDir, `${title}.video.m4s`);
    const aPath = await uniquePath(outDir, `${title}.audio.m4s`);
    await downloadDirect(pair.video, vPath, { userAgent, onProgress: (p) => onProgress({ stage: 'pair-video', ...p }) });
    await downloadDirect(pair.audio, aPath, { userAgent, onProgress: (p) => onProgress({ stage: 'pair-audio', ...p }) });
    if (ffmpegAvailable()) {
      const outPath = await uniquePath(outDir, `${title}.mp4`);
      log(`ffmpeg 合并中 → ${outPath}`);
      onProgress({ stage: 'merge' });
      await mergeAV(vPath, aPath, outPath, { verbose });
      if (!keepParts) {
        await rm(vPath, { force: true });
        await rm(aPath, { force: true });
      }
      results.push(outPath);
    } else {
      log('未检测到 ffmpeg，音画分轨保存（视频轨无声）');
      results.push(vPath, aPath);
    }
  }

  // 2. 其余资源逐个下载（文件级并发 2，每个 HLS 内部另有分片并发）
  const errors = [];
  await pool(rest, 2, async (res) => {
    try {
      const out = await downloadOne(res, opts);
      if (out) results.push(out);
    } catch (err) {
      errors.push({ res, err });
      log(`下载失败 [${res.ext}] ${shortUrl(res.url)}: ${err.message}`);
    }
  });

  return { results, errors };
}

/** 单个资源下载（HLS 全流程：解析→分片→合并→转封装） */
async function downloadOne(res, opts) {
  const {
    outDir,
    format = 'mp4',
    concurrency = 6,
    nameTpl = '{title}.{ext}',
    keepParts = false,
    userAgent,
    verbose = false,
    log = () => {},
    onProgress = () => {},
  } = opts;
  const title = cleanTitle(res.pageTitle);

  if (res.ext === 'm3u8' || res.ext === 'm3u') {
    log(`解析 m3u8 清单: ${shortUrl(res.url ?? '(页面内嵌文本)')}`);
    const manifest = res.m3u8Text
      ? await resolveMaster(res.m3u8Text, res.pageUrl, res.headers, { userAgent })
      : await loadHlsManifest(res.url, res.headers, { userAgent });
    const segCount = manifest.segments?.length ?? 0;
    log(`共 ${segCount} 个分片，并发 ${concurrency} 下载`);

    const tsPath = await uniquePath(outDir, `${title}.ts`);
    const progress = createProgress(`${title.slice(0, 30)} 分片`, { unit: 'count' });
    await downloadSegments({
      manifest,
      baseUrl: manifest.__resolvedUrl,
      headers: res.headers,
      userAgent,
      outPath: tsPath,
      concurrency,
      onProgress: (info) => {
        if (info.type === 'progress') progress.update(info.done, info.total);
        if (info.type === 'retry') log(`分片 #${info.index} 第 ${info.attempt} 次重试: ${info.error}`);
        onProgress({ stage: 'hls-segments', ...info });
      },
    });
    progress.done();

    if (format === 'mp4' && ffmpegAvailable()) {
      const mp4Path = await uniquePath(outDir, `${title}.mp4`);
      log(`转封装 mp4 → ${mp4Path}`);
      await remuxToMp4(tsPath, mp4Path, { verbose });
      if (!keepParts) await rm(tsPath, { force: true });
      return mp4Path;
    }
    return tsPath;
  }

  if (res.ext === 'mpd') {
    throw new Error('MPD(DASH) 清单暂不支持，请改选页面上的 m3u8 资源');
  }

  // 单个 m4s（未参与音画配对）：按配置 singleM4sFormat 转换输出（默认 mp3；'m4s' 保留原样）
  const targetFmt = String(opts.singleM4sFormat ?? 'mp3').toLowerCase();
  if (res.ext === 'm4s' && targetFmt !== 'm4s') {
    const trackKind = res.mime?.startsWith('video/') ? '视频轨' : res.mime?.startsWith('audio/') ? '音频轨' : '轨道';
    log(`单个${trackKind} m4s，按配置转换为 ${targetFmt}${targetFmt === 'mp3' || targetFmt === 'wav' ? '（仅保留声音）' : ''}`);
    const tmpPath = await uniquePath(outDir, `${title}.m4s`);
    await downloadDirect(res, tmpPath, { userAgent, onProgress: (p) => onProgress({ stage: 'direct', ...p }) });
    const outPath = await uniquePath(outDir, `${title}.${targetFmt}`);
    onProgress({ stage: 'convert' });
    await convertToFormat(tmpPath, outPath, targetFmt, { verbose });
    if (!keepParts) await rm(tmpPath, { force: true });
    return outPath;
  }

  if (res.ext === 'm4s' && res.mime?.startsWith('video/')) {
    log('注意：单个视频轨（无配对音频），按原始 m4s 保存——播放无声。通常应让音画对一起选中以合并 mp4');
  }
  const fileName = renderNameTemplate(nameTpl, { title, ext: res.ext });
  const outPath = await uniquePath(outDir, fileName);
  await downloadDirect(res, outPath, { userAgent, onProgress: (p) => onProgress({ stage: 'direct', ...p }) });
  return outPath;
}

/** 提取一对音画 m4s（B 站特征）；多对时只取体积最大的一对 */
function extractAVPair(resources) {
  const okSource = (r) => r.source === 'network' || r.source === 'playurl';
  const videos = resources.filter((r) => r.ext === 'm4s' && r.mime?.startsWith('video/') && okSource(r));
  const audios = resources.filter((r) => r.ext === 'm4s' && r.mime?.startsWith('audio/') && okSource(r));
  if (!videos.length || !audios.length) return { pair: null, rest: resources };
  videos.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  audios.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  const pair = { video: videos[0], audio: audios[0] };
  const rest = resources.filter((r) => r !== videos[0] && r !== audios[0]);
  return { pair, rest };
}

function formatSize(n) {
  if (!n) return '未知大小';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)}${units[i]}`;
}

function shortUrl(url) {
  if (!url) return '(无URL)';
  return url.length > 80 ? url.slice(0, 77) + '...' : url;
}
