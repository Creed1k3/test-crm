import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ConfirmDialog,
  Modal,
  Notice,
  Empty,
  Loading,
} from "../../components/ui";
import { useAuth } from "../../auth/AuthProvider";
import type { ObjectRow } from "../../lib/database";
import { getSupabase } from "../../lib/supabase";
import { useLoad } from "../../lib/useLoad";

export function ObjectsPage() {
  const { profile } = useAuth();
  const manager = profile?.role === "manager";
  const [editing, setEditing] = useState<ObjectRow | null | false>(false);
  const [deleteTarget, setDeleteTarget] = useState<ObjectRow | null>(null);
  const [message, setMessage] = useState("");
  const load = async () => {
    const { data, error } = await getSupabase()
      .from("objects")
      .select("*")
      .order("title");
    if (error) throw error;
    return data;
  };
  const { data: objects, error, refresh } = useLoad(load, []);

  return (
    <main className="content">
      <div className="page-heading">
        <h1>Объекты</h1>
        {manager && (
          <button
            className="button primary"
            onClick={() => {
              setEditing(null);
            }}
          >
            ＋ Новый объект
          </button>
        )}
      </div>
      {message && <Notice>{message}</Notice>}
      {error && <Notice bad>{error}</Notice>}
      {!objects ? (
        !error && <Loading />
      ) : objects.length === 0 ? (
        <Empty
          title="Пока нет объектов"
          detail={
            manager
              ? "Создайте первый объект, чтобы начать работу."
              : "Объекты с назначенными вам задачами появятся здесь."
          }
        />
      ) : (
        <div className="object-list">
          {objects.map((object) => (
            <article className="object-row" key={object.id}>
              <Link to={`/objects/${object.id}`} className="row-main">
                <span className="object-icon" aria-hidden="true">
                  ⌂
                </span>
                <span>
                  <strong>{object.title}</strong>
                  <small>{object.address}</small>
                </span>
              </Link>
              <Link className="text-link" to={`/objects/${object.id}`}>
                Открыть <span aria-hidden="true">→</span>
              </Link>
              {manager && (
                <div className="row-actions">
                  <button
                    className="icon-button"
                    aria-label={`Редактировать ${object.title}`}
                    onClick={() => setEditing(object)}
                  >
                    ✎
                  </button>
                  <button
                    className="icon-button danger-text"
                    aria-label={`Удалить ${object.title}`}
                    onClick={() => setDeleteTarget(object)}
                  >
                    ⌫
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {editing !== false && (
        <ObjectForm
          initial={editing}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setMessage("Объект сохранён.");
            refresh();
          }}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="Удалить объект?"
          description="Объект и его задачи станут недоступны участникам. История изменений сохранится."
          confirmLabel="Удалить объект"
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            const { error } = await getSupabase().rpc("delete_object", {
              p_object_id: deleteTarget.id,
            });
            if (error) throw error;
            refresh();
          }}
        />
      )}
    </main>
  );
}

export function ObjectForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: ObjectRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    const normalizedAddress = address.trim();
    if (!normalizedTitle || !normalizedAddress) {
      setError("Заполните название и адрес объекта.");
      return;
    }
    setBusy(true);
    setError("");
    const client = getSupabase();
    const result = initial
      ? await client
          .from("objects")
          .update({ title: normalizedTitle, address: normalizedAddress })
          .eq("id", initial.id)
          .select("id")
          .maybeSingle()
      : await client
          .from("objects")
          .insert({ title: normalizedTitle, address: normalizedAddress })
          .select("id")
          .single();
    setBusy(false);
    if (result.error) setError(result.error.message);
    else if (!result.data) setError("Объект не найден или у вас нет доступа.");
    else onSaved();
  }

  return (
    <Modal
      title={initial ? "Редактировать объект" : "Новый объект"}
      onClose={onClose}
    >
      {error && <Notice bad>{error}</Notice>}
      <form onSubmit={submit} className="form-stack">
        <label>
          Название
          <input
            required
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Адрес
          <input
            required
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
