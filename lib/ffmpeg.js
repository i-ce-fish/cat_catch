/**
 * ffmpeg-static 封装：音画合并与 ts 转封装 mp4（一律 -c copy 流拷贝，不重编码，老机器秒级）。
 */
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export function ffmpegAvailable() {
  return typeof ffmpegPath === 'string' && ffmpegPath.length > 0;
}

function runFfmpeg(args, verbose = false) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', verbose ? 'info' : 'error', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let errBuf = '';
    proc.stderr.on('data', (d) => {
      errBuf += d;
      if (verbose) process.stderr.write(d);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 退出码 ${code}: ${errBuf.trim().slice(-400)}`));
    });
  });
}

/** B 站场景：视频轨 m4s + 音频轨 m4s → mp4 */
export async function mergeAV(videoPath, audioPath, outPath, { verbose = false } = {}) {
  await runFfmpeg(
    ['-y', '-i', videoPath, '-i', audioPath, '-c', 'copy', '-movflags', '+faststart', outPath],
    verbose
  );
  return outPath;
}

/** ts（或任意容器）→ mp4 转封装 */
export async function remuxToMp4(inPath, outPath, { verbose = false } = {}) {
  await runFfmpeg(['-y', '-i', inPath, '-c', 'copy', '-movflags', '+faststart', outPath], verbose);
  return outPath;
}

const MP4_FAMILY = new Set(['mp4', 'm4a', 'mov']);
const COPY_ONLY = new Set(['mkv', 'flv', 'webm', 'ts']);

/**
 * 单个 m4s 转目标格式（配置项 singleM4sFormat 的执行者）：
 * - mp3：libmp3lame VBR q2（约 190kbps），-vn 只留音频（视频轨转 mp3 = 提取音频）
 * - wav：pcm_s16le 无损，-vn 只留音频
 * - mp4/m4a/mov/mkv/flv 等：-c copy 流拷贝不重编码
 * - 其他扩展名：交给 ffmpeg 按扩展名自行推断
 */
export async function convertToFormat(inPath, outPath, format, { verbose = false } = {}) {
  const fmt = String(format).toLowerCase();
  if (fmt === 'mp3') {
    await runFfmpeg(['-y', '-i', inPath, '-vn', '-codec:a', 'libmp3lame', '-q:a', '2', outPath], verbose);
  } else if (fmt === 'wav') {
    await runFfmpeg(['-y', '-i', inPath, '-vn', '-codec:a', 'pcm_s16le', outPath], verbose);
  } else if (MP4_FAMILY.has(fmt)) {
    await runFfmpeg(['-y', '-i', inPath, '-c', 'copy', '-movflags', '+faststart', outPath], verbose);
  } else if (COPY_ONLY.has(fmt)) {
    await runFfmpeg(['-y', '-i', inPath, '-c', 'copy', outPath], verbose);
  } else {
    await runFfmpeg(['-y', '-i', inPath, outPath], verbose);
  }
  return outPath;
}
