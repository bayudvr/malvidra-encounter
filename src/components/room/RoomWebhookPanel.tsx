"use client";

import { useEffect, useState } from "react";

import { Button, Input, Label, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { RoomWebhook, RoomWebhookUpdate } from "@/lib/room/types";

export function RoomWebhookPanel({ room }: { room: RoomStore }) {
  const toast = useToast();
  const roomId = room.room?.id;
  const [row, setRow] = useState<RoomWebhook | null>(null);
  const [url, setUrl] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    let active = true;
    room.supabase
      .from("room_webhooks")
      .select("*")
      .eq("room_id", roomId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setRow(data);
        setUrl(data?.discord_webhook_url ?? "");
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [roomId, room.supabase]);

  async function createWebhook() {
    const trimmed = url.trim();
    if (!trimmed || !roomId) return;
    const { data, error } = await room.supabase
      .from("room_webhooks")
      .insert({ room_id: roomId, discord_webhook_url: trimmed })
      .select("*")
      .single();
    if (error) toast.error(error.message);
    else setRow(data);
  }

  async function update(patch: RoomWebhookUpdate) {
    if (!row) return;
    const { data, error } = await room.supabase
      .from("room_webhooks")
      .update(patch)
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) toast.error(error.message);
    else setRow(data);
  }

  async function removeWebhook() {
    if (!row) return;
    const { error } = await room.supabase
      .from("room_webhooks")
      .delete()
      .eq("id", row.id);
    if (error) toast.error(error.message);
    else {
      setRow(null);
      setUrl("");
    }
  }

  async function sendTest() {
    if (!roomId) return;
    const { error } = await room.supabase.rpc("send_test_discord_webhook", {
      p_room: roomId,
    });
    if (error) toast.error(error.message);
    else toast.success("Test message sent to Discord");
  }

  if (!loaded) return null;

  return (
    <Panel title="Discord webhook">
      <div className="space-y-3">
        <div>
          <Label htmlFor="webhookUrl">Webhook URL</Label>
          <div className="flex gap-1">
            <Input
              id="webhookUrl"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
            />
            <Button
              size="sm"
              disabled={!url.trim()}
              onClick={() =>
                row
                  ? update({ discord_webhook_url: url.trim() })
                  : createWebhook()
              }
            >
              Save
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">
            Only you (the DM) can see or edit this — players never receive it.
          </p>
        </div>

        {row && (
          <>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={row.notify_combat}
                onChange={(e) => update({ notify_combat: e.target.checked })}
              />
              Combat (start/end, turns, downed)
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={row.notify_dice}
                onChange={(e) => update({ notify_dice: e.target.checked })}
              />
              Dice rolls
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={row.notify_scene}
                onChange={(e) => update({ notify_scene: e.target.checked })}
              />
              Scene / map changes
            </label>

            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="ghost" onClick={sendTest}>
                Send test
              </Button>
              <Button size="sm" variant="danger" onClick={removeWebhook}>
                Remove
              </Button>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
