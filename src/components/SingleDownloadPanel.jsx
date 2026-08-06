import { useState } from 'react';
import { FORMAT_OPTIONS, MEDIA_TYPE } from '../../electron/shared/constants.js';

export default function SingleDownloadPanel({ settings, onSubmitted }) {
  const [url, setUrl] = useState('');
  const [useDefault, setUseDefault] = useState(true);
  const [override, setOverride] = useState(() => ({ ...settings }));
  const [submitting, setSubmitting] = useState(false);

  const config = useDefault ? settings : override;
  const formatOptions = FORMAT_OPTIONS[config.mediaType] ?? [];

  const patchOverride = (patch) => setOverride((prev) => ({ ...prev, ...patch }));

  const handleChooseDir = async () => {
    const dir = await window.catCatch.chooseOutputDir();
    if (dir) patchOverride({ outDir: dir });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim() || submitting) return;
    setSubmitting(true);
    try {
      const tasks = await window.catCatch.submitSingle(url, config);
      onSubmitted(tasks);
      setUrl('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <div className="field">
        <label>URL</label>
        <input
          type="text"
          placeholder="粘贴网页地址，如 https://www.bilibili.com/video/BV..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="checkbox">
          <input type="checkbox" checked={useDefault} onChange={(e) => setUseDefault(e.target.checked)} />
          使用默认配置直接下载
        </label>
      </div>

      {!useDefault && (
        <div className="inline-config">
          <div className="field">
            <label>输出位置</label>
            <div className="field-row">
              <input type="text" readOnly value={override.outDir} />
              <button type="button" className="btn btn-ghost" onClick={handleChooseDir}>
                选择文件夹
              </button>
            </div>
          </div>
          <div className="field">
            <label>媒体类型</label>
            <div className="field-row">
              <label className="radio">
                <input
                  type="radio"
                  checked={override.mediaType === MEDIA_TYPE.VIDEO}
                  onChange={() => patchOverride({ mediaType: MEDIA_TYPE.VIDEO, format: FORMAT_OPTIONS.video[0].value })}
                />
                视频
              </label>
              <label className="radio">
                <input
                  type="radio"
                  checked={override.mediaType === MEDIA_TYPE.AUDIO}
                  onChange={() => patchOverride({ mediaType: MEDIA_TYPE.AUDIO, format: FORMAT_OPTIONS.audio[0].value })}
                />
                音频
              </label>
            </div>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={override.transcode}
                onChange={(e) => patchOverride({ transcode: e.target.checked })}
              />
              转码
            </label>
          </div>
          {override.transcode && (
            <div className="field">
              <label>转码格式</label>
              <select value={override.format} onChange={(e) => patchOverride({ format: e.target.value })}>
                {formatOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <button className="btn btn-primary" type="submit" disabled={submitting || !url.trim()}>
        开始下载
      </button>
    </form>
  );
}
