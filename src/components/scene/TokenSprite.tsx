"use client";

import { Circle, Group, Text } from "react-konva";
import type Konva from "konva";

import { useImage } from "@/lib/useImage";
import { colorFromString } from "@/lib/utils";
import type { Token } from "@/lib/room/types";

export function TokenSprite({
  token,
  gridSize,
  draggable,
  owned,
  selected,
  onDragEnd,
  onSelect,
}: {
  token: Token;
  gridSize: number;
  draggable: boolean;
  owned: boolean;
  selected: boolean;
  onDragEnd: (x: number, y: number) => void;
  onSelect: () => void;
}) {
  const [image] = useImage(token.image_url);
  const radius = (token.size * gridSize) / 2;
  const tint = token.color ?? colorFromString(token.label);

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
        y={radius + 3}
        listening={false}
      />
    </Group>
  );
}
