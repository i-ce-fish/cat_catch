import { useCallback, useEffect, useState } from 'react';
import LoginButton from './components/LoginButton.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import SingleDownloadPanel from './components/SingleDownloadPanel.jsx';
import BatchDownloadPanel from './components/BatchDownloadPanel.jsx';
import TaskList from './components/TaskList.jsx';

const TABS = [
  { id: 'single', label: '单个下载' },
  { id: 'batch', label: '批量下载' },
];

export default function App() {
  const [tab, setTab] = useState('single');
  const [settings, setSettingsState] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    window.catCatch.getSettings().then(setSettingsState);
    window.catCatch.listTasks().then(setTasks);
    const off = window.catCatch.onTaskUpdate((task) => {
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === task.id);
        if (idx === -1) return [task, ...prev];
        const next = [...prev];
        next[idx] = task;
        return next;
      });
    });
    return off;
  }, []);

  const updateSettings = useCallback(async (patch) => {
    const next = await window.catCatch.setSettings(patch);
    setSettingsState(next);
  }, []);

  const addTasks = useCallback((newTasks) => {
    if (!newTasks?.length) return;
    setTasks((prev) => {
      const existingIds = new Set(prev.map((t) => t.id));
      const toPrepend = newTasks.filter((t) => !existingIds.has(t.id));
      return [...toPrepend, ...prev];
    });
  }, []);

  const retryTask = useCallback(async (id) => {
    const task = await window.catCatch.retryTask(id);
    if (task) setTasks((prev) => prev.map((t) => (t.id === id ? task : t)));
  }, []);

  if (!settings) {
    return (
      <div className="app-loading">
        <p>加载中…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>cat_catch</h1>
        <div className="app-header-actions">
          <LoginButton />
          <button className="btn btn-ghost" onClick={() => setSettingsOpen(true)}>
            默认配置
          </button>
        </div>
      </header>

      <SettingsPanel
        settings={settings}
        onChange={updateSettings}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <section className="tab-content">
        {tab === 'single' ? (
          <SingleDownloadPanel settings={settings} onSubmitted={addTasks} />
        ) : (
          <BatchDownloadPanel settings={settings} onSubmitted={addTasks} />
        )}
      </section>

      <section className="task-section">
        <h2>任务列表</h2>
        <TaskList tasks={tasks} onRetry={retryTask} />
      </section>
    </div>
  );
}
