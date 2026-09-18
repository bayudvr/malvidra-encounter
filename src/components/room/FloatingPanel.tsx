"use client";

import type { ReactNode } from "react";
import { Rnd } from "react-rnd";

// Shared draggable/resizable window for the DM's side panels (Notes, 5e Reference, ...) —
// previously each was a fixed-size dropdown anchored under its toggle button, which didn't let
// the DM move it out of the way or make it bigger to read more at once.
export function FloatingPanel({
  title,
  onClose,
  headerExtra,
  children,
  defaultX = 80,
  defaultY = 72,
  defaultWidth = 380,
  defaultHeight = 420,
}: {
  title: string;
  onClose: () => void;
  headerExtra?: ReactNode;
  children: ReactNode;
  defaultX?: number;
  defaultY?: number;
  defaultWidth?: number;
  defaultHeight?: number;
}) {
  return (
    <Rnd
      default={{ x: defaultX, y: defaultY, width: defaultWidth, height: defaultHeight }}
      minWidth={260}
      minHeight={220}
      bounds="window"
      dragHandleClassName="floating-panel-handle"
      // react-rnd's Resizable hard-codes display:"inline-block" in its own inline style object,
      // which always wins over the "flex" in className below (inline style beats any class,
      // regardless of specificity) — override it back here or children never get flex layout.
      style={{ position: "fixed", display: "flex", flexDirection: "column" }}
      className="z-50 flex flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl"
    >
      <div className="floating-panel-handle flex shrink-0 cursor-move items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          {title}
        </span>
        <div className="flex items-center gap-2">
          {headerExtra}
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
    </Rnd>
  );
}
