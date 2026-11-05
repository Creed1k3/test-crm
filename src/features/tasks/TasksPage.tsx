import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import {
  Empty,
  ConfirmDialog,
  Loading,
  Notice,
  StatusPill,
  Modal,
  initials,
} from "../../components/ui";
import type {
  HistoryRow,
  ObjectRow,
  Profile,
  Status,
  Task,
} from "../../lib/database";
import { statusLabel } from "../../lib/database";
import { getSupabase } from "../../lib/supabase";
import { useLoad } from "../../lib/useLoad";
import { TaskForm } from "./TaskForm";
import { TaskList } from "./TaskList";
import { TaskCollaboration } from "./TaskCollaboration";

export function MyTasksPage() {
  const { profile } = useAuth();
  const {
    data: tasks,
    error,
    refresh,
  } = useLoad<Task[]>(async () => {
    const { data, error } = await getSupabase()
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data.filter(
      (task) => task.assignee_id === profile!.id || task.assignee_id === null,
    );
  }, [profile?.id]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);
  const groups: Status[] = [
    "new",
    "in_progress",
    "rework",
    "in_review",
    "accepted",
  ];

  return (
    <main className="content">
      <div className="page-heading">
        <h1>Мои задачи</h1>
      </div>
      {error && <Notice bad>{error}</Notice>}
      {!tasks ? (
        !error && <Loading />
      ) : tasks.length === 0 ? (
        <Empty
          title="Задач пока нет"
          detail="Назначенные вам задачи появятся здесь."
        />
      ) : (
        <div className="my-task-groups">
          {tasks.some((task) => task.assignee_id === null) && (
            <section className="my-task-group">
              <h2>
                Доступные задачи{" "}
                <span className="group-count">
                  {tasks.filter((task) => task.assignee_id === null).length}
                </span>
              </h2>
              <p className="muted available-hint">
                Задача станет вашей, когда вы возьмёте её в работу.
              </p>
              <TaskList
                tasks={tasks.filter((task) => task.assignee_id === null)}
              />
            </section>
          )}
          {groups.map((status) => {
            const list = tasks.filter(
              (task) =>
                task.assignee_id === profile?.id && task.status === status,
            );
            return (
              list.length > 0 && (
                <section className="my-task-group" key={status}>
                  <h2>
                    <StatusPill status={status} />
                    <span className="group-count">{list.length}</span>
                  </h2>
                  <TaskList tasks={list} />
                </section>
              )
            );
          })}
        </div>
      )}
    </main>
  );
}

export function TaskPage() {
  const { id = "" } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const manager = profile?.role === "manager";
  const {
    data: task,
    error,
    refresh,
  } = useLoad<Task>(async () => {
    const { data, error } = await getSupabase()
      .from("tasks")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Задача не найдена или у вас нет доступа.");
    return data;
  }, [id]);
  const history = useLoad<HistoryRow[]>(async () => {
    const { data, error } = await getSupabase()
      .from("task_status_history")
      .select("*")
      .eq("task_id", id)
      .order("created_at")
      .order("id");
    if (error) throw error;
    return data;
  }, [id]);
  const object = useLoad<ObjectRow | null>(async () => {
    if (!task) return null;
    const { data, error } = await getSupabase()
      .from("objects")
      .select("*")
      .eq("id", task.object_id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, [task?.object_id]);
  const actorIds = [
    ...new Set((history.data ?? []).map((entry) => entry.actor_id)),
  ];
  const actorKey = actorIds.join(",");
  const actors = useLoad<Profile[]>(async () => {
    if (!actorIds.length) return [];
    const { data, error } = await getSupabase()
      .from("profiles")
      .select("*")
      .in("id", actorIds);
    if (error) throw error;
    return data;
  }, [actorKey]);
  const actorNames = useMemo(
    () =>
      new Map(
        (actors.data ?? []).map((actor) => [actor.id, actor.display_name]),
      ),
    [actors.data],
  );
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [actionError, setActionError] = useState("");
  const [unavailableTaskId, setUnavailableTaskId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const canClaim =
    !!task && profile?.role === "performer" && task.assignee_id === null;
  const performerCanAct =
    !!task &&
    task.assignee_id === profile?.id &&
    ["new", "in_progress", "rework"].includes(task.status);
  const managerCanAct = manager && !!task && task.status === "in_review";

  async function transition(status: Status) {
    setBusy(true);
    setActionError("");
    const { error } = await getSupabase().rpc("transition_task", {
      p_task_id: id,
      p_to_status: status,
      ...(status === "rework" ? { p_comment: comment.trim() } : {}),
    });
    setBusy(false);
    if (error) setActionError(error.message);
    else {
      setComment("");
      if (status === "rework") setReturnOpen(false);
      refresh();
      history.refresh();
    }
  }

  async function claim() {
    setBusy(true);
    setActionError("");
    const { error } = await getSupabase().rpc("claim_task", { p_task_id: id });
    setBusy(false);
    if (error) {
      if (error.message.includes("Task not found")) {
        setUnavailableTaskId(id);
      } else {
        setActionError(
          "Не удалось взять задачу. Проверьте соединение и повторите попытку.",
        );
      }
      refresh();
    } else {
      refresh();
      history.refresh();
    }
  }

  if (unavailableTaskId === id)
    return (
      <main className="content">
        <Notice bad>
          Эта задача больше недоступна.{" "}
          <Link to="/my-tasks">Вернуться к моим и доступным задачам</Link>
        </Notice>
      </main>
    );
  if (error)
    return (
      <main className="content">
        <Notice bad>{error}</Notice>
      </main>
    );
  if (!task)
    return (
      <main className="content">
        <Loading />
      </main>
    );

  return (
    <main className="content">
      <Link className="back-link" to={`/objects/${task.object_id}`}>
        ← К объекту
      </Link>
      {actionError && <Notice bad>{actionError}</Notice>}
      <div className="task-header">
        <div>
          <h1>{task.title}</h1>
          <div className="task-subline">
            <StatusPill status={task.status} />
            <span>
              Создана{" "}
              {new Date(task.created_at).toLocaleString("ru-RU", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </div>
        </div>
        {manager && (
          <div className="heading-actions">
            <button
              className="button secondary"
              onClick={() => setEditing(true)}
            >
              Редактировать
            </button>
            <button
              className="button quiet danger-text"
              onClick={() => setConfirmDelete(true)}
            >
              Удалить
            </button>
          </div>
        )}
      </div>

      <div className="detail-grid">
        <section className="detail-main">
          <div className="detail-section">
            <h2>Описание</h2>
            <p className="description-text">
              {task.description || "Описание не добавлено."}
            </p>
          </div>
          <TaskCollaboration
            task={task}
            uploading={uploading}
            setUploading={setUploading}
            canUpload={
              manager ||
              (task.assignee_id === profile?.id &&
                ["in_progress", "rework"].includes(task.status))
            }
          />
          <div className="detail-section">
            <h2>История изменений</h2>
            {history.error && <Notice bad>{history.error}</Notice>}
            {!history.data ? (
              !history.error && <Loading />
            ) : history.data.length === 0 ? (
              <p className="muted">История пока пуста.</p>
            ) : (
              <ol className="timeline">
                {history.data.map((entry) => (
                  <li key={entry.id}>
                    <span
                      className={`timeline-dot status-${entry.to_status}`}
                    />
                    <div>
                      <strong>
                        {entry.from_status
                          ? statusLabel[entry.from_status]
                          : "Создана"}{" "}
                        <span className="timeline-arrow">→</span>{" "}
                        {statusLabel[entry.to_status]}
                      </strong>
                      <p>
                        {actorNames.get(entry.actor_id) ?? "Участник"} ·{" "}
                        {new Date(entry.created_at).toLocaleString("ru-RU", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                      {entry.comment && (
                        <blockquote>{entry.comment}</blockquote>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <aside className="detail-side">
          <div className="side-section">
            <h2>Детали</h2>
            <Detail label="Объект">
              <Link to={`/objects/${task.object_id}`}>
                {object.data?.title ?? "Открыть объект"} →
              </Link>
            </Detail>
            {task.assignee_id ? (
              <PersonDetail label="Исполнитель" personId={task.assignee_id} />
            ) : (
              <Detail label="Исполнитель">Ожидает исполнителя</Detail>
            )}
            {manager && task.assignment_mode === "open" && (
              <Detail label="Распределение">
                Общая задача — доступна всем исполнителям
              </Detail>
            )}
            {manager && task.assignment_mode === "candidates" && (
              <CandidateDetail taskId={task.id} />
            )}
            <PersonDetail label="Постановщик" personId={task.author_id} />
          </div>
          {(managerCanAct || performerCanAct || canClaim) && (
            <div className="side-section actions-section">
              <h2>Действия</h2>
              {canClaim ? (
                <button
                  className="button primary full"
                  disabled={busy}
                  onClick={() => void claim()}
                >
                  Взять в работу
                </button>
              ) : managerCanAct ? (
                <>
                  <button
                    className="button success full"
                    disabled={busy}
                    onClick={() => void transition("accepted")}
                  >
                    Принять задачу
                  </button>
                  <button
                    className="button destructive full"
                    disabled={busy}
                    onClick={() => setReturnOpen(true)}
                  >
                    Вернуть на доработку
                  </button>
                </>
              ) : task.status === "in_progress" ? (
                <button
                  className="button primary full"
                  disabled={busy || uploading}
                  onClick={() => void transition("in_review")}
                >
                  {uploading ? "Загружаем вложения…" : "Отправить на проверку"}
                </button>
              ) : (
                <button
                  className="button primary full"
                  disabled={busy}
                  onClick={() => void transition("in_progress")}
                >
                  {task.status === "new"
                    ? "Взять в работу"
                    : "Продолжить работу"}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
      {editing && (
        <TaskForm
          objectId={task.object_id}
          initial={task}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
      {returnOpen && (
        <Modal
          title="Комментарий для возврата"
          onClose={() => setReturnOpen(false)}
          closeDisabled={busy}
        >
          {actionError && <Notice bad>{actionError}</Notice>}
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (comment.trim()) void transition("rework");
            }}
          >
            <label>
              Что нужно исправить?
              <textarea
                autoFocus
                rows={4}
                required
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Опишите, что нужно доработать"
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setReturnOpen(false)}
              >
                Отмена
              </button>
              <button
                className="button destructive"
                disabled={busy || !comment.trim()}
              >
                {busy ? "Возвращаем…" : "Вернуть на доработку"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Удалить задачу?"
          description="Задача исчезнет из списков. История изменений сохранится в системе."
          confirmLabel="Удалить задачу"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            const { error } = await getSupabase().rpc("delete_task", {
              p_task_id: id,
            });
            if (error) throw error;
            navigate("/objects", { replace: true });
          }}
        />
      )}
    </main>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function PersonDetail({
  label,
  personId,
}: {
  label: string;
  personId: string;
}) {
  const { profile } = useAuth();
  const [name, setName] = useState(
    personId === profile?.id ? profile.display_name : "",
  );
  useEffect(() => {
    if (personId === profile?.id) {
      setName(profile.display_name);
      return;
    }
    let active = true;
    getSupabase()
      .from("profiles")
      .select("display_name")
      .eq("id", personId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setName(data?.display_name ?? "Участник");
      });
    return () => {
      active = false;
    };
  }, [personId, profile]);
  return (
    <Detail label={label}>
      <span className="person-chip">
        <span className="avatar small-avatar">{initials(name || "?")}</span>
        {name || "Загрузка…"}
      </span>
    </Detail>
  );
}

function CandidateDetail({ taskId }: { taskId: string }) {
  const candidates = useLoad<string[]>(async () => {
    const { data, error } = await getSupabase()
      .from("task_candidates")
      .select("performer_id")
      .eq("task_id", taskId);
    if (error) throw error;
    return data.map(({ performer_id }) => performer_id);
  }, [taskId]);
  const ids = candidates.data ?? [];
  const people = useLoad<Profile[]>(async () => {
    if (!ids.length) return [];
    const { data, error } = await getSupabase()
      .from("profiles")
      .select("*")
      .in("id", ids);
    if (error) throw error;
    return data;
  }, [ids.join(",")]);
  return (
    <Detail label="Кто может взять задачу">
      {candidates.error || people.error
        ? "Не удалось загрузить список"
        : !people.data
          ? "Загрузка…"
          : people.data.map((person) => person.display_name).join(", ") ||
            "Нет выбранных исполнителей"}
    </Detail>
  );
}
