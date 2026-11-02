"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { droppedImageError, imageFileError, IMAGE_TYPES, IMAGE_UPLOAD_HINT } from "@/lib/image-upload";

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
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

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

  // Only handle actual files: token-library items have their own draggable
  // payload, and dragging one must never accidentally trigger an image upload.
  function hasFiles(event: DragEvent<HTMLDivElement>) {
    return Array.from(event.dataTransfer.types).includes("Files") || event.dataTransfer.files.length > 0;
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (disabled || busy) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled || busy ? "none" : "copy";
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled || busy || pending.current) return;
    const fileError = droppedImageError(event.dataTransfer.files);
    if (fileError) {
      setError(fileError);
      setUploaded(false);
      toast.error(fileError);
      return;
    }
    void upload(event.dataTransfer.files[0]);
  }

  return (
    <div
      aria-label="Image upload drop zone"
      aria-busy={busy}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`rounded-lg border-2 border-dashed px-3 py-3 text-center transition-colors ${
        disabled ? "border-neutral-800 bg-neutral-900/40 opacity-60" :
        dragging ? "border-amber-400 bg-amber-500/15" :
        "border-neutral-700 bg-neutral-900/40 hover:border-neutral-600"
      }`}
    >
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
      <p className="mb-1 text-xs font-medium text-neutral-200">
        {dragging ? "Release to upload image" : "Drag & drop image here"}
      </p>
      <p className="mb-2 text-[11px] text-neutral-500">or</p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || busy}
        aria-busy={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "Uploading…" : "Choose image"}
      </Button>
      <p className={`mt-2 text-[10px] ${uploaded ? "text-emerald-400" : "text-neutral-500"}`} role="status">
        {busy ? "Uploading to Imgur…" : uploaded ? "Image uploaded." : IMAGE_UPLOAD_HINT}
      </p>
      {error && (
        <p className="mt-1 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
