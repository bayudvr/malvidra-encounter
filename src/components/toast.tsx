"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type Toast = { id: number; message: string; kind: "info" | "error" | "success" };

const ToastContext = React.createContext<(t: Omit<Toast, "id">) => void>(
  () => {},
);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const push = React.useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg",
              t.kind === "error" &&
                "border-red-500/40 bg-red-950 text-red-100",
              t.kind === "success" &&
                "border-emerald-500/40 bg-emerald-950 text-emerald-100",
              t.kind === "info" &&
                "border-neutral-700 bg-neutral-900 text-neutral-100",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = React.useContext(ToastContext);
  return {
    info: (message: string) => push({ message, kind: "info" }),
    error: (message: string) => push({ message, kind: "error" }),
    success: (message: string) => push({ message, kind: "success" }),
  };
}
