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
            <span className="truncate">
              {m.display_name}
              {m.user_id === room.userId && (
                <span className="text-neutral-500"> (you)</span>
              )}
            </span>
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
