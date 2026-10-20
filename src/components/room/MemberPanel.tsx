"use client";

import { useRef, useState } from "react";

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
  const [changing, setChanging] = useState(false);
  const roleLock = useRef(false);
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
    if (!confirm("Remove this member from the room?")) return;
    const { error } = await room.supabase
      .from("room_members")
      .delete()
      .eq("id", memberId);
    if (error) toast.error(error.message);
    room.reload();
  }

  async function changeRole(userId: string, nextRole: "player" | "spectator") {
    if (roleLock.current || !room.room) return;
    if (nextRole === "spectator" && !confirm("Make this member a spectator? Their token and session balances are kept, but they cannot play. Current session capacity stays fixed until the next setup.")) return;
    roleLock.current = true;
    setChanging(true);
    try {
      const { error } = await room.supabase.rpc("set_room_member_role", {
        p_room: room.room.id, p_user: userId, p_role: nextRole,
      });
      if (error) throw error;
      await room.reload();
      room.notifyMembersChanged();
      toast.success(nextRole === "player" ? "Member is now a player" : "Member is now watching");
    } catch { toast.error("Could not change member role"); }
    finally { roleLock.current = false; setChanging(false); }
  }

  return (
    <Panel title={`Members · ${roomName}`}>
      <p className="mb-2 text-xs text-neutral-500">{room.members.filter((m) => m.role === "player").length} players · {room.members.filter((m) => m.role === "spectator").length} spectators. New members join as spectators.</p>
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
              {isDM && m.role !== "dm" && (
                <Button size="sm" variant="ghost" disabled={changing}
                  aria-label={`Make ${m.display_name} ${m.role === "player" ? "a spectator" : "a player"}`}
                  onClick={() => void changeRole(m.user_id, m.role === "player" ? "spectator" : "player")}>
                  {m.role === "player" ? "Watch" : "Play"}
                </Button>
              )}
              {isDM && m.role !== "dm" && (
                <button
                  className="px-1 text-neutral-500 hover:text-red-400"
                  onClick={() => kick(m.id)}
                  aria-label={`Remove ${m.display_name}`}
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
