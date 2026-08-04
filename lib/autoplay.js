/**
 * 触发页面媒体播放：先静音 play() 全部 video/audio（autoplay 策略允许静音播放），
 * 再启发式点击常见播放按钮。全部 best-effort，任何失败都不中断。
 */

const PLAY_BUTTON_SELECTORS = [
  // B 站播放器
  '.bpx-player-ctrl-play',
  '.bilibili-player-video-btn-start',
  '.bpx-player-ctrl-btn-play',
  // 常见播放器 UI
  '.vjs-big-play-button', // video.js
  '.xgplayer-start', // 西瓜播放器
  '.dplayer-play-icon', // dplayer
  '[class*="play-btn"]',
  '[class*="playBtn"]',
  '[class*="btn-play"]',
  'button[aria-label*="播放"]',
  'button[aria-label*="Play"]',
  'button[aria-label*="play"]',
];

/**
 * @param {import('playwright').Page} page
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.log]
 */
export async function triggerAutoplay(page, { log } = {}) {
  // 1. 所有 frame 里静音播放全部媒体元素
  for (const frame of page.frames()) {
    try {
      await frame.evaluate(() => {
        document.querySelectorAll('video, audio').forEach((m) => {
          try {
            m.muted = true;
            const p = m.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
          } catch {}
        });
      });
    } catch {
      // frame 可能已 detach，忽略
    }
  }

  // 2. 逐个尝试播放按钮，点中一个即停
  for (const sel of PLAY_BUTTON_SELECTORS) {
    try {
      const el = await page.$(sel);
      if (!el) continue;
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      await el.click({ timeout: 800 }).catch(() => {});
      log?.(`已点击播放按钮: ${sel}`);
      return true;
    } catch {
      // 选择器失效/元素消失，继续下一个
    }
  }
  return false;
}
