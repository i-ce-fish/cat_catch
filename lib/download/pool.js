/**
 * 极简并发池：worker 抛错即整体失败（m3u8 分片场景 fail-fast）。
 * 直链多文件场景在 worker 内部 catch 返回错误对象。
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>} 按原顺序的结果数组
 */
export async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: lanes }, run));
  return results;
}
