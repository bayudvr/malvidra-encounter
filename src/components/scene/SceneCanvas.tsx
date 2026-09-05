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
import type {
  Combatant,
  FogDoor,
  Scene,
  Token,
  TokenUpdate,
} from "@/lib/room/types";
import { TokenSprite } from "@/components/scene/TokenSprite";

const MIN_SCALE = 0.15;
const MAX_SCALE = 4;

// Splits a trailing " <number>" off a label, e.g. "Goblin 2" -> ("Goblin", 2).
// A label with no trailing number is its own base with an implicit 0.
function splitLabel(label: string): { base: string; num: number } {
  const m = label.match(/^(.*\S)\s+(\d+)$/);
  return m ? { base: m[1], num: parseInt(m[2], 10) } : { base: label, num: 0 };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Next default name for a duplicate: strips any existing " N" suffix off the
// source label, then picks one past the highest " N" already used on a token
// sharing that base name in the scene — so "Goblin" -> "Goblin 1" -> "Goblin 2".
function nextDuplicateLabel(sourceLabel: string, tokens: Token[]): string {
  const { base } = splitLabel(sourceLabel);
  const re = new RegExp(`^${escapeRegExp(base)}(?:\\s+(\\d+))?$`);
  let max = 0;
  for (const t of tokens) {
    const m = t.label.match(re);
    if (!m) continue;
    const n = m[1] ? parseInt(m[1], 10) : 0;
    if (n > max) max = n;
  }
  return `${base} ${max + 1}`;
}

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
  const stageRef = useRef<Konva.Stage>(null);
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

  const [fogMenu, setFogMenu] = useState(false);
  const [fogPaintMode, setFogPaintMode] = useState<"reveal" | "hide" | null>(
    null,
  );
  const [addingDoor, setAddingDoor] = useState(false);
  const [doorDraft, setDoorDraft] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const fogPainting = useRef(false);
  const paintedCells = useRef<Set<string>>(new Set());
  const doorDrawing = useRef(false);
  const doorStart = useRef<{ x: number; y: number } | null>(null);

  const [mapImage] = useImage(scene.map_url);

  // Reset selection and any in-progress map tool when scene changes
  useEffect(() => {
    setSelectedId(null);
    setFogPaintMode(null);
    setAddingDoor(false);
    setDoorDraft(null);
  }, [scene.id]);

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

  function cellAt(p: { x: number; y: number }) {
    const g = scene.grid_size;
    return { cx: Math.floor(p.x / g), cy: Math.floor(p.y / g) };
  }

  function stagePointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if ("touches" in e.evt && e.evt.touches.length > 1) {
      lastPinch.current = null;
      return;
    }
    if (fogPaintMode) {
      e.evt.preventDefault();
      const p = worldPointer(e);
      if (!p) return;
      fogPainting.current = true;
      paintedCells.current = new Set();
      const { cx, cy } = cellAt(p);
      applyFogPaint(cx, cy, fogPaintMode);
      return;
    }
    if (addingDoor) {
      e.evt.preventDefault();
      const p = worldPointer(e);
      if (!p) return;
      doorDrawing.current = true;
      doorStart.current = p;
      setDoorDraft({ x: p.x, y: p.y, w: 0, h: 0 });
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
    if (fogPaintMode && fogPainting.current) {
      const p = worldPointer(e);
      if (p) {
        const { cx, cy } = cellAt(p);
        applyFogPaint(cx, cy, fogPaintMode);
      }
      return;
    }
    if (addingDoor && doorDrawing.current && doorStart.current) {
      const p = worldPointer(e);
      if (p) {
        const sx = doorStart.current.x;
        const sy = doorStart.current.y;
        setDoorDraft({
          x: Math.min(sx, p.x),
          y: Math.min(sy, p.y),
          w: Math.abs(p.x - sx),
          h: Math.abs(p.y - sy),
        });
      }
      return;
    }
    if (!measuring || !measureDrawing.current) return;
    const p = worldPointer(e);
    if (p) setRuler((r) => (r ? { ...r, x: p.x, y: p.y } : r));
  }

  function stagePointerUp() {
    if (fogPaintMode) {
      fogPainting.current = false;
      paintedCells.current = new Set();
      return;
    }
    if (addingDoor) {
      doorDrawing.current = false;
      const d = doorDraft;
      setDoorDraft(null);
      if (d && d.w > 6 && d.h > 6) void createDoor(d);
      setAddingDoor(false);
      return;
    }
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

  // Alt-drag a token to duplicate it: the original stays put, a new token is
  // inserted at the same spot with an auto-numbered label ("Goblin" ->
  // "Goblin 1", next one "Goblin 2", ...), and the drag carries on with the
  // new token under the cursor.
  async function duplicateToken(source: Token) {
    const label = nextDuplicateLabel(source.label, room.tokens);
    const { data, error } = await room.supabase
      .from("tokens")
      .insert({
        scene_id: source.scene_id,
        room_id: source.room_id,
        asset_id: source.asset_id,
        label,
        image_url: source.image_url,
        x: source.x,
        y: source.y,
        size: source.size,
        color: source.color,
        owner_user_id: source.owner_user_id,
        is_hidden: source.is_hidden,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Couldn't duplicate token");
      return;
    }
    room.addTokenLocal(data);
    setSelectedId(data.id);
    setRuler({ startX: data.x, startY: data.y, x: data.x, y: data.y });
    // The new token's Group hasn't mounted yet this tick — grab it once it
    // has so the drag continues onto it without the user releasing/re-pressing.
    requestAnimationFrame(() => {
      stageRef.current?.findOne(`#${data.id}`)?.startDrag();
    });
  }

  function handleTokenDragStart(
    t: Token,
    e: Konva.KonvaEventObject<DragEvent>,
  ) {
    if (isDM && e.evt?.altKey) {
      e.target.stopDrag();
      void duplicateToken(t);
      return;
    }
    setRuler({ startX: t.x, startY: t.y, x: t.x, y: t.y });
  }

  const revealedCells = useMemo(() => {
    const s = new Set<string>();
    for (const c of room.fogCells) s.add(`${c.cell_x},${c.cell_y}`);
    return s;
  }, [room.fogCells]);

  const cellOpenedByDoor = useCallback(
    (cx: number, cy: number) => {
      const g = scene.grid_size;
      const px = cx * g + g / 2;
      const py = cy * g + g / 2;
      return room.fogDoors.some(
        (d) =>
          d.is_open &&
          px >= d.x &&
          px <= d.x + d.width &&
          py >= d.y &&
          py <= d.y + d.height,
      );
    },
    [room.fogDoors, scene.grid_size],
  );

  async function revealCell(cx: number, cy: number) {
    if (revealedCells.has(`${cx},${cy}`)) return;
    // Optimistic add under a client-side id — the later realtime INSERT
    // carries the real row too, but a harmless duplicate coordinate pair
    // doesn't affect the revealed-cells Set used for rendering.
    room.addFogCellLocal({
      id: crypto.randomUUID(),
      scene_id: scene.id,
      room_id: scene.room_id,
      cell_x: cx,
      cell_y: cy,
      created_at: new Date().toISOString(),
    });
    const { error } = await room.supabase
      .from("fog_cells")
      .insert({ scene_id: scene.id, room_id: scene.room_id, cell_x: cx, cell_y: cy });
    if (error) toast.error(error.message);
  }

  async function hideCell(cx: number, cy: number) {
    room.removeFogCellLocal(cx, cy);
    const { error } = await room.supabase
      .from("fog_cells")
      .delete()
      .eq("scene_id", scene.id)
      .eq("cell_x", cx)
      .eq("cell_y", cy);
    if (error) toast.error(error.message);
  }

  function applyFogPaint(cx: number, cy: number, action: "reveal" | "hide") {
    const key = `${cx},${cy}`;
    if (paintedCells.current.has(key)) return;
    paintedCells.current.add(key);
    if (action === "reveal") void revealCell(cx, cy);
    else void hideCell(cx, cy);
  }

  async function createDoor(rect: { x: number; y: number; w: number; h: number }) {
    const { data, error } = await room.supabase
      .from("fog_doors")
      .insert({
        scene_id: scene.id,
        room_id: scene.room_id,
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Couldn't add door");
      return;
    }
    room.addFogDoorLocal(data);
  }

  async function toggleDoor(door: FogDoor) {
    room.patchFogDoorLocal(door.id, { is_open: !door.is_open });
    const { error } = await room.supabase
      .from("fog_doors")
      .update({ is_open: !door.is_open })
      .eq("id", door.id);
    if (error) toast.error(error.message);
  }

  async function deleteDoor(id: string) {
    const { error } = await room.supabase.from("fog_doors").delete().eq("id", id);
    if (error) toast.error(error.message);
    room.reloadScene();
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
        ref={stageRef}
        width={size.w}
        height={size.h}
        draggable={!measuring && !fogPaintMode && !addingDoor}
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
        style={
          measuring || fogPaintMode || addingDoor
            ? { cursor: "crosshair" }
            : undefined
        }
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
                  draggable={
                    (isDM || owned) && !measuring && !fogPaintMode && !addingDoor
                  }
                  owned={owned}
                  selected={t.id === selectedId}
                  combatant={combatant}
                  revealStats={isDM || !!combatant?.is_player}
                  onSelect={() =>
                    isDM && !fogPaintMode && !addingDoor && setSelectedId(t.id)
                  }
                  onDragStart={(e) => handleTokenDragStart(t, e)}
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

        {scene.fog_enabled && (
          <Layer listening={false}>
            {Array.from({ length: Math.ceil(bounds.h / scene.grid_size) }).map(
              (_, cy) =>
                Array.from({
                  length: Math.ceil(bounds.w / scene.grid_size),
                }).map((_, cx) => {
                  if (
                    revealedCells.has(`${cx},${cy}`) ||
                    cellOpenedByDoor(cx, cy)
                  ) {
                    return null;
                  }
                  return (
                    <Rect
                      key={`${cx}-${cy}`}
                      x={cx * scene.grid_size}
                      y={cy * scene.grid_size}
                      width={scene.grid_size}
                      height={scene.grid_size}
                      fill={scene.fog_color}
                      opacity={isDM ? scene.fog_dm_opacity : 1}
                    />
                  );
                }),
            )}
          </Layer>
        )}

        {isDM && scene.fog_enabled && (
          <Layer>
            {room.fogDoors.map((d) => (
              <Group key={d.id} x={d.x} y={d.y}>
                <Rect
                  width={d.width}
                  height={d.height}
                  stroke={d.is_open ? "#4ade80" : "#f87171"}
                  strokeWidth={2 / view.scale}
                  dash={[8 / view.scale, 5 / view.scale]}
                  fill={
                    d.is_open ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)"
                  }
                  onClick={() => void toggleDoor(d)}
                  onTap={() => void toggleDoor(d)}
                />
                <Text
                  text={d.is_open ? "Open" : "Closed"}
                  x={0}
                  y={d.height / 2 - 7}
                  width={d.width}
                  align="center"
                  fontSize={13}
                  fontStyle="bold"
                  fill={d.is_open ? "#4ade80" : "#f87171"}
                  listening={false}
                />
                <Text
                  text="✕"
                  x={d.width - 16}
                  y={2}
                  fontSize={13}
                  fill="#f87171"
                  onClick={(e) => {
                    e.cancelBubble = true;
                    void deleteDoor(d.id);
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true;
                    void deleteDoor(d.id);
                  }}
                />
              </Group>
            ))}
            {doorDraft && (
              <Rect
                x={doorDraft.x}
                y={doorDraft.y}
                width={doorDraft.w}
                height={doorDraft.h}
                stroke="#f59e0b"
                strokeWidth={2 / view.scale}
                dash={[8 / view.scale, 5 / view.scale]}
                listening={false}
              />
            )}
          </Layer>
        )}

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
                  setFogPaintMode(null);
                  setAddingDoor(false);
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

        {isDM && scene.fog_enabled && (
          <div className="relative flex items-end gap-1">
            <button
              type="button"
              onClick={() => {
                setFogMenu((o) => !o);
                exitMeasure();
              }}
              className={`rounded-md border px-2 py-1 text-xs font-medium shadow ${
                fogPaintMode || addingDoor
                  ? "border-amber-400 bg-amber-400/20 text-amber-200"
                  : "border-neutral-700 bg-neutral-900/90 text-neutral-200 hover:bg-neutral-800"
              }`}
            >
              🌫️{" "}
              {fogPaintMode === "reveal"
                ? "Revealing…"
                : fogPaintMode === "hide"
                  ? "Hiding…"
                  : addingDoor
                    ? "Drawing door…"
                    : "Fog"}
            </button>

            {fogMenu && (
              <div className="absolute bottom-full left-0 mb-1 w-48 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-xs shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    setFogPaintMode("reveal");
                    setAddingDoor(false);
                    setFogMenu(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-neutral-200 hover:bg-neutral-800"
                >
                  Reveal cells
                  <span className="block text-[10px] text-neutral-500">
                    click or drag over the map
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFogPaintMode("hide");
                    setAddingDoor(false);
                    setFogMenu(false);
                  }}
                  className="block w-full border-t border-neutral-800 px-3 py-2 text-left text-neutral-200 hover:bg-neutral-800"
                >
                  Hide cells
                  <span className="block text-[10px] text-neutral-500">
                    click or drag to re-cover
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingDoor(true);
                    setFogPaintMode(null);
                    setFogMenu(false);
                  }}
                  className="block w-full border-t border-neutral-800 px-3 py-2 text-left text-neutral-200 hover:bg-neutral-800"
                >
                  Add door / window
                  <span className="block text-[10px] text-neutral-500">
                    drag a rectangle over an opening
                  </span>
                </button>
              </div>
            )}

            {(fogPaintMode || addingDoor) && (
              <button
                type="button"
                onClick={() => {
                  setFogPaintMode(null);
                  setAddingDoor(false);
                  setDoorDraft(null);
                }}
                className="rounded-md border border-neutral-700 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
              >
                Done
              </button>
            )}
          </div>
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
