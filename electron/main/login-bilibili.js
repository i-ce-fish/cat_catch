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

export function startBilibiliLogin(parent, onStatus = () => {}) {
  return new Promise((resolve) => {
    const ses = session.fromPartition(PARTITION);
    const win = new BrowserWindow({
      width: 480,
      height: 640,
      parent: parent ?? undefined,
      modal: !!parent,
      title: '扫码登录 B 站',
      autoHideMenuBar: true,
      webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false },
    });

    let settled = false;
    const finish = async (type, message) => {
      if (settled) return;
      settled = true;
      ses.cookies.removeListener('changed', onCookieChanged);
      onStatus({ type, message });
      if (!win.isDestroyed()) win.close();
      resolve();
    };

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
