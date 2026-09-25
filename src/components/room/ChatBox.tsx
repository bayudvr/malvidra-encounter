"use client";

import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";

// Selecting a token as the speaker makes the message show as a speech bubble
// on the board (SceneCanvas/TokenSprite) in addition to landing here in the
// log. "" (OOC) never triggers a bubble — see chat_messages.token_id.
const OOC_VALUE = "";

export function ChatBox({ room }: { room: RoomStore }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [speakerTokenId, setSpeakerTokenId] = useState(OOC_VALUE);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const isDM = room.role === "dm";
  // Players can only speak as a token they own — mirrors the chat_messages_insert
  // RLS policy (0024), which is the real enforcement; this is just so the picker
  // doesn't even offer an option the server would reject.
  const speakableTokens = room.tokens.filter((t) => isDM || t.owner_user_id === room.userId);

  useEffect(() => {
    // Selected speaker token disappeared (deleted, or scene switched) — fall back to OOC
    // rather than silently keep sending as a token_id that's no longer a valid option.
    if (speakerTokenId && !speakableTokens.some((t) => t.id === speakerTokenId)) {
      setSpeakerTokenId(OOC_VALUE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.activeSceneId, speakableTokens.length]);

  useEffect(() => {
    if (open) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [open, room.chatMessages.length]);

  async function send() {
    const body = draft.trim();
    if (!body || sending || !room.room) return;

    const speakerName = speakerTokenId
      ? (speakableTokens.find((t) => t.id === speakerTokenId)?.label ?? "Someone")
      : (room.members.find((m) => m.user_id === room.userId)?.display_name ?? "Someone");

    setSending(true);
    const { error } = await room.supabase.from("chat_messages").insert({
      room_id: room.room.id,
      user_id: room.userId,
      token_id: speakerTokenId || null,
      speaker_name: speakerName,
      body,
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDraft("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Chat"
        className="fixed bottom-4 left-4 z-[62] flex h-12 w-12 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-xl shadow-lg transition-colors hover:bg-neutral-800"
      >
        💬
      </button>

      {open && (
        <div className="fixed bottom-20 left-4 z-[62] flex max-h-[70vh] w-[18rem] flex-col rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Chat
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-neutral-500 hover:text-neutral-200"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div ref={logRef} className="flex-1 space-y-1.5 overflow-y-auto px-3 py-2 text-sm">
            {room.chatMessages.length === 0 ? (
              <p className="text-xs text-neutral-600">No messages yet.</p>
            ) : (
              room.chatMessages.map((m) => (
                <p key={m.id} className="break-words">
                  <span className="font-semibold text-neutral-300">{m.speaker_name}:</span>{" "}
                  <span className="text-neutral-200">{m.body}</span>
                </p>
              ))
            )}
          </div>

          <div className="space-y-1.5 border-t border-neutral-800 p-2">
            <select
              value={speakerTokenId}
              onChange={(e) => setSpeakerTokenId(e.target.value)}
              aria-label="Speak as"
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs text-neutral-300"
            >
              <option value={OOC_VALUE}>Speak as: OOC</option>
              {speakableTokens.map((t) => (
                <option key={t.id} value={t.id}>
                  Speak as: {t.label}
                </option>
              ))}
            </select>
            <div className="flex gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Say something…"
                maxLength={500}
                className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600"
              />
              <button
                type="button"
                onClick={send}
                disabled={sending || !draft.trim()}
                className="shrink-0 rounded bg-amber-500 px-2.5 py-1 text-sm font-semibold text-neutral-950 disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
