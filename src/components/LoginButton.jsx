import { useEffect, useState } from 'react';

export default function LoginButton() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  useEffect(() => {
    window.catCatch.bilibiliLogin.getStatus().then((s) => setLoggedIn(s.loggedIn));
    const off = window.catCatch.bilibiliLogin.onStatus((status) => {
      if (status.type === 'opened') {
        setBusy(true);
        setHint('请在弹出的窗口中扫码登录…');
      } else if (status.type === 'success') {
        setBusy(false);
        setLoggedIn(true);
        setHint('登录成功');
        setTimeout(() => setHint(''), 3000);
      } else if (status.type === 'closed_by_user') {
        setBusy(false);
        setHint('已取消登录');
        setTimeout(() => setHint(''), 3000);
      } else if (status.type === 'error') {
        setBusy(false);
        setHint(`登录出错：${status.message ?? ''}`);
      }
    });
    return off;
  }, []);

  const handleLogin = () => {
    setBusy(true);
    window.catCatch.bilibiliLogin.start();
  };

  const handleLogout = async () => {
    await window.catCatch.bilibiliLogin.logout();
    setLoggedIn(false);
  };

  return (
    <div className="login-widget">
      <span className={`login-badge ${loggedIn ? 'on' : 'off'}`}>{loggedIn ? 'B站已登录' : 'B站未登录'}</span>
      {loggedIn ? (
        <button className="btn btn-ghost" onClick={handleLogout}>
          退出登录
        </button>
      ) : (
        <button className="btn" disabled={busy} onClick={handleLogin}>
          {busy ? '登录中…' : '扫码登录 B 站'}
        </button>
      )}
      {hint && <span className="login-hint">{hint}</span>}
    </div>
  );
}
