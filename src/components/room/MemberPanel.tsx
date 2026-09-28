"use client";

import { useState } from "react";

import { Badge, Button, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";

export function MemberPanel({
  room,
  roomName,
}: {
  room: RoomStore;
  roomName: string;
}) {
  const toast = useToast();
  const isDM = room.role === "dm";
  const [copied, setCopied] = useState(false);
  const code = room.room?.invite_code;

  const inviteLink =
    typeof window !== "undefined" && code
      ? `${window.location.origin}/join/${code}`
      : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  }

  const [editingName, setEditingName] = useState<string | null>(null);

  // Works the same for account and guest players — both have a profiles row,
  // and profiles_update (0001) lets anyone rename only themselves.
  async function saveName() {
    const name = editingName?.trim();
    setEditingName(null);
    const current = room.members.find((m) => m.user_id === room.userId)?.display_name;
    if (!name || name === current || !room.userId) return;
    const { error } = await room.supabase
      .from("profiles")
      .update({ display_name: name })
      .eq("id", room.userId);
    if (error) return toast.error(error.message);
    await room.reload();
    room.notifyMembersChanged();
  }

  async function kick(memberId: string) {
    if (!confirm("Remove this player from the room?")) return;
    const { error } = await room.supabase
      .from("room_members")
      .delete()
      .eq("id", memberId);
    if (error) toast.error(error.message);
    room.reload();
  }

  return (
    <Panel title={`Party · ${roomName}`}>
      {isDM && code && (
        <div className="mb-3 rounded border border-neutral-800 bg-neutral-950 p-2">
          <p className="text-[10px] uppercase tracking-wide text-neutral-500">
            Invite code
          </p>
          <p className="font-mono text-sm text-amber-300">{code}</p>
          <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={copy}>
            {copied ? "Copied!" : "Copy invite link"}
          </Button>
        </div>
      )}

      <ul className="space-y-1">
        {room.members.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between rounded px-2 py-1 text-sm"
          >
            {m.user_id === room.userId && editingName !== null ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveName();
                }}
                className="mr-2 min-w-0 flex-1"
              >
                <input
                  autoFocus
                  value={editingName}
                  maxLength={40}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => void saveName()}
                  onKeyDown={(e) => e.key === "Escape" && setEditingName(null)}
                  className="w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-sm focus:outline-none"
                />
              </form>
            ) : (
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate">{m.display_name}</span>
                {m.user_id === room.userId && (
                  <>
                    <span className="shrink-0 text-neutral-500">(you)</span>
                    <button
                      type="button"
                      onClick={() => setEditingName(m.display_name)}
                      className="shrink-0 px-1 text-neutral-500 hover:text-neutral-200"
                      aria-label="Edit your name"
                      title="Edit your name"
                    >
                      ✎
                    </button>
                  </>
                )}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Badge
                className={
                  m.role === "dm"
                    ? "bg-amber-500/15 text-amber-300"
                    : "bg-sky-500/15 text-sky-300"
                }
              >
                {m.role}
              </Badge>
              {isDM && m.role === "player" && (
                <button
                  className="px-1 text-neutral-500 hover:text-red-400"
                  onClick={() => kick(m.id)}
                  aria-label="Remove player"
                >
                  ✕
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
