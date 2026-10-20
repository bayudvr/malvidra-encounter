"use client";

import { useRef, useState } from "react";
import type { RoomStore } from "@/lib/room/useRoomState";
import { houseError } from "@/lib/twist-dread";
import { useTwistDread } from "./TwistDreadProvider";
import { Button, Input, Label, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";

export function TwistDreadPanel({ room }: { room: RoomStore }) {
  const house = useTwistDread();
  const toast = useToast();
  const dm = room.role === "dm";
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const session = house.session;
  const own = house.players.find((p) => p.user_id === room.userId);
  const name = (id: string | null) => room.members.find((m) => m.user_id === id)?.display_name ?? "Former player";

  async function spendResource(kind: "twist" | "dread" | "distribute", target?: string, amount = 1) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      await house.transact({ kind, target, amount });
      toast.success(kind === "distribute" ? "Twist distributed" : `${kind === "twist" ? "Twist" : "Dread"} spent for an external/private roll`);
    } catch (error) { toast.error(houseError(error, "Could not update resources")); }
    finally { lock.current = false; setBusy(false); }
  }

  if (!dm && !session) return null;
  return (
    <Panel title="Twist & Dread" action={dm && <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : session ? "New session" : "Setup"}</Button>}>
      {house.error && <p role="alert" className="mb-2 text-xs text-red-300">{house.error} <button type="button" className="underline" onClick={house.refresh}>Retry</button></p>}
      {house.loading && <p className="text-xs text-neutral-500">Loading…</p>}
      {dm && (editing || !session) && !house.loading && (
        <SessionSetup key={session?.id ?? "first"} room={room} onDone={() => setEditing(false)} />
      )}
      {session && <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-center text-xs">
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-2"><p className="text-neutral-400">DM Dread</p><p className="text-lg font-bold text-red-300">{session.dread}/{session.capacity}</p></div>
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-2"><p className="text-neutral-400">Twist Pool</p><p className="text-lg font-bold text-sky-300">{session.pool}/{session.capacity}</p></div>
        </div>
        <p className="text-[10px] text-neutral-500">Quota {session.quota} × {session.player_count} session players = {session.capacity}. Fixed until a new session starts.</p>
        <ul className="space-y-2">
          {house.players.map((p) => {
            const available = room.members.some((m) => m.user_id === p.user_id);
            const amount = amounts[p.user_id] ?? 1;
            return <li key={p.user_id} className="rounded-lg border border-neutral-800 p-2 text-xs">
              <div className="flex items-center justify-between gap-2"><span className="truncate">{name(p.user_id)}{p.user_id === room.userId ? " (you)" : ""}</span><strong className="shrink-0 text-amber-200">{p.twist}/{session.quota} Twist</strong></div>
              {dm && <div className="mt-2 flex items-center gap-1">
                <input aria-label={`Twist to distribute to ${name(p.user_id)}`} type="number" min={1} max={session.quota} step={1} value={amount}
                  onChange={(e) => setAmounts((prev) => ({ ...prev, [p.user_id]: Number(e.target.value) }))} className="w-12 rounded bg-neutral-800 px-1 py-1" />
                <Button size="sm" variant="secondary" disabled={busy || !!house.error || !available || !Number.isInteger(amount) || amount < 1 || amount > session.pool || p.twist + amount > session.quota}
                  onClick={() => void spendResource("distribute", p.user_id, amount)}>Give from pool</Button>
              </div>}
            </li>;
          })}
        </ul>
        <details className="text-xs text-neutral-400"><summary className="cursor-pointer">External / private roll</summary>
          <p className="my-2 text-[11px]">Use these after a roll outside the shared log. For public dice, use Twist/Dread in the dice history.</p>
          <div className="flex flex-wrap gap-2">
            {own && <Button size="sm" variant="secondary" disabled={busy || !!house.error || own.twist < 1} onClick={() => void spendResource("twist", room.userId)}>Spend 1 Twist</Button>}
            {dm && <Button size="sm" variant="secondary" disabled={busy || !!house.error || session.dread < 1} onClick={() => void spendResource("dread")}>Spend 1 Dread</Button>}
          </div>
          {dm && <p className="mt-2 text-[11px]">Record a player&apos;s external Twist use:</p>}
          {dm && house.players.map((p) => <Button key={p.user_id} size="sm" variant="ghost" disabled={busy || !!house.error || p.twist < 1 || !room.members.some((m) => m.user_id === p.user_id)} onClick={() => void spendResource("twist", p.user_id)}>{name(p.user_id)} · spend 1</Button>)}
        </details>
        {house.events.length > 0 && <details className="text-xs text-neutral-400"><summary className="cursor-pointer">Recent resource activity</summary>
          <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">{house.events.map((e) => <li key={e.id}>
            <span className="text-neutral-200">{e.kind === "setup" ? "Session started" : e.kind === "distribute" ? `${e.amount} Twist → ${name(e.target_user_id)}` : `${name(e.kind === "twist" ? e.target_user_id : e.actor_user_id)} used ${e.kind}`}</span>
            <span className="block text-[10px]">Dread {e.dread_after} · Pool {e.pool_after}{e.twist_after !== null ? ` · Player Twist ${e.twist_after}` : ""}</span>
          </li>)}</ul>
        </details>}
      </div>}
    </Panel>
  );
}

function SessionSetup({ room, onDone }: { room: RoomStore; onDone: () => void }) {
  const house = useTwistDread();
  const toast = useToast();
  const [quota, setQuota] = useState(house.session?.quota ?? 5);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const players = room.members.filter((m) => m.role === "player");
  const selected = players.filter((m) => !excluded.includes(m.user_id));
  const pending = house.rerolls.some((r) => r.status !== "resolved");
  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    if (house.session && !window.confirm("Start a new session and reset all Twist, Dread, and pool balances?")) return;
    lock.current = true; setBusy(true);
    try { await house.setup(quota, selected.map((p) => p.user_id)); onDone(); toast.success("Session resources initialized"); }
    catch (error) { toast.error(houseError(error, "Could not start session")); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form onSubmit={start} className="mb-3 space-y-2 border-b border-neutral-800 pb-3">
    <Label htmlFor="twist-quota">Twist per player this session</Label>
    <Input id="twist-quota" type="number" min={1} max={100} step={1} required value={quota} onChange={(e) => setQuota(Number(e.target.value))} />
    <p className="text-xs text-neutral-400">Players taking part:</p>
    {players.map((p) => <label key={p.user_id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!excluded.includes(p.user_id)} onChange={(e) => setExcluded((prev) => e.target.checked ? prev.filter((id) => id !== p.user_id) : [...prev, p.user_id])} />{p.display_name}</label>)}
    {!players.length && <p className="text-xs text-neutral-500">Invite a player first.</p>}
    <p className="rounded bg-neutral-950 p-2 text-xs text-neutral-300">Each player: {quota}/{quota} Twist<br />DM Dread: {selected.length}/{quota * selected.length}<br />Twist Pool: 0/{quota * selected.length}</p>
    {pending && <p className="text-xs text-amber-200">Resolve pending rerolls in the dice tray before starting a new session. The DM can close one by keeping its original result.</p>}
    <Button size="sm" type="submit" disabled={busy || !!house.error || pending || selected.length === 0 || !Number.isInteger(quota) || quota < 1 || quota > 100}>{busy ? "Starting…" : house.session ? "Start new session" : "Start session"}</Button>
  </form>;
}
