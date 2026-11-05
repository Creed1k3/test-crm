import { useEffect, useMemo, useState } from "react";
import { Modal, Notice, Loading } from "../../components/ui";
import type { Profile, Task } from "../../lib/database";
import { getSupabase } from "../../lib/supabase";
import { useAuth } from "../../auth/AuthProvider";
import { useLoad } from "../../lib/useLoad";

type Comment = {
  id: number;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
};
const maxFileSize = 20 * 1024 * 1024;
const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/rtf",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/octet-stream",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "video/mp4",
  "video/quicktime",
]);

export function TaskCollaboration({
  task,
  canUpload,
  uploading,
  setUploading,
}: {
  task: Task;
  canUpload: boolean;
  uploading: boolean;
  setUploading: (uploading: boolean) => void;
}) {
  return (
    <>
      <Attachments
        task={task}
        canUpload={canUpload}
        uploading={uploading}
        setUploading={setUploading}
      />
      <Comments taskId={task.id} />
    </>
  );
}

function Comments({ taskId }: { taskId: string }) {
  const { profile } = useAuth();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const comments = useLoad<Comment[]>(async () => {
    const { data, error } = await getSupabase()
      .from("task_comments")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at")
      .order("id");
    if (error) throw error;
    return data;
  }, [taskId]);
  const authorIds = [
    ...new Set((comments.data ?? []).map((comment) => comment.author_id)),
  ];
  const authors = useLoad<Profile[]>(async () => {
    if (!authorIds.length) return [];
    const { data, error } = await getSupabase()
      .from("profiles")
      .select("*")
      .in("id", authorIds);
    if (error) throw error;
    return data;
  }, [authorIds.join(",")]);
  const names = useMemo(
    () =>
      new Map(
        (authors.data ?? []).map((author) => [author.id, author.display_name]),
      ),
    [authors.data],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = body.trim();
    if (!normalized || !profile) return;
    setSending(true);
    setError("");
    const { error } = await getSupabase()
      .from("task_comments")
      .insert({ task_id: taskId, body: normalized });
    setSending(false);
    if (error) setError(error.message);
    else {
      setBody("");
      comments.refresh();
    }
  }

  return (
    <section className="detail-section collaboration-section">
      <h2>Комментарии</h2>
      {comments.error && <Notice bad>{comments.error}</Notice>}
      {!comments.data ? (
        !comments.error && <Loading />
      ) : comments.data.length === 0 ? (
        <p className="muted">Пока нет комментариев.</p>
      ) : (
        <ol className="comment-list">
          {comments.data.map((comment) => (
            <li key={comment.id}>
              <div className="comment-meta">
                <strong>
                  {comment.author_id === profile?.id
                    ? profile.display_name
                    : (names.get(comment.author_id) ?? "Участник")}
                </strong>
                <time>{formatTime(comment.created_at)}</time>
              </div>
              <p>{comment.body}</p>
            </li>
          ))}
        </ol>
      )}
      {error && <Notice bad>{error}</Notice>}
      <form className="comment-form" onSubmit={(event) => void submit(event)}>
        <label className="visually-hidden" htmlFor="task-comment">
          Новый комментарий
        </label>
        <textarea
          id="task-comment"
          rows={3}
          maxLength={4000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Напишите комментарий…"
        />
        <button className="button secondary" disabled={sending || !body.trim()}>
          {sending ? "Отправляем…" : "Отправить"}
        </button>
      </form>
    </section>
  );
}

type Attachment = {
  name: string;
  id?: string | null;
  metadata?: { size?: number; mimetype?: string } | null;
};
function Attachments({
  task,
  canUpload,
  uploading: busy,
  setUploading: setBusy,
}: {
  task: Task;
  canUpload: boolean;
  uploading: boolean;
  setUploading: (uploading: boolean) => void;
}) {
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    url: string;
    type: string;
    name: string;
  } | null>(null);
  const bucket = getSupabase().storage.from("task-attachments");

  async function refresh(preserveError = false) {
    if (!preserveError) setError("");
    setLoading(true);
    const { data, error } = await bucket.list(task.id, {
      limit: 100,
      sortBy: { column: "created_at", order: "asc" },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setFiles(data ?? []);
  }
  useEffect(() => {
    void refresh();
  }, [task.id]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length) return;
    setBusy(true);
    setError("");
    const failures: string[] = [];
    try {
      for (const file of selected) {
        const type = file.type || "application/octet-stream";
        if (file.size > maxFileSize) {
          failures.push(`${file.name}: больше 20 МБ`);
          continue;
        }
        if (!allowedTypes.has(type)) {
          failures.push(`${file.name}: неподдерживаемый формат`);
          continue;
        }
        const encodedName = encodeFileName(file.name);
        if (!encodedName || encodedName.length > 700) {
          failures.push(`${file.name}: имя слишком длинное`);
          continue;
        }
        const path = `${task.id}/${crypto.randomUUID()}_b64-${encodedName}`;
        const { error } = await bucket.upload(path, file, {
          cacheControl: "0",
          upsert: false,
          contentType: type,
        });
        if (error) failures.push(`${file.name}: ${error.message}`);
      }
      await refresh(true);
      if (failures.length) setError(failures.join(" · "));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить файлы.",
      );
      await refresh(true);
    } finally {
      setBusy(false);
    }
  }

  async function downloadFile(file: Attachment) {
    const path = `${task.id}/${file.name}`;
    const { data, error } = await bucket.download(
      path,
      {},
      { cache: "no-store" },
    );
    if (error) {
      setError(error.message);
      return;
    }
    const name = decodeName(file.name);
    const url = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function previewFile(file: Attachment) {
    const { data, error } = await bucket.download(
      `${task.id}/${file.name}`,
      {},
      { cache: "no-store" },
    );
    if (error) {
      setError(error.message);
      return;
    }
    const type =
      data.type || file.metadata?.mimetype || "application/octet-stream";
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type))
      return;
    const url = URL.createObjectURL(data);
    setPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return { url, type, name: decodeName(file.name) };
    });
  }

  return (
    <section className="detail-section collaboration-section">
      <div className="collaboration-title">
        <h2>Файлы и фото</h2>
        {canUpload && (
          <label className="button secondary upload-button">
            ＋ Добавить
            <input
              type="file"
              multiple
              disabled={busy}
              onChange={(event) => void handleFiles(event)}
            />
          </label>
        )}
      </div>
      <p className="muted attachment-hint">
        Фото и документы по задаче, до 20 МБ каждый.
      </p>
      {error && <Notice bad>{error}</Notice>}
      {loading ? (
        <Loading />
      ) : !files?.length ? (
        <p className="muted">Файлов пока нет.</p>
      ) : (
        <ul className="attachment-list">
          {files.map((file) => (
            <li key={file.name}>
              <span className="attachment-icon" aria-hidden="true">
                {isImageFile(file.metadata?.mimetype) ? "▧" : "↧"}
              </span>
              <span className="attachment-info">
                <strong>{decodeName(file.name)}</strong>
                <small>{formatSize(file.metadata?.size)}</small>
              </span>
              {isPreviewable(file.metadata?.mimetype) && (
                <button
                  className="button quiet"
                  disabled={busy}
                  onClick={() => void previewFile(file)}
                >
                  Просмотреть
                </button>
              )}
              <button
                className="button quiet"
                disabled={busy}
                onClick={() => void downloadFile(file)}
              >
                Скачать
              </button>
            </li>
          ))}
        </ul>
      )}
      {busy && <p className="muted">Загружаем файлы…</p>}
      {error && (
        <button className="button quiet" onClick={() => void refresh()}>
          Обновить список
        </button>
      )}
      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)} wide>
          <div className="image-preview">
            <img src={preview.url} alt={preview.name} />
          </div>
          <div className="form-actions">
            <button
              className="button secondary"
              onClick={() => {
                const anchor = document.createElement("a");
                anchor.href = preview.url;
                anchor.download = preview.name;
                anchor.click();
              }}
            >
              Скачать
            </button>
            <button className="button primary" onClick={() => setPreview(null)}>
              Закрыть
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function decodeName(key: string) {
  const encoded = key.slice(key.indexOf("_") + 1);
  if (encoded.startsWith("b64-")) {
    try {
      const binary = atob(
        encoded.slice(4).replace(/-/g, "+").replace(/_/g, "/"),
      );
      return new TextDecoder().decode(
        Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      );
    } catch {
      return "Имя файла";
    }
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}
function encodeFileName(name: string) {
  const bytes = new TextEncoder().encode(name.replace(/[\\/\0]/g, "_"));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function isPreviewable(type?: string | null) {
  return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(
    type ?? "",
  );
}
function isImageFile(type?: string | null) {
  return (
    isPreviewable(type) || ["image/heic", "image/heif"].includes(type ?? "")
  );
}
function formatTime(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function formatSize(size = 0) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} КБ`
    : `${(size / 1024 / 1024).toFixed(1)} МБ`;
}
