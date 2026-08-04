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
