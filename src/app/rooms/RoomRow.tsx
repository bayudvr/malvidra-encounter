"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui";

export function RoomRow({
  id,
  name,
  role,
  archived,
}: {
  id: string;
  name: string;
  role: "dm" | "player";
  archived: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggleArchive(e: React.MouseEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("rooms")
      .update({ archived_at: archived ? null : new Date().toISOString() })
      .eq("id", id);
    setBusy(false);
    if (!error) router.refresh();
  }

  return (
    <li>
      <Link
        href={`/rooms/${id}`}
        className="flex items-center justify-between gap-2 px-1 py-3 hover:text-amber-300"
      >
        <span className="truncate font-medium">{name}</span>
        <span className="flex shrink-0 items-center gap-2">
          <Badge
            className={
              role === "dm"
                ? "bg-amber-500/15 text-amber-300"
                : "bg-sky-500/15 text-sky-300"
            }
          >
            {role === "dm" ? "DM" : "Player"}
          </Badge>
          {role === "dm" && (
            <button
              type="button"
              onClick={toggleArchive}
              disabled={busy}
              className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
            >
              {archived ? "Unarchive" : "Archive"}
            </button>
          )}
        </span>
      </Link>
    </li>
  );
}
