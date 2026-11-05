import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { statusLabel, type Status } from "../lib/database";

export function Notice({
  children,
  bad = false,
}: {
  children: ReactNode;
  bad?: boolean;
}) {
  return (
    <div
      className={bad ? "notice error" : "notice"}
      role={bad ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading" aria-live="polite">
      Загружаем…
    </div>
  );
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`status status-${status}`}>{statusLabel[status]}</span>
  );
}

export function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        ◌
      </span>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
  closeDisabled = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  closeDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide-modal" : "modal"}
      aria-labelledby={headingId}
      onClose={onClose}
      onCancel={(event) => {
        if (closeDisabled) event.preventDefault();
      }}
      onClick={(event) => {
        if (!closeDisabled && event.target === ref.current)
          ref.current?.close();
      }}
    >
      <div className="modal-head">
        <h2 id={headingId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          disabled={closeDisabled}
          onClick={() => ref.current?.close()}
          aria-label="Закрыть"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function confirm() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} closeDisabled={busy}>
      <p className="confirm-copy">{description}</p>
      {error && <Notice bad>{error}</Notice>}
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onClose}
        >
          Отмена
        </button>
        <button
          type="button"
          className="button destructive"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy ? "Удаляем…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string") return message;
  }
  return String(error || "Что-то пошло не так.");
}
