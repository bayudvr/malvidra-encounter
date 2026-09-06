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

// A door isn't stored with a polygon id on purpose (migration 0012), so
// "which room does this door belong to" is recomputed: a door belongs to a
// polygon when its midpoint sits on one of that polygon's edges. Doors are
// placed exactly on an edge by placeDoorNear, so the tolerance only absorbs
// floating-point drift.
function doorOnPolygon(
  door: { x1: number; y1: number; x2: number; y2: number },
  points: [number, number][],
  tol: number,
) {
  const mid = { x: (door.x1 + door.x2) / 2, y: (door.y1 + door.y2) / 2 };
  for (let i = 0; i < points.length; i++) {
    const a = { x: points[i][0], y: points[i][1] };
    const b = {
      x: points[(i + 1) % points.length][0],
      y: points[(i + 1) % points.length][1],
    };
    const c = closestPointOnSegment(mid, a, b);
    if (Math.hypot(mid.x - c.x, mid.y - c.y) <= tol) return true;
  }
  return false;
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
  // Token selection is a set — one token shows the inspector, several show the
  // bulk-action bar and drag/hide together. DM only.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Shift held: suppresses stage panning so a shift-drag on empty map draws a
  // marquee instead. Reset on blur so it can't get stuck.
  const [shiftHeld, setShiftHeld] = useState(false);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const marqueeDrawing = useRef(false);
  // Set on drag-start when the grabbed token is part of a multi-selection —
  // every selected token then moves by the same delta.
  const multiDragRef = useRef<{
    anchorId: string;
    anchorStart: Pt;
    positions: Map<string, { x: number; y: number; size: number }>;
  } | null>(null);
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
  // Fog/door rows this session created, newest last — Ctrl+Z pops and deletes.
  const fogUndo = useRef<{ kind: "polygon" | "door"; id: string }[]>([]);

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
    setSelectedIds([]);
    setDrawingPolygon(false);
    setPolygonPoints([]);
    setAddingDoor(false);
    setAoeMode(null);
    setAoe(null);
    fogUndo.current = [];
  }, [scene.id]);

  // Ctrl/Cmd-Z: while drawing, drop the last point; otherwise undo the last
  // fog polygon or door this session added.
  useEffect(() => {
    if (!isDM) return;
    function onKey(e: KeyboardEvent) {
      if (e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (drawingPolygon && polygonPoints.length > 0) {
        e.preventDefault();
        undoPolygonPoint();
        return;
      }
      const last = fogUndo.current.pop();
      if (!last) return;
      e.preventDefault();
      if (last.kind === "polygon") void deletePolygon(last.id);
      else void deleteDoor(last.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // deletePolygon/deleteDoor/undoPolygonPoint are recreated each render but
    // don't close over anything stale that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDM, drawingPolygon, polygonPoints.length]);

  // Track the Shift key so a shift-drag on empty map draws a selection
  // marquee rather than panning the stage.
  useEffect(() => {
    if (!isDM) return;
    function onDown(e: KeyboardEvent) {
      if (e.key === "Shift") setShiftHeld(true);
    }
    function onUp(e: KeyboardEvent) {
      if (e.key === "Shift") setShiftHeld(false);
    }
    function onBlur() {
      setShiftHeld(false);
    }
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [isDM]);

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

  // Snaps a point to the nearest cell CENTER (same formula a size-1 token's
  // footprint snaps to) — used by Measure/AOE so they land on the same grid
  // spots a token would. Fog polygons/doors stay freehand on purpose.
  const snapToCell = useCallback(
    (p: Pt): Pt => {
      if (!scene.snap_to_grid) return p;
      const g = scene.grid_size;
      const half = g / 2;
      return {
        x: Math.round((p.x - half) / g) * g + half,
        y: Math.round((p.y - half) / g) * g + half,
      };
    },
    [scene.snap_to_grid, scene.grid_size],
  );

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
      const raw = worldPointer(e);
      if (!raw) return;
      const p = snapToCell(raw);
      aoeDrawing.current = true;
      setAoe({ originX: p.x, originY: p.y, x: p.x, y: p.y });
      return;
    }
    if (measuring) {
      e.evt.preventDefault();
      const raw = worldPointer(e);
      if (!raw) return;
      const p = snapToCell(raw);
      measureDrawing.current = true;
      setRuler({ startX: p.x, startY: p.y, x: p.x, y: p.y });
      return;
    }
    if (e.target === e.target.getStage()) {
      if (isDM && shiftHeld) {
        const p = worldPointer(e);
        if (p) {
          marqueeDrawing.current = true;
          setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }
        return;
      }
      setSelectedIds([]);
    }
  }

  function stagePointerMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if ("touches" in e.evt && e.evt.touches.length > 1) {
      pinchMove(e as Konva.KonvaEventObject<TouchEvent>);
      return;
    }
    if (marqueeDrawing.current) {
      const p = worldPointer(e);
      if (p) setMarquee((m) => (m ? { ...m, x1: p.x, y1: p.y } : m));
      return;
    }
    if (drawingPolygon) {
      const p = worldPointer(e);
      if (p) setPolyCursor(p);
      return;
    }
    if (aoeMode && aoeDrawing.current) {
      const raw = worldPointer(e);
      if (raw) {
        const p = snapToCell(raw);
        setAoe((a) => (a ? { ...a, x: p.x, y: p.y } : a));
      }
      return;
    }
    if (!measuring || !measureDrawing.current) return;
    const raw = worldPointer(e);
    if (raw) {
      const p = snapToCell(raw);
      setRuler((r) => (r ? { ...r, x: p.x, y: p.y } : r));
    }
  }

  function stagePointerUp() {
    if (marqueeDrawing.current) {
      marqueeDrawing.current = false;
      if (marquee) {
        const minX = Math.min(marquee.x0, marquee.x1);
        const maxX = Math.max(marquee.x0, marquee.x1);
        const minY = Math.min(marquee.y0, marquee.y1);
        const maxY = Math.max(marquee.y0, marquee.y1);
        // A drag of any real size selects every token whose center lands in
        // the box; a stray click (near-zero box) leaves the selection alone.
        if (maxX - minX > 3 || maxY - minY > 3) {
          setSelectedIds(
            room.tokens
              .filter(
                (t) =>
                  t.x >= minX && t.x <= maxX && t.y >= minY && t.y <= maxY,
              )
              .map((t) => t.id),
          );
        }
      }
      setMarquee(null);
      return;
    }
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

  // Commit a multi-selection drag: every token captured on drag-start moves by
  // the same (dx, dy), each snapping its own footprint and each checked
  // against closed doors independently.
  async function commitMultiMove(dx: number, dy: number) {
    const origin = multiDragRef.current;
    multiDragRef.current = null;
    if (!origin) return;
    const g = scene.grid_size;
    const updates: { id: string; x: number; y: number }[] = [];
    let blocked = false;
    for (const [id, o] of origin.positions) {
      const rawX = o.x + dx;
      const rawY = o.y + dy;
      if (crossesClosedDoor({ x: o.x, y: o.y }, { x: rawX, y: rawY })) {
        room.patchTokenLocal(id, { x: o.x, y: o.y });
        blocked = true;
        continue;
      }
      let x = rawX;
      let y = rawY;
      if (scene.snap_to_grid) {
        const half = (o.size * g) / 2;
        x = Math.round((rawX - half) / g) * g + half;
        y = Math.round((rawY - half) / g) * g + half;
      }
      room.patchTokenLocal(id, { x, y });
      updates.push({ id, x, y });
    }
    if (blocked) toast.error("Some tokens blocked by a closed door");
    const results = await Promise.all(
      updates.map((u) =>
        room.supabase.from("tokens").update({ x: u.x, y: u.y }).eq("id", u.id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) toast.error(failed.error.message);
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
    setSelectedIds([data.id]);
    setRuler({ startX: data.x, startY: data.y, x: data.x, y: data.y });
    // The new token's Group hasn't mounted yet this tick — grab it once it
    // has so the drag continues onto it without the user releasing/re-pressing.
    requestAnimationFrame(() => {
      stageRef.current?.findOne(`#${data.id}`)?.startDrag();
    });
  }

  // Drop target for a token portrait dragged out of the library panel. The
  // token lands where the cursor is (snapped like any other token) and starts
  // hidden so the DM can place/adjust it before revealing it to players.
  async function handleAssetDrop(e: React.DragEvent) {
    e.preventDefault();
    if (!isDM) return;
    const raw = e.dataTransfer.getData("application/x-mv-asset");
    if (!raw) return;
    let payload: { assetId: string; label: string; imageUrl: string | null };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const world = snapToCell({
      x: (e.clientX - rect.left - view.x) / view.scale,
      y: (e.clientY - rect.top - view.y) / view.scale,
    });
    const { data, error } = await room.supabase
      .from("tokens")
      .insert({
        scene_id: scene.id,
        room_id: room.room!.id,
        asset_id: payload.assetId,
        label: payload.label,
        image_url: payload.imageUrl,
        x: world.x,
        y: world.y,
        is_hidden: true,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Couldn't add token");
      return;
    }
    room.addTokenLocal(data);
    setSelectedIds([data.id]);
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
    if (isDM && selectedIds.length > 1 && selectedIds.includes(t.id)) {
      const positions = new Map<
        string,
        { x: number; y: number; size: number }
      >();
      for (const id of selectedIds) {
        const tk = room.tokens.find((x) => x.id === id);
        if (tk) positions.set(id, { x: tk.x, y: tk.y, size: tk.size ?? 1 });
      }
      multiDragRef.current = {
        anchorId: t.id,
        anchorStart: { x: t.x, y: t.y },
        positions,
      };
    } else {
      multiDragRef.current = null;
      // Dragging a token that wasn't part of the selection makes it the
      // selection (unless Shift is held to extend it).
      if (isDM && !e.evt?.shiftKey && !selectedIds.includes(t.id)) {
        setSelectedIds([t.id]);
      }
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
    fogUndo.current.push({ kind: "polygon", id: data.id });
  }

  async function deletePolygon(id: string) {
    fogUndo.current = fogUndo.current.filter((e) => e.id !== id);
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
    fogUndo.current.push({ kind: "door", id: data.id });
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
    fogUndo.current = fogUndo.current.filter((e) => e.id !== id);
    const { error } = await room.supabase.from("fog_doors").delete().eq("id", id);
    if (error) toast.error(error.message);
    room.reloadScene();
  }

  const selectedToken =
    selectedIds.length === 1
      ? (room.tokens.find((t) => t.id === selectedIds[0]) ?? null)
      : null;
  const selectedTokens = room.tokens.filter((t) => selectedIds.includes(t.id));

  function toggleTokenSelection(id: string, additive: boolean) {
    setSelectedIds((prev) => {
      if (additive) {
        return prev.includes(id)
          ? prev.filter((x) => x !== id)
          : [...prev, id];
      }
      return [id];
    });
  }

  // A hidden room drops its fog once any door on its wall is opened.
  const polygonRevealed = useCallback(
    (points: [number, number][]) => {
      const tol = Math.max(4, scene.grid_size * 0.3);
      return room.fogDoors.some(
        (d) => d.is_open && doorOnPolygon(d, points, tol),
      );
    },
    [room.fogDoors, scene.grid_size],
  );

  const inCombat = scene.mode === "combat";
  const combatantByToken = useMemo(() => {
    const map = new Map<string, Combatant>();
    for (const c of room.combatants) if (c.token_id) map.set(c.token_id, c);
    return map;
  }, [room.combatants]);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden"
      onDragOver={(e) => {
        if (isDM && e.dataTransfer.types.includes("application/x-mv-asset")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={handleAssetDrop}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        draggable={
          !measuring &&
          !drawingPolygon &&
          !addingDoor &&
          !aoeMode &&
          !shiftHeld &&
          !marquee
        }
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
                  selected={selectedIds.includes(t.id)}
                  combatant={combatant}
                  revealStats={isDM || !!combatant?.is_player}
                  onSelect={(e) => {
                    if (
                      !isDM ||
                      drawingPolygon ||
                      addingDoor ||
                      aoeMode
                    )
                      return;
                    const evt = e?.evt as
                      | MouseEvent
                      | TouchEvent
                      | undefined;
                    const additive = !!(
                      evt &&
                      "shiftKey" in evt &&
                      (evt.shiftKey || evt.metaKey || evt.ctrlKey)
                    );
                    toggleTokenSelection(t.id, additive);
                  }}
                  onDragStart={(e) => handleTokenDragStart(t, e)}
                  onDragMove={(x, y) => {
                    setRuler((r) => (r ? { ...r, x, y } : r));
                    const origin = multiDragRef.current;
                    if (origin && origin.anchorId === t.id) {
                      const dx = x - origin.anchorStart.x;
                      const dy = y - origin.anchorStart.y;
                      for (const [id, o] of origin.positions) {
                        if (id === origin.anchorId) continue;
                        room.patchTokenLocal(id, {
                          x: o.x + dx,
                          y: o.y + dy,
                        });
                      }
                    }
                  }}
                  onDragEnd={(x, y) => {
                    setRuler(null);
                    if (
                      multiDragRef.current &&
                      multiDragRef.current.anchorId === t.id
                    ) {
                      const o = multiDragRef.current.anchorStart;
                      void commitMultiMove(x - o.x, y - o.y);
                    } else {
                      void moveToken(t.id, x, y);
                    }
                  }}
                />
              );
            })}
          {/* ping marker at origin for orientation */}
          <Circle x={0} y={0} radius={3} fill="#f59e0b" listening={false} />
        </Layer>

        {scene.fog_enabled && (
          <Layer listening={false}>
            {/* Region fog: the map stays visible, and each "room" polygon
                fills its OWN interior with fog to hide it. A polygon whose
                wall has an open door drops out (revealed). Players see solid
                fog; the DM sees it at fog_dm_opacity. */}
            {room.fogPolygons.map((p) =>
              polygonRevealed(p.points) ? null : (
                <Line
                  key={p.id}
                  points={p.points.flat()}
                  closed
                  fill={scene.fog_color}
                  opacity={isDM ? scene.fog_dm_opacity : 1}
                  listening={false}
                />
              ),
            )}
          </Layer>
        )}

        {isDM && scene.fog_enabled && (
          <Layer>
            {room.fogPolygons.map((p) => {
              const cx =
                p.points.reduce((s, pt) => s + pt[0], 0) / p.points.length;
              const cy =
                p.points.reduce((s, pt) => s + pt[1], 0) / p.points.length;
              const revealed = polygonRevealed(p.points);
              const r = 13 / view.scale;
              return (
                <Group key={p.id}>
                  <Line
                    points={p.points.flat()}
                    closed
                    stroke="#38bdf8"
                    strokeWidth={1.5 / view.scale}
                    dash={[6 / view.scale, 4 / view.scale]}
                    opacity={revealed ? 0.35 : 1}
                    listening={false}
                  />
                  {/* Round hit target so the delete button stays clickable
                      when zoomed out (the old bare ✕ glyph did not). */}
                  <Circle
                    x={cx}
                    y={cy}
                    radius={r}
                    fill="#f87171"
                    stroke="#450a0a"
                    strokeWidth={1 / view.scale}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      void deletePolygon(p.id);
                    }}
                    onTap={(e) => {
                      e.cancelBubble = true;
                      void deletePolygon(p.id);
                    }}
                  />
                  <Text
                    text="✕"
                    x={cx - r}
                    y={cy - r * 0.72}
                    width={r * 2}
                    align="center"
                    fontSize={r * 1.25}
                    fontStyle="bold"
                    fill="#450a0a"
                    listening={false}
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

        {marquee && (
          <Layer listening={false}>
            <Rect
              x={Math.min(marquee.x0, marquee.x1)}
              y={Math.min(marquee.y0, marquee.y1)}
              width={Math.abs(marquee.x1 - marquee.x0)}
              height={Math.abs(marquee.y1 - marquee.y0)}
              fill="rgba(56,189,248,0.12)"
              stroke="#38bdf8"
              strokeWidth={1 / view.scale}
              dash={[4 / view.scale, 3 / view.scale]}
            />
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
                ? "Outlining area…"
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
                  Hide an area
                  <span className="block text-[10px] text-neutral-500">
                    outline it — inside becomes fog. Click the first point to
                    close.
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
                    click a hidden area&apos;s edge — opening it reveals inside
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
          onClose={() => setSelectedIds([])}
        />
      )}

      {isDM && selectedTokens.length > 1 && (
        <MultiTokenBar
          room={room}
          tokens={selectedTokens}
          onClose={() => setSelectedIds([])}
        />
      )}
    </div>
  );
}

// Bulk actions for a multi-token selection — drag-together is handled on the
// canvas; this bar covers hide/reveal, adding everyone to combat, and delete.
function MultiTokenBar({
  room,
  tokens,
  onClose,
}: {
  room: RoomStore;
  tokens: Token[];
  onClose: () => void;
}) {
  const toast = useToast();
  const ids = tokens.map((t) => t.id);
  const inCombat = room.activeScene?.mode === "combat";
  const combatantTokenIds = new Set(
    room.combatants.map((c) => c.token_id).filter(Boolean) as string[],
  );
  const notInCombat = tokens.filter((t) => !combatantTokenIds.has(t.id));

  async function setHidden(is_hidden: boolean) {
    for (const id of ids) room.patchTokenLocal(id, { is_hidden });
    const { error } = await room.supabase
      .from("tokens")
      .update({ is_hidden })
      .in("id", ids);
    if (error) toast.error(error.message);
    else room.reloadScene();
  }

  async function addAllToCombat() {
    if (notInCombat.length === 0) return;
    const base = room.combatants.length;
    const { error } = await room.supabase.from("combatants").insert(
      notInCombat.map((t, i) => ({
        scene_id: t.scene_id,
        room_id: t.room_id,
        name: t.label,
        is_player: !!t.owner_user_id,
        user_id: t.owner_user_id,
        token_id: t.id,
        sort_order: base + i,
      })),
    );
    if (error) toast.error(error.message);
    else room.reloadScene();
  }

  async function removeAll() {
    if (!confirm(`Remove ${ids.length} tokens from this scene?`)) return;
    const { error } = await room.supabase.from("tokens").delete().in("id", ids);
    if (error) toast.error(error.message);
    else room.reloadScene();
    onClose();
  }

  return (
    <div className="absolute right-2 top-2 w-52 rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-sm shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          {ids.length} tokens
        </span>
        <button
          className="text-neutral-500 hover:text-neutral-200"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex gap-1.5">
          <button
            onClick={() => setHidden(true)}
            className="flex-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100 hover:bg-neutral-700"
          >
            Hide
          </button>
          <button
            onClick={() => setHidden(false)}
            className="flex-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100 hover:bg-neutral-700"
          >
            Reveal
          </button>
        </div>

        {inCombat && notInCombat.length > 0 && (
          <button
            onClick={addAllToCombat}
            className="w-full rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500"
          >
            Add {notInCombat.length} to combat
          </button>
        )}

        <button
          onClick={removeAll}
          className="w-full rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500"
        >
          Remove tokens
        </button>
      </div>
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
  const inCombat = room.activeScene?.mode === "combat";
  const existingCombatant = room.combatants.find(
    (c) => c.token_id === token.id,
  );

  async function addToCombat() {
    const { error } = await room.supabase.from("combatants").insert({
      scene_id: token.scene_id,
      room_id: token.room_id,
      name: token.label,
      is_player: !!token.owner_user_id,
      user_id: token.owner_user_id,
      token_id: token.id,
      sort_order: room.combatants.length,
    });
    if (error) toast.error(error.message);
    else room.reloadScene();
  }

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

      {inCombat &&
        (existingCombatant ? (
          <p className="mb-2 text-center text-xs text-neutral-500">
            Already in combat
          </p>
        ) : (
          <button
            onClick={addToCombat}
            className="mb-2 w-full rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500"
          >
            Add to combat
          </button>
        ))}

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
