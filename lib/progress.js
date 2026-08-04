/**
 * stderr 单行进度条，无依赖。非 TTY 降级为每 10% 打一行。
 * unit: 'bytes'（默认，带 KB/MB 格式化）| 'count'（分片计数，显示 done/total 个）
 */
export function createProgress(label = '', { unit = 'bytes' } = {}) {
  const isTTY = process.stderr.isTTY;
  const fmt = unit === 'bytes' ? formatBytes : (n) => String(Math.round(n));
  const suffix = unit === 'count' ? ' 个' : '';
  let lastPercent = -1;
  let lastLen = 0;
  const start = Date.now();

  function update(received, total) {
    const percent = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : -1;
    if (!isTTY) {
      if (percent >= 0 && percent >= lastPercent + 10) {
        lastPercent = percent;
        console.error(`[${label}] ${percent}% (${fmt(received)}${total ? '/' + fmt(total) : ''}${suffix})`);
      }
      return;
    }
    const bar = percent >= 0 ? barOf(percent) : '';
    const sec = Math.floor((Date.now() - start) / 1000);
    const line = `${label} ${bar} ${percent >= 0 ? percent + '%' : ''} ${fmt(received)}${total ? '/' + fmt(total) : ''}${suffix} ${sec}s`;
    const pad = Math.max(0, lastLen - line.length);
    process.stderr.write(`\r${line}${' '.repeat(pad)}`);
    lastLen = line.length;
  }

  function done() {
    if (isTTY) process.stderr.write('\n');
  }

  return { update, done };
}

function barOf(percent, width = 20) {
  const filled = Math.round((percent / 100) * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)}${units[i]}`;
}
