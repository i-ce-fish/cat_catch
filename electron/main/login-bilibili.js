// 命名空间导入 + 解构：规避 Electron 43 + Node 24 对懒 getter 导出的 ESM 静态分析问题（见 main/index.js 注释）
import * as electron from 'electron';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';

const { app, BrowserWindow, session } = electron;

const PARTITION = 'persist:cat-catch-bilibili-login';
const LOGIN_URL = 'https://passport.bilibili.com/login';
const COOKIE_DOMAIN_RE = /(^|\.)bilibili\.com$/;

function cookieFile() {
  return path.join(app.getPath('userData'), 'bilibili-cookies.json');
}

function toPlaywrightCookie(c) {
  const sameSiteMap = { no_restriction: 'None', lax: 'Lax', strict: 'Strict', unspecified: 'Lax' };
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.session ? -1 : (c.expirationDate ?? -1),
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: sameSiteMap[c.sameSite] ?? 'Lax',
  };
}

const CLOSE_BUTTON_CSS = `
  #cat-catch-login-close {
    position: fixed;
    top: 8px;
    right: 8px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 18px;
    line-height: 28px;
    text-align: center;
    padding: 0;
    cursor: pointer;
    z-index: 2147483647;
  }
  #cat-catch-login-close:hover {
    background: rgba(0, 0, 0, 0.75);
  }
`;

const CLOSE_BUTTON_SCRIPT = `
  (function () {
    if (document.getElementById('cat-catch-login-close')) return;
    var btn = document.createElement('button');
    btn.id = 'cat-catch-login-close';
    btn.type = 'button';
    btn.title = '关闭';
    btn.setAttribute('aria-label', '关闭');
    btn.textContent = '\\u00d7';
    btn.addEventListener('click', function () { window.close(); });
    document.body.appendChild(btn);
  })();
`;

export function startBilibiliLogin(parent, onStatus = () => {}) {
  return new Promise((resolve) => {
    const ses = session.fromPartition(PARTITION);
    const win = new BrowserWindow({
      width: 480,
      height: 640,
      parent: parent ?? undefined,
      title: '扫码登录 B 站',
      autoHideMenuBar: true,
      webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false },
    });

    let settled = false;
    let hasFocused = false;
    const finish = async (type, message) => {
      if (settled) return;
      settled = true;
      ses.cookies.removeListener('changed', onCookieChanged);
      onStatus({ type, message });
      if (!win.isDestroyed()) win.close();
      resolve();
    };

    // 注入自定义关闭按钮，因为登录页面来自 B 站远程站点，原生窗口作为非模态子窗口不强制带自带的关闭控件
    win.webContents.on('dom-ready', () => {
      if (win.isDestroyed()) return;
      win.webContents.insertCSS(CLOSE_BUTTON_CSS).catch(() => {});
      win.webContents.executeJavaScript(CLOSE_BUTTON_SCRIPT).catch(() => {});
    });

    // 支持 Esc 键关闭
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        if (!win.isDestroyed()) win.close();
      }
    });

    // 支持点击窗口以外区域（如主窗口）时关闭
    win.on('focus', () => {
      hasFocused = true;
    });
    win.on('blur', () => {
      if (hasFocused && !settled && !win.isDestroyed()) win.close();
    });

    async function checkLoggedIn() {
      try {
        const cookies = await ses.cookies.get({ domain: 'bilibili.com' });
        const sessdata = cookies.find((c) => c.name === 'SESSDATA' && c.value);
        if (!sessdata) return;
        const bCookies = cookies.filter((c) => COOKIE_DOMAIN_RE.test(c.domain));
        const mapped = bCookies.map(toPlaywrightCookie);
        await mkdir(path.dirname(cookieFile()), { recursive: true });
        await writeFile(cookieFile(), JSON.stringify(mapped, null, 2), 'utf8');
        await finish('success', '登录成功，已保存登录状态');
      } catch (err) {
        await finish('error', err.message);
      }
    }

    const onCookieChanged = (_event, cookie) => {
      if (COOKIE_DOMAIN_RE.test(cookie.domain) && cookie.name === 'SESSDATA') checkLoggedIn();
    };
    ses.cookies.on('changed', onCookieChanged);

    win.on('closed', () => finish(settled ? 'success' : 'closed_by_user'));

    const poll = setInterval(() => {
      if (settled) return clearInterval(poll);
      checkLoggedIn();
    }, 2000);
    win.on('closed', () => clearInterval(poll));

    onStatus({ type: 'opened' });
    win.loadURL(LOGIN_URL).catch((err) => finish('error', err.message));
  });
}

export async function loadBilibiliCookies() {
  try {
    const text = await readFile(cookieFile(), 'utf8');
    const cookies = JSON.parse(text);
    return Array.isArray(cookies) && cookies.length ? cookies : null;
  } catch {
    return null;
  }
}

export async function getBilibiliLoginStatus() {
  const cookies = await loadBilibiliCookies();
  const hasSession = !!cookies?.some((c) => c.name === 'SESSDATA' && c.value);
  return { loggedIn: hasSession };
}

export async function logoutBilibili() {
  await rm(cookieFile(), { force: true });
  try {
    const ses = session.fromPartition(PARTITION);
    await ses.clearStorageData({ storages: ['cookies'] });
  } catch {
    // session 不存在也无妨
  }
}
