import { useState } from 'react';

export default function BatchDownloadPanel({ settings, onSubmitted }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const count = text.split(/\s+/).map((s) => s.trim()).filter(Boolean).length;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const tasks = await window.catCatch.submitBatch(text, settings);
      onSubmitted(tasks);
      setText('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <div className="field">
        <label>批量 URL（空格 / 回车 / 换行分隔）</label>
        <textarea
          rows={8}
          placeholder={'https://example.com/a\nhttps://example.com/b https://example.com/c'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <p className="hint">共识别到 {count} 个 URL，将使用「默认配置」直接下载。</p>
      <button className="btn btn-primary" type="submit" disabled={submitting || !count}>
        开始批量下载
      </button>
    </form>
  );
}
