import { useEffect, useState, type FormEvent } from "react";
import { Modal, Notice } from "../../components/ui";
import type { ObjectRow, Profile, Task } from "../../lib/database";
import { getSupabase } from "../../lib/supabase";

export function TaskForm({
  objectId,
  initial,
  onClose,
  onSaved,
}: {
  objectId: string;
  initial: Task | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [selectedObject, setSelectedObject] = useState(
    initial?.object_id ?? objectId,
  );
  const [assignee, setAssignee] = useState(initial?.assignee_id ?? "");
  const [objects, setObjects] = useState<ObjectRow[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const client = getSupabase();
    Promise.all([
      client.from("objects").select("*").order("title"),
      client
        .from("profiles")
        .select("*")
        .eq("role", "performer")
        .order("display_name"),
    ])
      .then(([objectResult, peopleResult]) => {
        if (!active) return;
        if (objectResult.error || peopleResult.error) {
          setError(
            objectResult.error?.message ??
              peopleResult.error?.message ??
              "Не удалось загрузить справочники.",
          );
          return;
        }
        setObjects(objectResult.data);
        setPeople(peopleResult.data);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || !selectedObject || !assignee) {
      setError("Укажите название, объект и исполнителя.");
      return;
    }
    setBusy(true);
    setError("");
    const client = getSupabase();
    const payload = {
      title: normalizedTitle,
      description: description.trim(),
      object_id: selectedObject,
      assignee_id: assignee,
    };
    const result = initial
      ? await client
          .from("tasks")
          .update(payload)
          .eq("id", initial.id)
          .select("id")
          .maybeSingle()
      : await client.from("tasks").insert(payload).select("id").single();
    setBusy(false);
    if (result.error) setError(result.error.message);
    else if (!result.data) setError("Задача не найдена или у вас нет доступа.");
    else onSaved();
  }

  return (
    <Modal
      title={initial ? "Редактировать задачу" : "Новая задача"}
      onClose={onClose}
      wide
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
          Описание
          <textarea
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          Объект
          <select
            required
            value={selectedObject}
            onChange={(event) => setSelectedObject(event.target.value)}
          >
            <option value="">Выберите объект</option>
            {objects.map((object) => (
              <option value={object.id} key={object.id}>
                {object.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Исполнитель
          <select
            required
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <option value="">Выберите исполнителя</option>
            {people.map((person) => (
              <option value={person.id} key={person.id}>
                {person.display_name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Отмена
          </button>
          <button
            className="button primary"
            disabled={busy || !objects.length || !people.length}
          >
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
