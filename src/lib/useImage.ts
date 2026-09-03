"use client";

import { useEffect, useState } from "react";

type Status = "loading" | "loaded" | "failed";

/** Minimal replacement for the `use-image` package. */
export function useImage(url: string | null | undefined) {
  const [image, setImage] = useState<HTMLImageElement | undefined>(undefined);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (!url) {
      setImage(undefined);
      setStatus("failed");
      return;
    }
    setStatus("loading");
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    let cancelled = false;

    img.onload = () => {
      if (cancelled) return;
      setImage(img);
      setStatus("loaded");
    };
    img.onerror = () => {
      if (cancelled) return;
      // Retry once without CORS — still renders, just not exportable.
      const fallback = new window.Image();
      fallback.onload = () => !cancelled && (setImage(fallback), setStatus("loaded"));
      fallback.onerror = () => !cancelled && setStatus("failed");
      fallback.src = url;
    };
    img.src = url;

    return () => {
      cancelled = true;
    };
  }, [url]);

  return [image, status] as const;
}
