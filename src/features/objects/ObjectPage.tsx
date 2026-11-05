import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { Empty, Loading, Notice } from "../../components/ui";
import type { ObjectRow, Task } from "../../lib/database";
import { getSupabase } from "../../lib/supabase";
import { useLoad } from "../../lib/useLoad";
import { TaskForm } from "../tasks/TaskForm";
import { TaskList } from "../tasks/TaskList";
import { ObjectForm } from "./ObjectsPage";

export function ObjectPage() {
  const { id = "" } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const manager = profile?.role === "manager";
  const [editing, setEditing] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [actionError, setActionError] = useState("");
  const {
    data: object,
    error,
    refresh,
  } = useLoad<ObjectRow>(async () => {
    const { data, error } = await getSupabase()
      .from("objects")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Объект не найден или у вас нет доступа.");
    return data;
  }, [id]);
  const tasksQuery = useLoad<Task[]>(async () => {
    const { data, error } = await getSupabase()
      .from("tasks")
      .select("*")
      .eq("object_id", id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }, [id]);

  async function remove() {
    if (!window.confirm("Удалить объект?")) return;
    const { error: deleteError } = await getSupabase().rpc("delete_object", {
      p_object_id: id,
    });
    if (deleteError) setActionError(deleteError.message);
    else navigate("/objects", { replace: true });
  }

  return (
    <main className="content">
      <Link className="back-link" to="/objects">
        ← Все объекты
      </Link>
      {actionError && <Notice bad>{actionError}</Notice>}
      {error ? (
        <Notice bad>{error}</Notice>
      ) : !object ? (
        <Loading />
      ) : (
        <>
          <div className="page-heading object-heading">
            <div>
              <h1>{object.title}</h1>
              <p className="muted">⌖ &nbsp;{object.address}</p>
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
                  onClick={() => void remove()}
                >
                  Удалить
                </button>
              </div>
            )}
          </div>
          <section className="section-head">
            <div>
              <h2>Задачи</h2>
              <span className="muted">{tasksQuery.data?.length ?? "…"}</span>
            </div>
            {manager && (
              <button
                className="button primary"
                onClick={() => setCreatingTask(true)}
              >
                ＋ Новая задача
              </button>
            )}
          </section>
          {tasksQuery.error && <Notice bad>{tasksQuery.error}</Notice>}
          {!tasksQuery.data ? (
            !tasksQuery.error && <Loading />
          ) : tasksQuery.data.length === 0 ? (
            <Empty
              title="Задач пока нет"
              detail={
                manager
                  ? "Добавьте первую задачу для этого объекта."
                  : "Здесь появятся задачи объекта."
              }
            />
          ) : (
            <TaskList tasks={tasksQuery.data} />
          )}
        </>
      )}
      {editing && object && (
        <ObjectForm
          initial={object}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
      {creatingTask && (
        <TaskForm
          objectId={id}
          initial={null}
          onClose={() => setCreatingTask(false)}
          onSaved={() => {
            setCreatingTask(false);
            tasksQuery.refresh();
          }}
        />
      )}
    </main>
  );
}
