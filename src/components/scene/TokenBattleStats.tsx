"use client";

import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { Combatant, Token } from "@/lib/room/types";

type StatField = "hp" | "max_hp" | "ac" | "temp_hp";

// A snapshot is never fetched silently on scene change. Pulling requires an
// explicit click and a server-side check that the other scene is newer.
function PullLatestState({ room, token }: { room: RoomStore; token: Token }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const asset = room.assets.find((item) => item.id === token.asset_id);
  if (!asset?.carry_state) return null;

  async function pull() {
    const confirmed = window.confirm(
      "Use this token's latest state from another scene? HP, AC, conditions, counters, size, color and vision may change. Position, ownership, visibility and initiative stay the same.",
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const { data, error } = await room.supabase.rpc("pull_latest_token_state", {
        p_token: token.id,
      });
      if (error) {
        toast.error(error.message);
      } else if (data === "updated") {
        toast.success("Latest token state restored from another scene");
        room.reloadScene();
      } else if (data === "up_to_date") {
        toast.info("This token already has the newest state");
      } else if (data === "no_source") {
        toast.info("No matching token found in another scene");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void pull()}
      className="mt-2 min-h-9 w-full rounded-lg border border-amber-700/60 bg-amber-900/15 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-900/30 disabled:opacity-50"
    >
      {busy ? "Pulling state…" : "↻ Pull Latest State"}
    </button>
  );
}

// Editing is performed on blur/Enter, not on every keypress. This also avoids
// clobbering a half-typed value when a Realtime update arrives.
function BattleStatField({
  room, tokenId, field, label, value,
}: {
  room: RoomStore;
  tokenId: string;
  field: StatField;
  label: string;
  value: number | null;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState(value?.toString() ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const skipNextBlur = useRef(false);

  useEffect(() => {
    if (!editing && !saving) setDraft(value?.toString() ?? "");
  }, [value, editing, saving]);

  async function commit() {
    setEditing(false);
    const raw = draft.trim();
    // +5 / -3 is relative to the *visible* stat; plain numbers set it.
    const relative = raw.match(/^([+-])\s*(\d+)$/);
    const next = relative
      ? (value ?? 0) + Number(relative[2]) * (relative[1] === "-" ? -1 : 1)
      : /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(next) || next < 0 || next > 99999) {
      toast.error("Use a whole number from 0 to 99999, or +N / -N");
      setDraft(value?.toString() ?? "");
      return;
    }
    if (next === value) {
      setDraft(next.toString());
      return;
    }
    setSaving(true);
    const { error } = await room.supabase.rpc("set_token_battle_stat", {
      p_token: tokenId,
      p_field: field,
      p_value: next,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      setDraft(value?.toString() ?? "");
    } else {
      setDraft(next.toString());
      room.reloadScene();
    }
  }

  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] text-neutral-400">
      {label}
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={draft}
        disabled={saving}
        onFocus={(e) => { setEditing(true); e.currentTarget.select(); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (skipNextBlur.current) {
            skipNextBlur.current = false;
            setEditing(false);
          } else {
            void commit();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === "Escape") {
            skipNextBlur.current = true;
            setDraft(value?.toString() ?? "");
            e.currentTarget.value = value?.toString() ?? "";
            e.currentTarget.blur();
          }
        }}
        className="min-h-9 w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 text-center text-sm text-neutral-100 disabled:opacity-50"
      />
    </label>
  );
}

export function TokenBattleStats({
  room, token, combatant,
}: {
  room: RoomStore;
  token: Token;
  combatant: Combatant | null;
}) {
  const fields: { field: StatField; label: string; value: number | null }[] = [
    { field: "hp", label: combatant ? "Current HP" : "HP", value: combatant?.hp ?? token.hp },
    ...(combatant ? [
      { field: "max_hp" as const, label: "Max HP", value: combatant.max_hp },
      { field: "temp_hp" as const, label: "Temp HP", value: combatant.temp_hp ?? 0 },
    ] : []),
    { field: "ac", label: "AC", value: combatant?.ac ?? token.ac },
  ];

  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-semibold text-neutral-400">Battle stats</div>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((stat) => (
          <BattleStatField
            key={stat.field}
            room={room}
            tokenId={token.id}
            {...stat}
          />
        ))}
      </div>
      <p className="mt-1 text-[10px] text-neutral-500">
        {combatant ? "Current battle state; saved for future scenes." : "Starting HP and AC for this scene."}
      </p>
      <PullLatestState room={room} token={token} />
    </div>
  );
}
