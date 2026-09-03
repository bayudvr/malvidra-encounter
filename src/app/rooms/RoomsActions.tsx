"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button, Input, Label, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import { createClient } from "@/lib/supabase/client";

export function RoomsActions() {
  const router = useRouter();
  const toast = useToast();
  const [roomName, setRoomName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!roomName.trim()) return;
    setBusy(true);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: room, error } = await supabase
        .from("rooms")
        .insert({ name: roomName.trim(), dm_id: user.id })
        .select("id")
        .single();
      if (error) throw error;

      const { error: memberError } = await supabase
        .from("room_members")
        .insert({ room_id: room.id, user_id: user.id, role: "dm" });
      if (memberError) throw memberError;

      router.push(`/rooms/${room.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create room");
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    const supabase = createClient();
    try {
      const { data, error } = await supabase.rpc("join_room", {
        p_code: code.trim(),
      });
      if (error) throw error;
      router.push(`/rooms/${data}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not join room");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Panel title="Create a room (as DM)">
        <form onSubmit={createRoom} className="space-y-3">
          <div>
            <Label htmlFor="roomName">Room name</Label>
            <Input
              id="roomName"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="The Sunless Citadel"
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            Create room
          </Button>
        </form>
      </Panel>

      <Panel title="Join a room (as player)">
        <form onSubmit={joinRoom} className="space-y-3">
          <div>
            <Label htmlFor="code">Invite code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="A1B2C3D4"
            />
          </div>
          <Button
            type="submit"
            disabled={busy}
            variant="secondary"
            className="w-full"
          >
            Join room
          </Button>
        </form>
      </Panel>
    </div>
  );
}
