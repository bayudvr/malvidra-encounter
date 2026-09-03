"use client";

import { Circle, Group, Rect, Text } from "react-konva";
import type Konva from "konva";

import { useImage } from "@/lib/useImage";
import { colorFromString } from "@/lib/utils";
import type { Combatant, Token } from "@/lib/room/types";

function hpColor(ratio: number) {
  if (ratio > 0.5) return "#4ade80";
  if (ratio > 0.25) return "#fbbf24";
  return "#f87171";
}

export function TokenSprite({
  token,
  gridSize,
  draggable,
  owned,
  selected,
  combatant,
  revealStats,
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
  onDragEnd: (x: number, y: number) => void;
  onSelect: () => void;
}) {
  const [image] = useImage(token.image_url);
  const radius = (token.size * gridSize) / 2;
  const tint = token.color ?? colorFromString(token.label);

  const showStats = !!combatant && !!revealStats;
  const maxHp = combatant?.max_hp ?? 0;
  const hp = combatant?.hp ?? 0;
  const tempHp = combatant?.temp_hp ?? 0;
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : null;

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
      x={token.x}
      y={token.y}
      draggable={draggable}
      opacity={token.is_hidden ? 0.35 : 1}
      onClick={onSelect}
      onTap={onSelect}
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
      <Text
        text={token.label}
        fontSize={12}
        fill="#f5f5f5"
        align="center"
        width={160}
        offsetX={80}
        y={-radius - 16}
        listening={false}
      />

      {showStats && ratio != null && (
        <Group y={radius + 4} listening={false}>
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
          y={radius + (ratio != null ? 13 : 4)}
          listening={false}
        />
      )}
    </Group>
  );
}
