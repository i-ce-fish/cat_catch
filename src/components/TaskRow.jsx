import { MAX_SNIFF_ATTEMPTS, TASK_STATUS } from '../../electron/shared/constants.js';

const STATUS_LABEL = {
  [TASK_STATUS.QUEUED]: '排队中',
  [TASK_STATUS.SNIFFING]: '嗅探中',
  [TASK_STATUS.RETRYING]: '重试中',
  [TASK_STATUS.DOWNLOADING]: '下载中',
  [TASK_STATUS.SUCCESS]: '已完成',
  [TASK_STATUS.FAILED]: '失败',
};

function shorten(url, n = 56) {
  return url.length > n ? `${url.slice(0, n - 3)}...` : url;
}

export default function TaskRow({ task, onRetry }) {
  const label = STATUS_LABEL[task.status] ?? task.status;
  const statusText =
    task.status === TASK_STATUS.RETRYING || (task.status === TASK_STATUS.SNIFFING && task.attempt > 1)
      ? `${label} ${task.attempt}/${MAX_SNIFF_ATTEMPTS}`
      : label;

  const canRetry = task.status === TASK_STATUS.FAILED;
  const canOpen = task.status === TASK_STATUS.SUCCESS && task.outputFiles?.length > 0;

  return (
    <tr className={`task-row status-${task.status}`}>
      <td className="task-url" title={task.url}>
        {shorten(task.url)}
      </td>
      <td className="task-filename" title={task.filename || undefined}>
        {task.filename ? shorten(task.filename, 40) : '—'}
      </td>
      <td>
        <span className={`badge badge-${task.status}`}>{statusText}</span>
      </td>
      <td className="task-progress">
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${task.percent ?? 0}%` }} />
        </div>
        <span className="progress-text">
          {task.phase ? `${task.phase} ` : ''}
          {task.percent ?? 0}%
        </span>
        {task.error && <div className="task-error">{task.error}</div>}
      </td>
      <td className="task-actions">
        {canRetry && (
          <button className="btn btn-ghost btn-small" onClick={() => onRetry(task.id)}>
            手动重试
          </button>
        )}
        {canOpen && (
          <button className="btn btn-ghost btn-small" onClick={() => window.catCatch.openOutput(task.outputFiles[0])}>
            打开文件夹
          </button>
        )}
      </td>
    </tr>
  );
}
