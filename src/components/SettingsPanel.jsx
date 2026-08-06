import { FORMAT_OPTIONS, MEDIA_TYPE } from '../../electron/shared/constants.js';

export default function SettingsPanel({ settings, onChange }) {
  const formatOptions = FORMAT_OPTIONS[settings.mediaType] ?? [];

  const handleChooseDir = async () => {
    const dir = await window.catCatch.chooseOutputDir();
    if (dir) onChange({ outDir: dir });
  };

  const handleMediaType = (mediaType) => {
    const nextFormat = FORMAT_OPTIONS[mediaType]?.[0]?.value ?? settings.format;
    onChange({ mediaType, format: nextFormat });
  };

  return (
    <div className="panel settings-panel">
      <div className="field">
        <label>输出位置</label>
        <div className="field-row">
          <input type="text" readOnly value={settings.outDir} />
          <button className="btn btn-ghost" onClick={handleChooseDir}>
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
              name="mediaType"
              checked={settings.mediaType === MEDIA_TYPE.VIDEO}
              onChange={() => handleMediaType(MEDIA_TYPE.VIDEO)}
            />
            视频
          </label>
          <label className="radio">
            <input
              type="radio"
              name="mediaType"
              checked={settings.mediaType === MEDIA_TYPE.AUDIO}
              onChange={() => handleMediaType(MEDIA_TYPE.AUDIO)}
            />
            音频
          </label>
        </div>
      </div>

      <div className="field">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.transcode}
            onChange={(e) => onChange({ transcode: e.target.checked })}
          />
          转码
        </label>
      </div>

      {settings.transcode && (
        <div className="field">
          <label>转码格式</label>
          <select value={settings.format} onChange={(e) => onChange({ format: e.target.value })}>
            {formatOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label>重试次数</label>
        <input
          type="number"
          min={1}
          max={99}
          value={settings.retryCount}
          onChange={(e) => onChange({ retryCount: parseInt(e.target.value, 10) || 10 })}
        />
      </div>
    </div>
  );
}
