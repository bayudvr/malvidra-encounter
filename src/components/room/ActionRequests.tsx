"use client";

import { useEffect, useState } from "react";

import type { ActionRequest } from "@/lib/database.types";
import type { RoomStore } from "@/lib/room/useRoomState";
import { useToast } from "@/components/toast";
import { DiceTray } from "@/components/dice/DiceTray";
import { Button, Input, Label } from "@/components/ui";

const fieldClass = "w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100";

// Separate from player_requests (the existing player -> DM attention button).
export function ActionRequests({ room }: { room: RoomStore }) {
  const toast = useToast();
  const isDM = room.role === "dm";
  const roomId = room.room?.id;
  const [rows, setRows] = useState<ActionRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<"action" | "roll">("roll");
  const [prompt, setPrompt] = useState("");
  const [dc, setDc] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rollId, setRollId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!roomId) return;
    let active = true;
    let sequence = 0;
    async function load() {
      const ticket = ++sequence;
      const [pending, history] = await Promise.all([
        room.supabase.from("action_requests").select("*").eq("room_id", roomId!)
          .eq("status", "pending").order("created_at"),
        room.supabase.from("action_requests").select("*").eq("room_id", roomId!)
          .neq("status", "pending").order("resolved_at", { ascending: false }).limit(30),
      ]);
      if (!active || ticket !== sequence) return;
      const failure = pending.error ?? history.error;
      setError(failure ? "Could not load action requests. Try again." : null);
      setLoaded(true);
      if (!failure) setRows([...(pending.data ?? []), ...(history.data ?? [])]);
    }
    const channel = room.supabase.channel(`action-requests:${roomId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "action_requests", filter: `room_id=eq.${roomId}`,
      }, () => { void load(); })
      .subscribe((status) => { if (status === "SUBSCRIBED") void load(); });
    void load();
    // Also recover missed changes when an async player returns to a suspended tab.
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    const timer = setInterval(onFocus, 30000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      void room.supabase.removeChannel(channel);
    };
  }, [roomId, room.supabase, revision]);

  const pending = rows.filter((r) => r.status === "pending");
  const selectedRoll = pending.find((r) => r.id === rollId && r.target_user_id === room.userId) ?? null;
  const players = room.members.filter((m) => m.role === "player");
  const selectedTarget = players.some((m) => m.user_id === target) ? target : players[0]?.user_id ?? "";

  function acceptRow(row: ActionRequest) {
    setRows((prev) => [row, ...prev.filter((r) => r.id !== row.id)]);
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!roomId || busy || !selectedTarget) return;
    setBusy("create");
    try {
      const { data, error } = await room.supabase.rpc("create_action_request", {
        p_room: roomId, p_target: selectedTarget, p_prompt: prompt.trim(), p_kind: kind,
        p_dc: kind === "roll" && dc !== "" ? Number(dc) : null,
      }).single();
      if (error) throw error;
      acceptRow(data);
      setPrompt("");
      toast.success("Request sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send request");
    } finally { setBusy(null); }
  }

  async function resolve(row: ActionRequest, cancel = false) {
    if (busy) return;
    setBusy(row.id);
    try {
      const { data, error } = await room.supabase.rpc(
        cancel ? "cancel_action_request" : "complete_action_request", { p_request: row.id },
      ).single();
      if (error) throw error;
      acceptRow(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update request");
    } finally { setBusy(null); }
  }

  if (room.role === "spectator") return <DiceTray room={room} />;

  return (
    <>
      <DiceTray room={room} request={selectedRoll} onRequestClose={() => setRollId(null)}
        onRequestCompleted={(row) => { acceptRow(row); setRollId((id) => id === row.id ? null : id); }} />
      {!isDM && pending.length > 0 && (
        <button type="button" onClick={() => setOpen(true)}
          className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-200">
          <span className="truncate">📣 DM is waiting: {pending[0].prompt}</span>
          <span className="shrink-0 font-semibold">View ({pending.length})</span>
        </button>
      )}
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
        aria-controls="action-requests-panel"
        className={`fixed bottom-3 right-14 z-[62] min-h-10 rounded-xl border px-3 py-2 text-xs shadow-lg sm:bottom-4 sm:right-20 ${pending.length ? "border-amber-500/50 bg-neutral-900 text-amber-200" : "border-neutral-700 bg-neutral-900 text-neutral-200"}`}>
        📣 Requests{pending.length > 0 ? ` (${pending.length})` : ""}
      </button>
      {open && (
        <section id="action-requests-panel" aria-label="Action requests"
          className="fixed inset-x-2 bottom-16 z-[63] flex max-h-[75dvh] flex-col rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl sm:inset-x-auto sm:bottom-20 sm:right-20 sm:w-96">
          <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
            <h2 className="text-sm font-semibold">Action requests</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close action requests" className="min-h-9 min-w-9 text-neutral-400">✕</button>
          </div>
          <div className="space-y-3 overflow-y-auto p-3">
            {isDM && (
              <form onSubmit={create} className="space-y-2 border-b border-neutral-800 pb-3">
                <Label htmlFor="request-player">Player</Label>
                <select id="request-player" value={selectedTarget} onChange={(e) => setTarget(e.target.value)} required className={fieldClass}>
                  {!players.length && <option value="">No players in this room</option>}
                  {players.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
                </select>
                <Label htmlFor="request-kind">Request</Label>
                <select id="request-kind" value={kind} onChange={(e) => setKind(e.target.value as "roll" | "action")} className={fieldClass}>
                  <option value="roll">d20 roll (check / save)</option><option value="action">Action (no roll)</option>
                </select>
                <Label htmlFor="request-prompt">Instructions</Label>
                <Input id="request-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} required placeholder="Dexterity save against the falling rocks" />
                {kind === "roll" && <>
                  <Label htmlFor="request-dc">DC (optional, visible to the player)</Label>
                  <Input id="request-dc" type="number" min={1} max={99} step={1} value={dc} onChange={(e) => setDc(e.target.value)} placeholder="14" />
                  <p className="text-xs text-neutral-400">Player adds their modifier and chooses normal, advantage, or disadvantage. Results are public.</p>
                </>}
                <Button type="submit" size="sm" disabled={!!busy || !selectedTarget || !prompt.trim() || !loaded || !!error}>
                  {busy === "create" ? "Sending…" : "Send request"}
                </Button>
              </form>
            )}
            {error && <p role="alert" className="text-xs text-red-300">{error} <button type="button" className="underline" onClick={() => setRevision((v) => v + 1)}>Retry</button></p>}
            {!loaded && <p className="text-xs text-neutral-400">Loading requests…</p>}
            {loaded && !error && pending.length === 0 && <p className="text-xs text-neutral-400">No pending requests.</p>}
            <ul className="space-y-2">
              {rows.map((row) => (
                <li key={row.id} className={`rounded-lg border p-3 text-xs ${row.status === "pending" ? "border-amber-500/30 bg-amber-500/5" : "border-neutral-800"}`}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-neutral-400">
                    <span>{room.members.find((m) => m.user_id === row.target_user_id)?.display_name ?? "Player"}</span>
                    <span>{row.status}{row.dc !== null ? ` · DC ${row.dc}` : ""}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-neutral-100">{row.prompt}</p>
                  {row.result_total !== null && <p className="mt-2 font-semibold text-amber-200">
                    {row.result_notation} = {row.result_total}
                    {row.dc !== null ? ` · ${row.result_total >= row.dc ? "Passed" : "Failed"}` : ""}
                  </p>}
                  {row.status === "pending" && <div className="mt-2 flex gap-2">
                    {isDM ? <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => resolve(row, true)}>Cancel request</Button>
                      : row.kind === "roll" ? <Button size="sm" onClick={() => { setRollId(row.id); setOpen(false); }}>Roll d20</Button>
                      : <Button size="sm" disabled={!!busy} onClick={() => resolve(row)}>{busy === row.id ? "Saving…" : "Mark done"}</Button>}
                  </div>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
