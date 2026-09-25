"use client";

import { useEffect, useRef } from "react";
import { Arc, Circle, Group, Line, Rect, Text } from "react-konva";
import Konva from "konva";

import { useImage } from "@/lib/useImage";
import { colorFromString, tokenInitials } from "@/lib/utils";
import { conditionCode, conditionColor } from "@/lib/conditions";
import type { Combatant, Token } from "@/lib/room/types";

function hpColor(ratio: number) {
  if (ratio > 0.5) return "#4ade80";
  if (ratio > 0.25) return "#fbbf24";
  return "#f87171";
}

// Rough char-width estimate for a 13px sans body font — good enough to size
// the bubble without pulling in real text-metrics measurement.
const BUBBLE_FONT_SIZE = 13;
const BUBBLE_CHAR_WIDTH = BUBBLE_FONT_SIZE * 0.55;
const BUBBLE_MAX_WIDTH = 220;
const BUBBLE_PADDING_X = 10;
const BUBBLE_PADDING_Y = 8;
const BUBBLE_LINE_HEIGHT = 16;

function estimateBubbleLines(text: string): number {
  const charsPerLine = Math.max(1, Math.floor((BUBBLE_MAX_WIDTH - BUBBLE_PADDING_X * 2) / BUBBLE_CHAR_WIDTH));
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

export function TokenSprite({
  token,
  gridSize,
  draggable,
  owned,
  selected,
  combatant,
  revealStats,
  speechText,
  remotePos,
  onDragStart,
  onDragMove,
  onDragEnd,
  onSelect,
}: {
  token: Token;
  gridSize: number;
  draggable: boolean;
  owned: boolean;
  selected: boolean;
  /** Linked combatant during combat, if any. */
  combatant?: Combatant | null;
  /** Whether this viewer may see the combatant's HP / AC numbers. */
  revealStats?: boolean;
  /** Most recent still-active chat message spoken as this token, if any (SceneCanvas decides the expiry window). */
  speechText?: string | null;
  /**
   * Live position while someone else is dragging this token (broadcast, not yet in the DB).
   * The node glides toward it between the throttled updates; `null` glides back to
   * token.x/y, the dragger's final position once the drag ends.
   */
  remotePos?: { x: number; y: number } | null;
  onDragStart?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  /**
   * Called on every drag tick with the node's current (world) position.
   * Returning `{x, y}` snaps the Konva node back to that position this same
   * tick — used to stop a token dead at a wall instead of letting it drag
   * through. Return nothing to accept the position as-is.
   */
  onDragMove?: (x: number, y: number) => { x: number; y: number } | void;
  onDragEnd: (x: number, y: number) => void;
  onSelect: (e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
}) {
  const [image] = useImage(token.image_url);
  const groupRef = useRef<Konva.Group>(null);
  const glideRef = useRef<Konva.Tween | null>(null);
  const gliding = useRef(false);

  // Only runs while a remote drag is (or just was) active — otherwise the Group's x/y props
  // position the node as usual. The null step matters when the drag ends where it started
  // (e.g. blocked by a wall): token.x/y didn't change, so react-konva won't move the node back.
  const targetX = remotePos ? remotePos.x : token.x;
  const targetY = remotePos ? remotePos.y : token.y;
  useEffect(() => {
    const node = groupRef.current;
    if (!node || node.isDragging()) return;
    if (!remotePos && !gliding.current) return;
    gliding.current = !!remotePos;
    glideRef.current?.destroy();
    const tween = new Konva.Tween({ node, x: targetX, y: targetY, duration: 0.1 });
    glideRef.current = tween;
    tween.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remotePos is tracked via targetX/Y
  }, [targetX, targetY, !!remotePos]);
  useEffect(() => () => glideRef.current?.destroy(), []);
  const radius = (token.size * gridSize) / 2;
  const tint = token.color ?? colorFromString(token.label);

  const showStats = !!combatant && !!revealStats;
  const maxHp = combatant?.max_hp ?? 0;
  const hp = combatant?.hp ?? 0;
  const tempHp = combatant?.temp_hp ?? 0;
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : null;

  const conditions = combatant?.conditions ?? [];
  // A downed non-PC (0 HP) reads as grey during combat; PCs are left alone
  // (they might just be unconscious and stabilising).
  const downed =
    !!combatant && !combatant.is_player && combatant.hp != null && combatant.hp <= 0;

  const segGap = conditions.length > 1 ? 6 : 0;
  const segAngle = conditions.length ? 360 / conditions.length - segGap : 0;

  const statText = showStats
    ? [
        combatant?.hp != null
          ? `${hp}${tempHp > 0 ? `+${tempHp}` : ""}${maxHp ? `/${maxHp}` : ""}`
          : null,
        combatant?.ac != null ? `AC ${combatant.ac}` : null,
      ]
        .filter(Boolean)
        .join("   ")
    : "";

  return (
    <Group
      ref={groupRef}
      id={token.id}
      x={token.x}
      y={token.y}
      draggable={draggable}
      opacity={token.is_hidden ? 0.35 : downed ? 0.55 : 1}
      onClick={onSelect}
      onTap={onSelect}
      onDragStart={(e: Konva.KonvaEventObject<DragEvent>) => onDragStart?.(e)}
      onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
        const corrected = onDragMove?.(e.target.x(), e.target.y());
        if (corrected) e.target.position(corrected);
      }}
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
        onDragEnd(e.target.x(), e.target.y());
      }}
    >
      {(owned || selected) && (
        <Circle
          radius={radius + 4}
          stroke={selected ? "#f59e0b" : "#38bdf8"}
          strokeWidth={3}
        />
      )}
      <Circle
        radius={radius}
        fill={image ? undefined : tint}
        fillPatternImage={image}
        fillPatternScaleX={image ? (radius * 2) / image.width : 1}
        fillPatternScaleY={image ? (radius * 2) / image.height : 1}
        fillPatternOffsetX={image ? image.width / 2 : 0}
        fillPatternOffsetY={image ? image.height / 2 : 0}
        stroke="#0a0a0a"
        strokeWidth={2}
      />

      {!image && (
        <Text
          text={tokenInitials(token.label)}
          fontSize={radius * (tokenInitials(token.label).length > 2 ? 0.65 : 0.9)}
          fontStyle="bold"
          fill="#0a0a0a"
          align="center"
          verticalAlign="middle"
          width={radius * 2}
          height={radius * 2}
          offsetX={radius}
          offsetY={radius}
          listening={false}
        />
      )}

      {downed && (
        <>
          <Circle radius={radius} fill="#3f3f46" opacity={0.65} listening={false} />
          <Text
            text="☠"
            fontSize={radius}
            fill="#e5e5e5"
            align="center"
            verticalAlign="middle"
            width={radius * 2}
            height={radius * 2}
            offsetX={radius}
            offsetY={radius}
            listening={false}
          />
        </>
      )}

      {conditions.map((cond, i) => (
        <Arc
          key={`${cond}-${i}`}
          innerRadius={radius + 2}
          outerRadius={radius + 8}
          angle={segAngle}
          rotation={-90 + i * (segAngle + segGap) + segGap / 2}
          fill={conditionColor(cond)}
          listening={false}
        />
      ))}

      {conditions.length > 0 && (
        <Text
          text={conditions.map(conditionCode).join(" ")}
          fontSize={10}
          fontStyle="bold"
          fill="#e5e5e5"
          align="center"
          width={200}
          offsetX={100}
          y={-radius - 30}
          listening={false}
        />
      )}

      {speechText &&
        (() => {
          const lines = estimateBubbleLines(speechText);
          const width = Math.min(
            BUBBLE_MAX_WIDTH,
            Math.max(60, speechText.length * BUBBLE_CHAR_WIDTH + BUBBLE_PADDING_X * 2),
          );
          const height = lines * BUBBLE_LINE_HEIGHT + BUBBLE_PADDING_Y * 2;
          // Sits above the condition-code row when present, otherwise just above the sprite.
          const bottomY = -(radius + (conditions.length > 0 ? 44 : 14));
          const topY = bottomY - height;
          return (
            <Group listening={false}>
              <Rect
                x={-width / 2}
                y={topY}
                width={width}
                height={height}
                cornerRadius={8}
                fill="#18181b"
                stroke="#52525b"
                strokeWidth={1}
              />
              <Text
                x={-width / 2 + BUBBLE_PADDING_X}
                y={topY + BUBBLE_PADDING_Y}
                width={width - BUBBLE_PADDING_X * 2}
                text={speechText}
                fontSize={BUBBLE_FONT_SIZE}
                fill="#f4f4f5"
                align="center"
                wrap="word"
                lineHeight={BUBBLE_LINE_HEIGHT / BUBBLE_FONT_SIZE}
              />
              <Line
                points={[-6, bottomY, 6, bottomY, 0, bottomY + 8]}
                closed
                fill="#18181b"
                stroke="#52525b"
                strokeWidth={1}
              />
            </Group>
          );
        })()}

      {/* Name below the token (not above) so the HP bar/stat line stack
          directly under it, all in one group below the sprite. */}
      <Text
        text={token.label}
        fontSize={12}
        fill="#f5f5f5"
        align="center"
        width={160}
        offsetX={80}
        y={radius + 4}
        listening={false}
      />

      {showStats && ratio != null && (
        <Group y={radius + 20} listening={false}>
          <Rect
            x={-radius}
            width={radius * 2}
            height={6}
            cornerRadius={3}
            fill="#0a0a0a"
            stroke="#000"
            strokeWidth={1}
          />
          <Rect
            x={-radius}
            width={radius * 2 * ratio}
            height={6}
            cornerRadius={3}
            fill={hpColor(ratio)}
          />
        </Group>
      )}

      {showStats && statText && (
        <Text
          text={statText}
          fontSize={11}
          fontStyle="bold"
          fill="#e5e5e5"
          align="center"
          width={200}
          offsetX={100}
          y={radius + 20 + (ratio != null ? 9 : 0)}
          listening={false}
        />
      )}
    </Group>
  );
}
