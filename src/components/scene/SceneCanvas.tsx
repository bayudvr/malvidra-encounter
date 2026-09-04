"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from "react-konva";
import type Konva from "konva";

import { useImage } from "@/lib/useImage";
import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { Combatant, Scene, TokenUpdate } from "@/lib/room/types";
import { TokenSprite } from "@/components/scene/TokenSprite";

const MIN_SCALE = 0.15;
const MAX_SCALE = 4;

// D&D 5e size categories -> grid-square footprint. Small and Medium are
// mechanically identical (1 square) per the rules — that's not a bug here.
const DND_SIZES = [
  { label: "Tiny", value: 0.5 },
  { label: "Small", value: 1 },
  { label: "Medium", value: 1 },
  { label: "Large", value: 2 },
  { label: "Huge", value: 3 },
  { label: "Gargantuan", value: 4 },
];

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
  const [ruler, setRuler] = useState<{
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [measureMenu, setMeasureMenu] = useState(false);
  const measureDrawing = useRef(false);
  const lastPinch = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  const didPinch = useRef(false);

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

  // Distance in feet — D&D "every square counts the same" (Chebyshev) metric.
  const feetBetween = useCallback(
    (ax: number, ay: number, bx: number, by: number) => {
      const squares =
        Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / scene.grid_size;
      return Math.round(squares * scene.feet_per_square);
    },
    [scene.grid_size, scene.feet_per_square],
  );
  const rulerFeet = ruler
    ? feetBetween(ruler.startX, ruler.startY, ruler.x, ruler.y)
    : 0;

  const worldPointer = (e: Konva.KonvaEventObject<unknown>) =>
    e.target.getStage()?.getRelativePointerPosition() ?? null;

  function exitMeasure() {
    setMeasuring(false);
    setMeasureMenu(false);
    measureDrawing.current = false;
    setRuler(null);
  }

  // Pinch-to-zoom (two-finger) on touch devices.
  function pinchMove(e: Konva.KonvaEventObject<TouchEvent>) {
    const t1 = e.evt.touches[0];
    const t2 = e.evt.touches[1];
    if (!t1 || !t2) return;
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    if (stage.isDragging()) stage.stopDrag();

    const rect = stage.container().getBoundingClientRect();
    const x1 = t1.clientX - rect.left;
    const y1 = t1.clientY - rect.top;
    const x2 = t2.clientX - rect.left;
    const y2 = t2.clientY - rect.top;
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;

    const prev = lastPinch.current;
    lastPinch.current = { dist, cx, cy };
    if (!prev) return;
    didPinch.current = true;

    setView((v) => {
      let scale = (v.scale * dist) / prev.dist;
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
      const worldX = (cx - v.x) / v.scale;
      const worldY = (cy - v.y) / v.scale;
      return {
        scale,
        x: cx - worldX * scale + (cx - prev.cx),
        y: cy - worldY * scale + (cy - prev.cy),
      };
    });
  }

  function stagePointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if ("touches" in e.evt && e.evt.touches.length > 1) {
      lastPinch.current = null;
      return;
    }
    if (measuring) {
      e.evt.preventDefault();
      const p = worldPointer(e);
      if (!p) return;
      measureDrawing.current = true;
      setRuler({ startX: p.x, startY: p.y, x: p.x, y: p.y });
      return;
    }
    if (e.target === e.target.getStage()) setSelectedId(null);
  }

  function stagePointerMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if ("touches" in e.evt && e.evt.touches.length > 1) {
      pinchMove(e as Konva.KonvaEventObject<TouchEvent>);
      return;
    }
    if (!measuring || !measureDrawing.current) return;
    const p = worldPointer(e);
    if (p) setRuler((r) => (r ? { ...r, x: p.x, y: p.y } : r));
  }

  function stagePointerUp() {
    // The ruler only lives during the interaction — clear it on release.
    measureDrawing.current = false;
    lastPinch.current = null;
    setRuler(null);
  }

  // Zoom around the centre of the viewport (used by the on-screen buttons).
  function zoomBy(factor: number) {
    setView((v) => {
      let scale = v.scale * factor;
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
      const cx = size.w / 2;
      const cy = size.h / 2;
      const worldX = (cx - v.x) / v.scale;
      const worldY = (cy - v.y) / v.scale;
      return { scale, x: cx - worldX * scale, y: cy - worldY * scale };
    });
  }

  async function moveToken(id: string, rawX: number, rawY: number) {
    let x = rawX;
    let y = rawY;
    if (scene.snap_to_grid) {
      const g = scene.grid_size;
      const size = room.tokens.find((t) => t.id === id)?.size ?? 1;
      const half = (size * g) / 2;
      // Snap the token's footprint (not its center point) to the grid, so
      // it sits centered inside its cell(s) with grid lines forming a clean
      // border around it, instead of a line cutting through its middle.
      x = Math.round((rawX - half) / g) * g + half;
      y = Math.round((rawY - half) / g) * g + half;
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
        draggable={!measuring}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        onWheel={handleWheel}
        onDragEnd={(e) => {
          // A pinch stops the drag mid-flight — don't clobber the pinched view.
          if (didPinch.current) {
            didPinch.current = false;
            return;
          }
          // Only the stage itself, not a token bubbling up
          if (e.target === e.target.getStage()) {
            setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
          }
        }}
        onMouseDown={stagePointerDown}
        onMouseMove={stagePointerMove}
        onMouseUp={stagePointerUp}
        onTouchStart={stagePointerDown}
        onTouchMove={stagePointerMove}
        onTouchEnd={stagePointerUp}
        style={measuring ? { cursor: "crosshair" } : undefined}
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
            <Line
              key={i}
              points={pts}
              stroke={scene.grid_color}
              strokeWidth={scene.grid_thickness}
              opacity={scene.grid_opacity}
            />
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
                  draggable={(isDM || owned) && !measuring}
                  owned={owned}
                  selected={t.id === selectedId}
                  combatant={combatant}
                  revealStats={isDM || !!combatant?.is_player}
                  onSelect={() => isDM && setSelectedId(t.id)}
                  onDragStart={() =>
                    setRuler({ startX: t.x, startY: t.y, x: t.x, y: t.y })
                  }
                  onDragMove={(x, y) =>
                    setRuler((r) => (r ? { ...r, x, y } : r))
                  }
                  onDragEnd={(x, y) => {
                    setRuler(null);
                    moveToken(t.id, x, y);
                  }}
                />
              );
            })}
          {/* ping marker at origin for orientation */}
          <Circle x={0} y={0} radius={3} fill="#f59e0b" listening={false} />
        </Layer>

        {ruler && (
          <Layer listening={false}>
            <Line
              points={[ruler.startX, ruler.startY, ruler.x, ruler.y]}
              stroke="#f59e0b"
              strokeWidth={2 / view.scale}
              dash={[10 / view.scale, 6 / view.scale]}
            />
            <Circle
              x={ruler.startX}
              y={ruler.startY}
              radius={4 / view.scale}
              fill="#f59e0b"
            />
            <Group x={ruler.x} y={ruler.y} scaleX={1 / view.scale} scaleY={1 / view.scale}>
              <Rect
                x={14}
                y={-30}
                width={Math.max(46, 12 + String(rulerFeet).length * 11)}
                height={22}
                cornerRadius={4}
                fill="#0a0a0a"
                stroke="#f59e0b"
                strokeWidth={1}
              />
              <Text
                x={14}
                y={-30}
                width={Math.max(46, 12 + String(rulerFeet).length * 11)}
                height={22}
                text={`${rulerFeet} ft`}
                fontSize={13}
                fontStyle="bold"
                fill="#f5f5f5"
                align="center"
                verticalAlign="middle"
              />
            </Group>
          </Layer>
        )}
      </Stage>

      <div className="absolute bottom-2 left-2 flex items-end gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setMeasureMenu((o) => !o)}
            className={`rounded-md border px-2 py-1 text-xs font-medium shadow ${
              measuring
                ? "border-amber-400 bg-amber-400/20 text-amber-200"
                : "border-neutral-700 bg-neutral-900/90 text-neutral-200 hover:bg-neutral-800"
            }`}
          >
            📏 {measuring ? "Measuring…" : "Measure"}
          </button>

          {measureMenu && (
            <div className="absolute bottom-full left-0 mb-1 w-48 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-xs shadow-xl">
              <button
                type="button"
                onClick={() => {
                  exitMeasure();
                  toast.info("Drag a token — the ruler shows its move in ft");
                }}
                className="block w-full px-3 py-2 text-left text-neutral-200 hover:bg-neutral-800"
              >
                Measure movement
                <span className="block text-[10px] text-neutral-500">
                  while dragging a token
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRuler(null);
                  setMeasuring(true);
                  setMeasureMenu(false);
                }}
                className="block w-full border-t border-neutral-800 px-3 py-2 text-left text-neutral-200 hover:bg-neutral-800"
              >
                Free distance
                <span className="block text-[10px] text-neutral-500">
                  drag a line anywhere on the map
                </span>
              </button>
            </div>
          )}
        </div>

        {measuring && (
          <button
            type="button"
            onClick={exitMeasure}
            className="rounded-md border border-neutral-700 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
          >
            Done
          </button>
        )}

        <div className="flex items-center overflow-hidden rounded-md border border-neutral-700 bg-neutral-900/90 text-neutral-200">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.25)}
            className="px-2 py-1 text-sm hover:bg-neutral-800"
          >
            −
          </button>
          <span className="min-w-[3rem] px-1 text-center text-[10px] text-neutral-400">
            {Math.round(view.scale * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => zoomBy(1.25)}
            className="px-2 py-1 text-sm hover:bg-neutral-800"
          >
            +
          </button>
        </div>
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

      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-500">Size</span>
        <select
          value={token.size}
          onChange={(e) => update({ size: Number(e.target.value) })}
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs"
        >
          {DND_SIZES.map((s) => (
            <option key={s.label} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
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
