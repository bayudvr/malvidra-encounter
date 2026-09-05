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

type Pt = { x: number; y: number };

function cross(o: Pt, a: Pt, b: Pt) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Do segments p1-p2 and p3-p4 cross? (proper-intersection test; touching
// endpoints/collinear overlap are edge cases this ignores — fine for
// "did the token's drag path cross this door" purposes.)
function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt) {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

function closestPointOnSegment(p: Pt, a: Pt, b: Pt) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * abx, y: a.y + t * aby, t };
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
  const [drawingPolygon, setDrawingPolygon] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState<Pt[]>([]);
  const [polyCursor, setPolyCursor] = useState<Pt | null>(null);
  const [addingDoor, setAddingDoor] = useState(false);

  const [aoeMenu, setAoeMenu] = useState(false);
  const [aoeMode, setAoeMode] = useState<
    "cone" | "line" | "cube" | "circle" | null
  >(null);
  const [aoeLineWidthFt, setAoeLineWidthFt] = useState(5);
  const [aoe, setAoe] = useState<{
    originX: number;
    originY: number;
    x: number;
    y: number;
  } | null>(null);
  const aoeDrawing = useRef(false);

  const [mapImage] = useImage(scene.map_url);

  // Reset selection and any in-progress map tool when scene changes
  useEffect(() => {
    setSelectedId(null);
    setDrawingPolygon(false);
    setPolygonPoints([]);
    setAddingDoor(false);
    setAoeMode(null);
    setAoe(null);
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

  // Straight-line (Euclidean) feet, for AOE template sizes — a cone's reach
  // or a circle's radius isn't grid-diagonal token movement, so it doesn't
  // use feetBetween's Chebyshev metric.
  const feetFromPixels = useCallback(
    (pixels: number) =>
      Math.round((pixels / scene.grid_size) * scene.feet_per_square),
    [scene.grid_size, scene.feet_per_square],
  );

  const worldPointer = (e: Konva.KonvaEventObject<unknown>) =>
    e.target.getStage()?.getRelativePointerPosition() ?? null;

  function exitMeasure() {
    setMeasuring(false);
    setMeasureMenu(false);
    measureDrawing.current = false;
    setRuler(null);
  }

  function exitAoe() {
    setAoeMode(null);
    setAoeMenu(false);
    aoeDrawing.current = false;
    setAoe(null);
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
    if (drawingPolygon) {
      e.evt.preventDefault();
      const p = worldPointer(e);
      if (p) addPolygonPoint(p);
      return;
    }
    if (addingDoor) {
      e.evt.preventDefault();
      const p = worldPointer(e);
      if (p) placeDoorNear(p);
      return;
    }
    if (aoeMode) {
      e.evt.preventDefault();
      const p = worldPointer(e);
      if (!p) return;
      aoeDrawing.current = true;
      setAoe({ originX: p.x, originY: p.y, x: p.x, y: p.y });
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
    if (drawingPolygon) {
      const p = worldPointer(e);
      if (p) setPolyCursor(p);
      return;
    }
    if (aoeMode && aoeDrawing.current) {
      const p = worldPointer(e);
      if (p) setAoe((a) => (a ? { ...a, x: p.x, y: p.y } : a));
      return;
    }
    if (!measuring || !measureDrawing.current) return;
    const p = worldPointer(e);
    if (p) setRuler((r) => (r ? { ...r, x: p.x, y: p.y } : r));
  }

  function stagePointerUp() {
    if (aoeMode) {
      // Non-permanent by design — the shape only lives during the drag.
      aoeDrawing.current = false;
      setAoe(null);
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

  // A closed door physically blocks a token from being dragged across it —
  // checked against the straight line from its old to its new position.
  function crossesClosedDoor(a: Pt, b: Pt) {
    return room.fogDoors.some(
      (d) =>
        !d.is_open &&
        segmentsIntersect(a, b, { x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }),
    );
  }

  async function moveToken(id: string, rawX: number, rawY: number) {
    const before = room.tokens.find((t) => t.id === id);
    let x = rawX;
    let y = rawY;
    if (scene.snap_to_grid) {
      const g = scene.grid_size;
      const size = before?.size ?? 1;
      const half = (size * g) / 2;
      // Snap the token's footprint (not its center point) to the grid, so
      // it sits centered inside its cell(s) with grid lines forming a clean
      // border around it, instead of a line cutting through its middle.
      x = Math.round((rawX - half) / g) * g + half;
      y = Math.round((rawY - half) / g) * g + half;
    }
    // Check against the raw (pre-snap) drop point, not the grid-snapped one —
    // snapping can land the token's final resting spot on the far side of a
    // door whose freehand position doesn't line up with a grid intersection,
    // which would let a blocked drag sneak through undetected.
    if (
      before &&
      crossesClosedDoor({ x: before.x, y: before.y }, { x: rawX, y: rawY })
    ) {
      // Snap it back — the visual drag already moved it, so without this
      // patch it'd stay wherever the drag dropped it.
      room.patchTokenLocal(id, { x: before.x, y: before.y });
      toast.error("Blocked by a closed door");
      return;
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

  // Adds a vertex, or — once there are >=3 and the click lands back near the
  // first one — closes and saves the room shape.
  function addPolygonPoint(p: Pt) {
    if (polygonPoints.length >= 3) {
      const first = polygonPoints[0];
      const closeThreshold = 16 / view.scale;
      if (Math.hypot(p.x - first.x, p.y - first.y) <= closeThreshold) {
        void finishPolygon();
        return;
      }
    }
    setPolygonPoints((pts) => [...pts, p]);
  }

  function undoPolygonPoint() {
    setPolygonPoints((pts) => pts.slice(0, -1));
  }

  function cancelPolygon() {
    setDrawingPolygon(false);
    setPolygonPoints([]);
  }

  async function finishPolygon() {
    if (polygonPoints.length < 3) {
      toast.error("Need at least 3 points to close a room");
      return;
    }
    const points: [number, number][] = polygonPoints.map((p) => [p.x, p.y]);
    setPolygonPoints([]);
    setDrawingPolygon(false);
    const { data, error } = await room.supabase
      .from("fog_polygons")
      .insert({ scene_id: scene.id, room_id: scene.room_id, points })
      .select()
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Couldn't add room");
      return;
    }
    room.addFogPolygonLocal(data);
  }

  async function deletePolygon(id: string) {
    room.removeFogPolygonLocal(id);
    const { error } = await room.supabase.from("fog_polygons").delete().eq("id", id);
    if (error) toast.error(error.message);
  }

  // Finds the nearest edge (across every room polygon) to the click and
  // drops a fixed-width door segment centered on that edge there.
  function placeDoorNear(p: Pt) {
    let best: { dist: number; a: Pt; b: Pt } | null = null;
    for (const poly of room.fogPolygons) {
      const pts = poly.points;
      for (let i = 0; i < pts.length; i++) {
        const a = { x: pts[i][0], y: pts[i][1] };
        const b = { x: pts[(i + 1) % pts.length][0], y: pts[(i + 1) % pts.length][1] };
        const c = closestPointOnSegment(p, a, b);
        const dist = Math.hypot(p.x - c.x, p.y - c.y);
        if (!best || dist < best.dist) best = { dist, a, b };
      }
    }
    const threshold = 20 / view.scale;
    if (!best || best.dist > threshold) {
      toast.error("Click closer to a room's edge to place a door");
      return;
    }
    const { a, b } = best;
    const edgeLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dirX = (b.x - a.x) / edgeLen;
    const dirY = (b.y - a.y) / edgeLen;
    const c = closestPointOnSegment(p, a, b);
    const tCenter = Math.hypot(c.x - a.x, c.y - a.y);
    const half = Math.min(edgeLen, scene.grid_size * 0.8) / 2;
    const start = Math.max(0, tCenter - half);
    const end = Math.min(edgeLen, tCenter + half);
    void createDoor({
      x1: a.x + dirX * start,
      y1: a.y + dirY * start,
      x2: a.x + dirX * end,
      y2: a.y + dirY * end,
    });
  }

  async function createDoor(seg: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }) {
    const { data, error } = await room.supabase
      .from("fog_doors")
      .insert({ scene_id: scene.id, room_id: scene.room_id, ...seg })
      .select()
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Couldn't add door");
      return;
    }
    room.addFogDoorLocal(data);
    setAddingDoor(false);
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
        draggable={!measuring && !drawingPolygon && !addingDoor && !aoeMode}
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
          measuring || drawingPolygon || addingDoor || aoeMode
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
                    (isDM || owned) &&
                    !measuring &&
                    !drawingPolygon &&
                    !addingDoor &&
                    !aoeMode
                  }
                  owned={owned}
                  selected={t.id === selectedId}
                  combatant={combatant}
                  revealStats={isDM || !!combatant?.is_player}
                  onSelect={() =>
                    isDM &&
                    !drawingPolygon &&
                    !addingDoor &&
                    !aoeMode &&
                    setSelectedId(t.id)
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
          <Layer>
            {/* Solid fog rect with each revealed room polygon punched out as
                a transparent hole (canvas destination-out compositing) —
                freeform room shapes instead of a blocky per-cell mask. */}
            <Rect
              x={0}
              y={0}
              width={bounds.w}
              height={bounds.h}
              fill={scene.fog_color}
              opacity={isDM ? scene.fog_dm_opacity : 1}
              listening={false}
            />
            {room.fogPolygons.map((p) => (
              <Line
                key={p.id}
                points={p.points.flat()}
                closed
                fill="black"
                globalCompositeOperation="destination-out"
                listening={false}
              />
            ))}
          </Layer>
        )}

        {isDM && scene.fog_enabled && (
          <Layer>
            {room.fogPolygons.map((p) => {
              const cx =
                p.points.reduce((s, pt) => s + pt[0], 0) / p.points.length;
              const cy =
                p.points.reduce((s, pt) => s + pt[1], 0) / p.points.length;
              return (
                <Group key={p.id}>
                  <Line
                    points={p.points.flat()}
                    closed
                    stroke="#38bdf8"
                    strokeWidth={1.5 / view.scale}
                    dash={[6 / view.scale, 4 / view.scale]}
                    listening={false}
                  />
                  <Text
                    text="✕"
                    x={cx - 6}
                    y={cy - 7}
                    fontSize={14 / view.scale}
                    fill="#f87171"
                    onClick={() => void deletePolygon(p.id)}
                    onTap={() => void deletePolygon(p.id)}
                  />
                </Group>
              );
            })}

            {room.fogDoors.map((d) => (
              <Group key={d.id}>
                <Line
                  points={[d.x1, d.y1, d.x2, d.y2]}
                  stroke={d.is_open ? "#4ade80" : "#f87171"}
                  strokeWidth={6 / view.scale}
                  lineCap="round"
                  hitStrokeWidth={16 / view.scale}
                  onClick={() => void toggleDoor(d)}
                  onTap={() => void toggleDoor(d)}
                />
                <Text
                  text="✕"
                  x={(d.x1 + d.x2) / 2 - 6}
                  y={(d.y1 + d.y2) / 2 - 22 / view.scale}
                  fontSize={12 / view.scale}
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

            {drawingPolygon && polygonPoints.length > 0 && (
              <Line
                points={[
                  ...polygonPoints.flatMap((p) => [p.x, p.y]),
                  ...(polyCursor ? [polyCursor.x, polyCursor.y] : []),
                ]}
                stroke="#f59e0b"
                strokeWidth={2 / view.scale}
                dash={[8 / view.scale, 5 / view.scale]}
                listening={false}
              />
            )}
            {drawingPolygon &&
              polygonPoints.map((p, i) => (
                <Circle
                  key={i}
                  x={p.x}
                  y={p.y}
                  radius={4 / view.scale}
                  fill="#f59e0b"
                  listening={false}
                />
              ))}
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

        {aoe && (
          <Layer listening={false}>
            <AoeShape
              mode={aoeMode}
              aoe={aoe}
              lineWidthPx={
                (aoeLineWidthFt / scene.feet_per_square) * scene.grid_size
              }
              feetFromPixels={feetFromPixels}
              viewScale={view.scale}
            />
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
                  cancelPolygon();
                  setAddingDoor(false);
                  exitAoe();
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
                exitAoe();
              }}
              className={`rounded-md border px-2 py-1 text-xs font-medium shadow ${
                drawingPolygon || addingDoor
                  ? "border-amber-400 bg-amber-400/20 text-amber-200"
                  : "border-neutral-700 bg-neutral-900/90 text-neutral-200 hover:bg-neutral-800"
              }`}
            >
              🌫️{" "}
              {drawingPolygon
                ? "Drawing room…"
                : addingDoor
                  ? "Click an edge…"
                  : "Fog"}
            </button>

            {fogMenu && (
              <div className="absolute bottom-full left-0 mb-1 w-48 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-xs shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    setDrawingPolygon(true);
                    setPolygonPoints([]);
                    setAddingDoor(false);
                    setFogMenu(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-neutral-200 hover:bg-neutral-800"
                >
                  Draw room
                  <span className="block text-[10px] text-neutral-500">
                    click points, click the first one to close
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingDoor(true);
                    cancelPolygon();
                    setFogMenu(false);
                  }}
                  className="block w-full border-t border-neutral-800 px-3 py-2 text-left text-neutral-200 hover:bg-neutral-800"
                >
                  Add door / window
                  <span className="block text-[10px] text-neutral-500">
                    click a room&apos;s edge
                  </span>
                </button>
              </div>
            )}

            {drawingPolygon && polygonPoints.length > 0 && (
              <button
                type="button"
                onClick={undoPolygonPoint}
                className="rounded-md border border-neutral-700 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
              >
                Undo point
              </button>
            )}
            {drawingPolygon && polygonPoints.length >= 3 && (
              <button
                type="button"
                onClick={() => void finishPolygon()}
                className="rounded-md border border-emerald-600 bg-emerald-600/20 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-600/30"
              >
                Finish
              </button>
            )}
            {(drawingPolygon || addingDoor) && (
              <button
                type="button"
                onClick={() => {
                  cancelPolygon();
                  setAddingDoor(false);
                }}
                className="rounded-md border border-neutral-700 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
              >
                {drawingPolygon ? "Cancel" : "Done"}
              </button>
            )}
          </div>
        )}

        <div className="relative flex items-end gap-1">
          <button
            type="button"
            onClick={() => {
              setAoeMenu((o) => !o);
              exitMeasure();
              cancelPolygon();
              setAddingDoor(false);
            }}
            className={`rounded-md border px-2 py-1 text-xs font-medium shadow ${
              aoeMode
                ? "border-amber-400 bg-amber-400/20 text-amber-200"
                : "border-neutral-700 bg-neutral-900/90 text-neutral-200 hover:bg-neutral-800"
            }`}
          >
            📐 {aoeMode ? `${aoeMode[0].toUpperCase()}${aoeMode.slice(1)}…` : "AOE"}
          </button>

          {aoeMenu && (
            <div className="absolute bottom-full left-0 mb-1 w-44 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-xs shadow-xl">
              {(["cone", "line", "cube", "circle"] as const).map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => {
                    setAoeMode(shape);
                    setAoeMenu(false);
                  }}
                  className="block w-full border-t border-neutral-800 px-3 py-2 text-left capitalize text-neutral-200 first:border-t-0 hover:bg-neutral-800"
                >
                  {shape}
                  {shape === "circle" ? " (radius)" : ""}
                </button>
              ))}
            </div>
          )}

          {aoeMode === "line" && (
            <label className="flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-300">
              width
              <input
                type="number"
                min={5}
                step={5}
                value={aoeLineWidthFt}
                onChange={(e) =>
                  setAoeLineWidthFt(Math.max(5, Number(e.target.value) || 5))
                }
                className="w-10 rounded border border-neutral-700 bg-neutral-950 px-1 text-center"
              />
              ft
            </label>
          )}

          {aoeMode && (
            <button
              type="button"
              onClick={exitAoe}
              className="rounded-md border border-neutral-700 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
            >
              Done
            </button>
          )}
        </div>

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

// Renders the live (non-persistent) AOE template preview while dragging —
// disappears on mouse-up, nothing is ever saved to the DB.
function AoeShape({
  mode,
  aoe,
  lineWidthPx,
  feetFromPixels,
  viewScale,
}: {
  mode: "cone" | "line" | "cube" | "circle" | null;
  aoe: { originX: number; originY: number; x: number; y: number };
  lineWidthPx: number;
  feetFromPixels: (pixels: number) => number;
  viewScale: number;
}) {
  if (!mode) return null;

  const dx = aoe.x - aoe.originX;
  const dy = aoe.y - aoe.originY;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return null;

  const stroke = "#c084fc";
  const fill = "rgba(192,132,252,0.28)";

  function label(x: number, y: number, text: string) {
    const w = 10 + text.length * 7;
    return (
      <Group x={x} y={y} scaleX={1 / viewScale} scaleY={1 / viewScale}>
        <Rect
          x={8}
          y={-11}
          width={w}
          height={22}
          cornerRadius={4}
          fill="#0a0a0a"
          stroke={stroke}
          strokeWidth={1}
        />
        <Text
          x={8}
          y={-11}
          width={w}
          height={22}
          text={text}
          fontSize={13}
          fontStyle="bold"
          fill="#f5f5f5"
          align="center"
          verticalAlign="middle"
        />
      </Group>
    );
  }

  if (mode === "circle") {
    return (
      <>
        <Circle
          x={aoe.originX}
          y={aoe.originY}
          radius={dist}
          fill={fill}
          stroke={stroke}
          strokeWidth={2 / viewScale}
        />
        {label(aoe.x, aoe.y, `${feetFromPixels(dist)} ft`)}
      </>
    );
  }

  if (mode === "cube") {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    const x0 = dx >= 0 ? aoe.originX : aoe.originX - side;
    const y0 = dy >= 0 ? aoe.originY : aoe.originY - side;
    return (
      <>
        <Rect
          x={x0}
          y={y0}
          width={side}
          height={side}
          fill={fill}
          stroke={stroke}
          strokeWidth={2 / viewScale}
        />
        {label(aoe.x, aoe.y, `${feetFromPixels(side)} ft`)}
      </>
    );
  }

  const dirX = dx / dist;
  const dirY = dy / dist;

  if (mode === "line") {
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    return (
      <>
        <Group x={aoe.originX} y={aoe.originY} rotation={angle}>
          <Rect
            x={0}
            y={-lineWidthPx / 2}
            width={dist}
            height={lineWidthPx}
            fill={fill}
            stroke={stroke}
            strokeWidth={2 / viewScale}
          />
        </Group>
        {label(aoe.x, aoe.y, `${feetFromPixels(dist)} ft`)}
      </>
    );
  }

  // Cone — D&D 5e RAW: a cone's width at a point along its length equals
  // that point's distance from the origin (a fixed ~53° apex angle).
  const perpX = -dirY;
  const perpY = dirX;
  const halfWidth = dist / 2;
  const p2x = aoe.originX + dirX * dist + perpX * halfWidth;
  const p2y = aoe.originY + dirY * dist + perpY * halfWidth;
  const p3x = aoe.originX + dirX * dist - perpX * halfWidth;
  const p3y = aoe.originY + dirY * dist - perpY * halfWidth;
  return (
    <>
      <Line
        points={[aoe.originX, aoe.originY, p2x, p2y, p3x, p3y]}
        closed
        fill={fill}
        stroke={stroke}
        strokeWidth={2 / viewScale}
      />
      {label(aoe.x, aoe.y, `${feetFromPixels(dist)} ft`)}
    </>
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
