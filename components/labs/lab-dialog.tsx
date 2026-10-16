"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./labs.module.css";

export function LabDialog({ title, description, children, onClose, wide = false, busy = false, error }: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return <dialog
    ref={ref}
    className={`${styles.dialog} ${wide ? styles.dialogWide : ""}`}
    aria-labelledby={titleId}
    aria-describedby={description ? descriptionId : undefined}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}
  >
    <div className={styles.dialogInner}>
      <div className={styles.dialogHeader}>
        <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
        <button type="button" className={styles.iconButton} onClick={onClose} disabled={busy} aria-label={`Close ${title}`}><X size={20} /></button>
      </div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {children}
    </div>
  </dialog>;
}
