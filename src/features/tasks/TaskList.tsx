import { Link } from "react-router-dom";
import type { Task } from "../../lib/database";
import { StatusPill } from "../../components/ui";

export function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <div className="task-list">
      {tasks.map((task) => (
        <Link className="task-row" to={`/tasks/${task.id}`} key={task.id}>
          <span className="task-bullet" aria-hidden="true">
            ↗
          </span>
          <span className="task-row-info">
            <strong>{task.title}</strong>
            <small>
              {new Date(task.created_at).toLocaleDateString("ru-RU")}
            </small>
          </span>
          <StatusPill status={task.status} />
          <span className="chevron" aria-hidden="true">
            ›
          </span>
        </Link>
      ))}
    </div>
  );
}
