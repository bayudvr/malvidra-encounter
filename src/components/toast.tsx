"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { ROLL_BANNER_TITLES, type RollVariant } from "@/lib/dice/rollBanner";

type Toast = {
  id: number;
  message: string;
  kind: "info" | "error" | "success" | "roll";
  rollVariant?: RollVariant;
};

const ToastContext = React.createContext<(t: Omit<Toast, "id">) => void>(
  () => {},
);

const CRITICAL = new Set<RollVariant>(["natural20", "natural1"]);

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
        {toasts.filter((t) => t.kind !== "roll").map((t) => (
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
      <div role="status" aria-live="polite" aria-atomic="false"
        className="pointer-events-none fixed inset-0 z-[120] flex flex-col items-center justify-center gap-2 p-4">
        {toasts.filter((t) => t.kind === "roll").slice(-3).map((t) => {
          const variant = t.rollVariant ?? "normal";
          const critical = CRITICAL.has(variant);
          return (
            <div
              key={t.id}
              className={cn(
                "mv-roll-banner relative w-full max-w-[min(90vw,28rem)] overflow-hidden rounded-xl border px-5 py-3 text-center shadow-2xl backdrop-blur",
                variant === "natural20" && "mv-roll-banner--critical border-amber-300/80 bg-amber-950/95 text-amber-50 shadow-amber-500/30",
                variant === "natural1" && "mv-roll-banner--critical border-rose-400/80 bg-rose-950/95 text-rose-50 shadow-rose-600/30",
                !critical && "border-neutral-600/80 bg-neutral-950/95 text-neutral-100",
              )}
            >
              {critical && (
                <div aria-hidden="true" className="mv-roll-banner__spark absolute inset-0 flex items-center justify-between px-3 text-xl opacity-70">
                  <span>{variant === "natural20" ? "✦" : "✕"}</span>
                  <span>{variant === "natural20" ? "✧" : "✕"}</span>
                </div>
              )}
              <div className={cn(
                "relative font-bold tracking-wider",
                critical ? "text-xl sm:text-2xl" : "text-xs uppercase",
                variant === "natural20" && "text-amber-200",
                variant === "natural1" && "text-rose-200",
                variant === "dirty20" && "text-yellow-200",
                variant === "dirty1" && "text-orange-200",
                variant === "high" && "text-emerald-200",
                variant === "normal" && "text-neutral-400",
              )}>
                {ROLL_BANNER_TITLES[variant]}
              </div>
              {critical && (
                <p className="relative mt-0.5 text-xs font-semibold uppercase tracking-[0.18em] opacity-90">
                  {variant === "natural20" ? "Critical Success" : "Critical Fail"}
                </p>
              )}
              <p className="relative mt-1 break-words text-sm font-semibold">{t.message}</p>
            </div>
          );
        })}
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
    roll: (message: string, rollVariant: RollVariant = "normal") =>
      push({ message, kind: "roll", rollVariant }),
  };
}
