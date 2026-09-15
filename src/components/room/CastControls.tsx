"use client";

import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/toast";

const BTN =
  "hidden rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 sm:inline";

/**
 * DM-only casting controls in the room header.
 *
 *  - "Cast" opens the player-safe projector view in a second browser window
 *    (drag it onto a projector / external display).
 *  - "Cast to TV" uses the Presentation API to launch the public
 *    `/cast/<token>` view directly on a Chromecast / smart display. That URL
 *    needs no login — the token authorises read-only access via RLS
 *    (migration 0014) — because the receiver device loads it itself.
 */
export function CastControls({
  roomId,
  castToken,
}: {
  roomId: string;
  castToken: string | undefined;
}) {
  const toast = useToast();
  const [canPresent, setCanPresent] = useState(false);
  const [casting, setCasting] = useState(false);
  const connRef = useRef<PresentationConnection | null>(null);

  useEffect(() => {
    setCanPresent(
      typeof window !== "undefined" && typeof window.PresentationRequest === "function",
    );
    return () => connRef.current?.terminate();
  }, []);

  function openWindow() {
    window.open(`/rooms/${roomId}/cast`, "malvidra-cast", "noopener");
  }

  async function castToDevice() {
    if (!castToken) return;
    if (casting) {
      connRef.current?.terminate();
      connRef.current = null;
      setCasting(false);
      return;
    }
    try {
      const req = new window.PresentationRequest!(
        `${window.location.origin}/cast/${castToken}`,
      );
      const conn = await req.start(); // shows the device picker
      connRef.current = conn;
      setCasting(true);
      const done = () => {
        connRef.current = null;
        setCasting(false);
      };
      conn.addEventListener("close", done);
      conn.addEventListener("terminate", done);
    } catch (err) {
      // The user dismissing the device picker rejects with AbortError — ignore.
      if ((err as DOMException)?.name !== "AbortError") {
        toast.error("Couldn't start casting to a device.");
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openWindow}
        title="Open the player-safe view in a second window (for a projector)"
        className={BTN}
      >
        📺 Cast
      </button>
      {canPresent && (
        <button
          type="button"
          onClick={castToDevice}
          title="Send the player-safe view straight to a Chromecast / smart display"
          className={`${BTN} ${casting ? "border-emerald-500/60 text-emerald-300" : ""}`}
        >
          {casting ? "■ Stop casting" : "📡 Cast to TV"}
        </button>
      )}
    </>
  );
}
