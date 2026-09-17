import type { ReactNode } from "react";

// 5etools' `entries` fields use a small recursive markup language: plain strings hold inline
// {@tag ...} references (dice, conditions, spell links, ...), and structured nodes nest further
// entries (lists, named sub-sections, items). This is a "good enough for a quick-reference
// panel" renderer, not a full reimplementation of 5etools' own — tables/images/a few rarer node
// types fall back to just rendering their nested entries (if any) with no special layout.

const TAG_RE = /\{@(\w+)([^}]*)\}/g;

/** Inline {@tag ...} markup -> plain readable text. */
export function stripTags(text: string): string {
  return text.replace(TAG_RE, (_match, tag: string, rest: string) => {
    const args = rest.trim().split("|");
    const first = args[0] ?? "";
    switch (tag) {
      case "h":
        return "Hit: ";
      case "atk":
        // "mw" / "rw" / "mw,rw" -> "Melee Weapon Attack:" etc.
        return (
          first
            .split(",")
            .map((p) => (p === "mw" ? "Melee Weapon Attack" : p === "rw" ? "Ranged Weapon Attack" : p === "ms" ? "Melee Spell Attack" : p === "rs" ? "Ranged Spell Attack" : p))
            .join(" or ") + ":"
        );
      case "hit":
        return `${Number(first) >= 0 ? "+" : ""}${first}`;
      case "dc":
        return `DC ${first}`;
      case "recharge":
        return first ? `Recharge ${first}–6` : "Recharge 6";
      case "chance":
        return `${first}%`;
      default:
        // dice/damage/scaledice/scaledamage/condition/status/skill/sense/item/spell/creature/
        // action/variantrule/book/quickref/filter/... — the first segment is always the
        // human-readable display text for these.
        return first;
    }
  });
}

type EntryNode = string | { [key: string]: unknown } | EntryNode[];

function keyed(node: unknown, prefix: string): ReactNode {
  return <Entries key={prefix} node={node as EntryNode} keyPrefix={prefix} />;
}

/** Recursively renders one `entries` value (string | node object | array of either). */
export function Entries({
  node,
  keyPrefix,
}: {
  node: EntryNode | null | undefined;
  keyPrefix: string;
}) {
  if (node == null) return null;

  if (typeof node === "string") {
    return <p className="mb-2 leading-snug last:mb-0">{stripTags(node)}</p>;
  }

  if (Array.isArray(node)) {
    return (
      <>
        {node.map((child, i) => keyed(child, `${keyPrefix}-${i}`))}
      </>
    );
  }

  const type = node["type"] as string | undefined;
  const entries = node["entries"] as EntryNode | undefined;

  switch (type) {
    case "list": {
      const items = (node["items"] as EntryNode[]) ?? [];
      return (
        <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">
          {items.map((it, i) => (
            <li key={i}>
              {typeof it === "string" ? stripTags(it) : keyed(it, `${keyPrefix}-li-${i}`)}
            </li>
          ))}
        </ul>
      );
    }
    case "entries":
    case "section":
      return (
        <div className="mb-2 last:mb-0">
          {typeof node["name"] === "string" && (
            <div className="font-semibold text-neutral-200">{stripTags(node["name"] as string)}</div>
          )}
          {keyed(entries, `${keyPrefix}-sub`)}
        </div>
      );
    case "item":
    case "itemSub":
      return (
        <p className="mb-1 leading-snug">
          {typeof node["name"] === "string" && (
            <span className="font-semibold">{stripTags(node["name"] as string)}. </span>
          )}
          {typeof node["entry"] === "string"
            ? stripTags(node["entry"] as string)
            : keyed(entries, `${keyPrefix}-item`)}
        </p>
      );
    default:
      // table/image/inset/quote/... — no special layout, just surface any nested entries.
      return entries ? keyed(entries, `${keyPrefix}-fallback`) : null;
  }
}
