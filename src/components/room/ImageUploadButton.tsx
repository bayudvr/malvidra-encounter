"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { imageFileError, IMAGE_TYPES, IMAGE_UPLOAD_HINT } from "@/lib/image-upload";

export function ImageUploadButton({
  roomId,
  onUploaded,
  onBusyChange,
  disabled = false,
}: {
  roomId: string;
  onUploaded: (url: string) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);

  useEffect(() => () => pending.current?.abort(), []);

  async function upload(file: File) {
    if (pending.current) return;
    setError(null);
    setUploaded(false);
    const validationError = imageFileError(file);
    if (validationError) {
      setError(validationError);
      toast.error(validationError);
      return;
    }

    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const form = new FormData();
      form.set("image", file);
      const response = await fetch(`/api/rooms/${roomId}/images`, {
        method: "POST",
        body: form,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]),
      });
      if (response.redirected || response.status === 401) {
        throw new Error("Sign in again to upload an image.");
      }
      if (response.status === 413) {
        throw new Error("Image must be 4 MB or smaller.");
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.url !== "string") {
        throw new Error(result?.error || "Could not upload image. Try again or paste an image URL.");
      }
      if (!controller.signal.aborted) await onUploaded(result.url);
      if (!controller.signal.aborted) setUploaded(true);
    } catch (cause) {
      if (!controller.signal.aborted) {
        const message = cause instanceof Error && cause.name === "TimeoutError"
          ? "Upload timed out. Try again or paste an image URL."
          : cause instanceof TypeError
            ? "Could not reach the upload service. Check your connection and try again."
            : cause instanceof Error ? cause.message : "Could not upload image. Try again.";
        setError(message);
        toast.error(message);
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        onBusyChange?.(false);
      }
      pending.current = null;
    }
  }

  return (
    <div className="space-y-1">
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        aria-label="Choose image to upload to Imgur"
        className="hidden"
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || busy}
        aria-busy={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "Uploading…" : "Upload to Imgur"}
      </Button>
      <p className={`text-[10px] ${uploaded ? "text-emerald-400" : "text-neutral-500"}`} role="status">
        {busy ? "Uploading image. Please wait…" : uploaded ? "Image uploaded." : IMAGE_UPLOAD_HINT}
      </p>
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
