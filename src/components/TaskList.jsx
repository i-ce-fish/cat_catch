import TaskRow from './TaskRow.jsx';

export default function TaskList({ tasks, onRetry }) {
  if (!tasks.length) {
    return <p className="hint">暂无任务，去上面添加一个 URL 吧。</p>;
  }
  return (
    <table className="task-table">
      <thead>
        <tr>
          <th>URL</th>
          <th>文件名</th>
          <th>状态</th>
          <th>进度</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} onRetry={onRetry} />
        ))}
      </tbody>
    </table>
  );
}
