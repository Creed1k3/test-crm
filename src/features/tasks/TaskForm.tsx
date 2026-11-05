import { useEffect, useState, type FormEvent } from "react";
import { Modal, Notice } from "../../components/ui";
import type {
  AssignmentMode,
  ObjectRow,
  Profile,
  Task,
} from "../../lib/database";
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
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>(
    initial?.assignment_mode ?? "direct",
  );
  const [assignee, setAssignee] = useState(initial?.assignee_id ?? "");
  const [candidateIds, setCandidateIds] = useState<string[]>([]);
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

  useEffect(() => {
    if (!initial || initial.assignment_mode !== "candidates") return;
    let active = true;
    getSupabase()
      .from("task_candidates")
      .select("performer_id")
      .eq("task_id", initial.id)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setCandidateIds((data ?? []).map((row) => row.performer_id));
      });
    return () => {
      active = false;
    };
  }, [initial]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (
      !normalizedTitle ||
      !selectedObject ||
      (assignmentMode === "direct" && !assignee) ||
      (assignmentMode === "candidates" && candidateIds.length < 2)
    ) {
      setError(
        assignmentMode === "candidates"
          ? "Выберите не менее двух исполнителей."
          : "Укажите название, объект и исполнителя.",
      );
      return;
    }
    setBusy(true);
    setError("");
    const client = getSupabase();
    const result = await client.rpc("save_task", {
      p_task_id: initial?.id ?? null,
      p_title: normalizedTitle,
      p_description: description.trim(),
      p_object_id: selectedObject,
      p_assignment_mode: assignmentMode,
      p_assignee_id: assignmentMode === "direct" ? assignee : null,
      p_candidate_ids: assignmentMode === "candidates" ? candidateIds : [],
    });
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
          Кому назначить
          <select
            value={assignmentMode}
            onChange={(event) =>
              setAssignmentMode(event.target.value as AssignmentMode)
            }
          >
            <option value="direct">Одному исполнителю</option>
            {(!initial || initial.status === "new") && (
              <>
                <option value="candidates">Нескольким — кто возьмёт</option>
                <option value="open">Общая задача для всех</option>
              </>
            )}
          </select>
        </label>
        {assignmentMode === "direct" && (
          <label>
            Исполнитель
            <select
              required={assignmentMode === "direct"}
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
        )}
        {assignmentMode === "candidates" && (
          <fieldset className="candidate-picker">
            <legend>Исполнители — выберите минимум двух</legend>
            {people.map((person) => (
              <label key={person.id}>
                <input
                  type="checkbox"
                  checked={candidateIds.includes(person.id)}
                  onChange={(event) =>
                    setCandidateIds((ids) =>
                      event.target.checked
                        ? [...ids, person.id]
                        : ids.filter((id) => id !== person.id),
                    )
                  }
                />
                {person.display_name}
              </label>
            ))}
            <small>Первый, кто возьмёт задачу, станет исполнителем.</small>
          </fieldset>
        )}
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
