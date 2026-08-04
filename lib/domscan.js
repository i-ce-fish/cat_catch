/**
 * DOM 媒体扫描：page.frames() 覆盖跨域 iframe（无同源限制，优于猫抓 content-script 方案）。
 * 对照猫抓 content-script.js:9-56 的 getVideoState。
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>} 去重后的媒体 URL（不含 blob:/data:）
 */
export async function scanDomMedia(page) {
  const urls = new Set();
  for (const frame of page.frames()) {
    try {
      const found = await frame.evaluate(() => {
        const out = [];
        document.querySelectorAll('video, audio').forEach((m) => {
          if (m.currentSrc) out.push(m.currentSrc);
          if (m.src) out.push(m.src);
          m.querySelectorAll('source').forEach((s) => {
            if (s.src) out.push(s.src);
          });
        });
        return out.filter((u) => u && !u.startsWith('blob:') && !u.startsWith('data:'));
      });
      found.forEach((u) => urls.add(u));
    } catch {
      // frame detached，跳过
    }
  }
  return [...urls];
}
