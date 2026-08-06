import { useEffect, useState } from 'react';

export default function LoginButton() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.catCatch.bilibiliLogin.getStatus().then((s) => setLoggedIn(s.loggedIn));
    const off = window.catCatch.bilibiliLogin.onStatus((status) => {
      if (status.type === 'opened') {
        setBusy(true);
      } else if (status.type === 'success') {
        setBusy(false);
        setLoggedIn(true);
      } else if (status.type === 'closed_by_user') {
        setBusy(false);
      } else if (status.type === 'error') {
        setBusy(false);
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
    </div>
  );
}
