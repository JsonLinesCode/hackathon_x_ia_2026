"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import type { Tone } from "@repo/ui";

export function IconBox({
  icon: Icon,
  tone = "neutral",
}: {
  icon: LucideIcon;
  tone?: Tone;
}) {
  return (
    <span className={cn("icon-box", `tone-${tone}`)}>
      <Icon size={16} aria-hidden="true" />
    </span>
  );
}

export function Heading({
  title,
  subtitle,
  children,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close dialog"
          title="Close"
        >
          <X size={18} />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
