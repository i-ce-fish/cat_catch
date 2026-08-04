/**
 * 资源选择策略：
 *  - best（默认）：B站音画对 > m3u8 > 体积最大者
 *  - all：全部
 *  - "1,3"：按表格序号
 *  - TTY 交互：打印表格 readline 输入
 */
import readline from 'node:readline';
import { formatBytes } from './progress.js';

/** B 站音画对检测（与 download/index.js 的配对条件一致） */
export function findAVPair(resources) {
  const v = resources.filter((r) => r.ext === 'm4s' && r.mime?.startsWith('video/') && (r.source === 'network' || r.source === 'playurl'));
  const a = resources.filter((r) => r.ext === 'm4s' && r.mime?.startsWith('audio/') && (r.source === 'network' || r.source === 'playurl'));
  if (!v.length || !a.length) return null;
  v.sort((x, y) => (y.size ?? 0) - (x.size ?? 0));
  a.sort((x, y) => (y.size ?? 0) - (x.size ?? 0));
  return { video: v[0], audio: a[0] };
}

/**
 * B 站 playurl 结构化数据 → 音画资源对（各取 bandwidth 最高档 = 账号权限内最高清晰度）。
 * size 用 bandwidth(bps)/8 × duration(s) 估算。
 */
export function dashPair(dashInfo, pageTitle) {
  if (!dashInfo?.videos?.length || !dashInfo?.audios?.length) return null;
  const v = [...dashInfo.videos].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
  const a = [...dashInfo.audios].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
  const dur = dashInfo.duration ?? 0;
  const est = (bw) => (dur && bw ? Math.round((bw / 8) * dur) : undefined);
  return {
    video: { url: v.url, ext: 'm4s', mime: 'video/mp4', size: est(v.bandwidth), source: 'playurl', pageTitle, meta: v },
    audio: { url: a.url, ext: 'm4s', mime: 'audio/mp4', size: est(a.bandwidth), source: 'playurl', pageTitle, meta: a },
  };
}

export function pickResources(resources, mode) {
  const list = [...resources];
  if (mode === 'all') return list;
  // 只要音频轨（提取音频场景）：优先 playurl 配对的音频轨，其次最大的 audio/* 资源
  if (mode === 'audio') {
    const pair = findAVPair(list);
    if (pair) return [pair.audio];
    const audios = list.filter((r) => r.mime?.startsWith('audio/')).sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
    return audios.slice(0, 1);
  }
  if (/^\d+(,\d+)*$/.test(mode)) {
    const idx = mode.split(',').map((s) => parseInt(s, 10) - 1);
    return idx.map((i) => list[i]).filter(Boolean);
  }
  // best
  const pair = findAVPair(list);
  if (pair) return [pair.video, pair.audio];
  const m3u8s = list.filter((r) => r.ext === 'm3u8' || r.ext === 'm3u');
  if (m3u8s.length) return [m3u8s[0]];
  const sized = list.filter((r) => r.size).sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  if (sized.length) return [sized[0]];
  return list.slice(0, 1);
}

export function printTable(resources) {
  const pair = findAVPair(resources);
  const w = (s, n) => String(s).padEnd(n);
  const lines = resources.map((r, i) => {
    const size = r.size ? formatBytes(r.size) : '-';
    const url = r.url ? (r.url.length > 58 ? r.url.slice(0, 55) + '...' : r.url) : '(内嵌文本)';
    let tag = '';
    if (pair && r === pair.video) tag = '  ★视频轨';
    if (pair && r === pair.audio) tag = '  ★音频轨';
    return `  ${w(i + 1, 3)} ${w(r.ext ?? '?', 5)} ${w(r.source ?? '-', 7)} ${w(size, 9)} ${url}${tag}`;
  });
  const hint = pair ? '检测到 B 站音画双轨（★标记），直接回车 = 自动配对合并为 mp4（推荐）\n' : '';
  process.stderr.write(`\n${hint}序号  类型   来源     大小       URL\n${lines.join('\n')}\n\n`);
}

/** TTY 交互选择；非 TTY 返回 null（调用方落 best） */
export async function interactivePick(resources) {
  if (!process.stdin.isTTY) return null;
  printTable(resources);
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((resolve) => {
    rl.question('输入序号下载（逗号分隔；回车=推荐；a=全部）: ', resolve);
  });
  rl.close();
  const trimmed = answer.trim();
  let selected;
  if (!trimmed) selected = pickResources(resources, 'best');
  else if (trimmed.toLowerCase() === 'a') selected = resources;
  else selected = pickResources(resources, trimmed);
  return completeAVPair(selected, resources);
}

/**
 * 选了视频轨 m4s 却没选音频轨时，自动补上配对音频轨。
 * 否则单视频轨落盘是无声 m4s，配对合并逻辑不会触发——这是已复现的用户困惑点。
 */
export function completeAVPair(selected, all) {
  const okSource = (r) => r?.source === 'network' || r?.source === 'playurl';
  const isV = (r) => r?.ext === 'm4s' && r.mime?.startsWith('video/') && okSource(r);
  const isA = (r) => r?.ext === 'm4s' && r.mime?.startsWith('audio/') && okSource(r);
  if (!selected.some(isV) || selected.some(isA)) return selected;
  const pair = findAVPair(all);
  if (pair && !selected.includes(pair.audio)) {
    process.stderr.write('[cat_catch] 已自动补上配对音频轨（合并 mp4 需要音画双轨）\n');
    return [...selected, pair.audio];
  }
  return selected;
}
