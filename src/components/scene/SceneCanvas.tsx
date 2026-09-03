"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Image as KonvaImage, Layer, Line, Stage } from "react-konva";
import type Konva from "konva";

import { useImage } from "@/lib/useImage";
import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { Combatant, Scene, TokenUpdate } from "@/lib/room/types";
import { TokenSprite } from "@/components/scene/TokenSprite";

const MIN_SCALE = 0.15;
const MAX_SCALE = 4;

export function SceneCanvas({
  room,
  scene,
}: {
  room: RoomStore;
  scene: Scene;
}) {
  const toast = useToast();
  const isDM = room.role === "dm";
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ scale: 0.6, x: 40, y: 40 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [mapImage] = useImage(scene.map_url);

  // Reset selection when scene changes
  useEffect(() => setSelectedId(null), [scene.id]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const bounds = useMemo(() => {
    if (mapImage) return { w: mapImage.width, h: mapImage.height };
    return { w: scene.grid_size * 30, h: scene.grid_size * 20 };
  }, [mapImage, scene.grid_size]);

  const gridLines = useMemo(() => {
    if (!scene.grid_enabled) return [];
    const g = scene.grid_size;
    const lines: number[][] = [];
    for (let x = 0; x <= bounds.w; x += g) lines.push([x, 0, x, bounds.h]);
    for (let y = 0; y <= bounds.h; y += g) lines.push([0, y, bounds.w, y]);
    return lines;
  }, [scene.grid_enabled, scene.grid_size, bounds]);

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const oldScale = view.scale;
    const mousePoint = {
      x: (pointer.x - view.x) / oldScale,
      y: (pointer.y - view.y) / oldScale,
    };
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = 1.08;
    let newScale = direction > 0 ? oldScale * factor : oldScale / factor;
    newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    setView({
      scale: newScale,
      x: pointer.x - mousePoint.x * newScale,
      y: pointer.y - mousePoint.y * newScale,
    });
  }

  async function moveToken(id: string, rawX: number, rawY: number) {
    let x = rawX;
    let y = rawY;
    if (scene.snap_to_grid) {
      const g = scene.grid_size;
      x = Math.round(rawX / g) * g;
      y = Math.round(rawY / g) * g;
    }
    room.patchTokenLocal(id, { x, y });
    const { error } = await room.supabase
      .from("tokens")
      .update({ x, y })
      .eq("id", id);
    if (error) toast.error(error.message);
  }

  const selectedToken = room.tokens.find((t) => t.id === selectedId) ?? null;

  const inCombat = scene.mode === "combat";
  const combatantByToken = useMemo(() => {
    const map = new Map<string, Combatant>();
    for (const c of room.combatants) if (c.token_id) map.set(c.token_id, c);
    return map;
  }, [room.combatants]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <Stage
        width={size.w}
        height={size.h}
        draggable
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        onWheel={handleWheel}
        onDragEnd={(e) => {
          // Only the stage itself, not a token bubbling up
          if (e.target === e.target.getStage()) {
            setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
          }
        }}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage()) setSelectedId(null);
        }}
      >
        <Layer listening={false}>
          {mapImage && (
            <KonvaImage image={mapImage} width={bounds.w} height={bounds.h} />
          )}
          {!mapImage && (
            <Line
              points={[0, 0, bounds.w, 0, bounds.w, bounds.h, 0, bounds.h, 0, 0]}
              stroke="#1f1f1f"
              closed
              fill="#111"
            />
          )}
          {gridLines.map((pts, i) => (
            <Line key={i} points={pts} stroke="#ffffff18" strokeWidth={1} />
          ))}
        </Layer>

        <Layer>
          {room.tokens
            .filter((t) => isDM || !t.is_hidden)
            .map((t) => {
              const owned = t.owner_user_id === room.userId;
              const combatant = inCombat
                ? (combatantByToken.get(t.id) ?? null)
                : null;
              return (
                <TokenSprite
                  key={t.id}
                  token={t}
                  gridSize={scene.grid_size}
                  draggable={isDM || owned}
                  owned={owned}
                  selected={t.id === selectedId}
                  combatant={combatant}
                  revealStats={isDM || !!combatant?.is_player}
                  onSelect={() => isDM && setSelectedId(t.id)}
                  onDragEnd={(x, y) => moveToken(t.id, x, y)}
                />
              );
            })}
          {/* ping marker at origin for orientation */}
          <Circle x={0} y={0} radius={3} fill="#f59e0b" listening={false} />
        </Layer>
      </Stage>

      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-neutral-900/80 px-2 py-1 text-[10px] text-neutral-400">
        scroll to zoom · drag background to pan · {Math.round(view.scale * 100)}%
      </div>

      {isDM && selectedToken && (
        <TokenInspector
          key={selectedToken.id}
          room={room}
          token={selectedToken}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function TokenInspector({
  room,
  token,
  onClose,
}: {
  room: RoomStore;
  token: RoomStore["tokens"][number];
  onClose: () => void;
}) {
  const toast = useToast();
  const [label, setLabel] = useState(token.label);

  async function update(patch: TokenUpdate) {
    const { error } = await room.supabase
      .from("tokens")
      .update(patch)
      .eq("id", token.id);
    if (error) toast.error(error.message);
    else room.reloadScene();
  }

  const players = room.members.filter((m) => m.role === "player");

  return (
    <div className="absolute right-2 top-2 w-60 rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-sm shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Token
        </span>
        <button className="text-neutral-500 hover:text-neutral-200" onClick={onClose}>
          ✕
        </button>
      </div>

      <label className="mb-1 block text-xs text-neutral-500">Label</label>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label !== token.label && update({ label })}
        className="mb-2 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1"
      />

      <label className="mb-1 block text-xs text-neutral-500">Owner</label>
      <select
        value={token.owner_user_id ?? ""}
        onChange={(e) => update({ owner_user_id: e.target.value || null })}
        className="mb-2 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1"
      >
        <option value="">Unassigned</option>
        {players.map((p) => (
          <option key={p.user_id} value={p.user_id}>
            {p.display_name}
          </option>
        ))}
      </select>

      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-neutral-500">Size</span>
        {[1, 2, 3].map((s) => (
          <button
            key={s}
            onClick={() => update({ size: s })}
            className={`rounded px-2 py-0.5 text-xs ${
              token.size === s
                ? "bg-amber-500 text-neutral-950"
                : "bg-neutral-800"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <label className="mb-2 flex items-center gap-2 text-xs text-neutral-300">
        <input
          type="checkbox"
          checked={token.is_hidden}
          onChange={(e) => update({ is_hidden: e.target.checked })}
        />
        Hidden from players
      </label>

      <button
        onClick={async () => {
          await room.supabase.from("tokens").delete().eq("id", token.id);
          room.reloadScene();
          onClose();
        }}
        className="w-full rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500"
      >
        Remove token
      </button>
    </div>
  );
}
