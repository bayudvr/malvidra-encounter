import * as React from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-amber-500 text-neutral-950 hover:bg-amber-400 disabled:opacity-50",
  secondary:
    "bg-neutral-800 text-neutral-100 hover:bg-neutral-700 disabled:opacity-50",
  ghost:
    "bg-transparent text-neutral-300 hover:bg-neutral-800 disabled:opacity-40",
  danger: "bg-red-600 text-white hover:bg-red-500 disabled:opacity-50",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-amber-500 focus:outline-none",
        className,
      )}
      {...props}
    />
  );
});

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400",
        className,
      )}
      {...props}
    />
  );
}

export function Panel({
  className,
  title,
  action,
  children,
}: {
  className?: string;
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-neutral-800 bg-neutral-900/60",
        className,
      )}
    >
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </span>
  );
}
