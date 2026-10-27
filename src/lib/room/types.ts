import type { Database, Tables, MemberRole } from "@/lib/database.types";

export type Room = Tables<"rooms">;
export type Scene = Tables<"scenes">;
export type Token = Tables<"tokens">;
export type Asset = Tables<"assets">;
export type AssetFolder = Tables<"asset_folders">;
export type Combatant = Tables<"combatants">;
export type RoomWebhook = Tables<"room_webhooks">;
export type FogPolygon = Tables<"fog_polygons">;
export type FogDoor = Tables<"fog_doors">;
export type Wall = Tables<"walls">;
export type SavedReference = Tables<"saved_references">;
export type DmNotes = Tables<"dm_notes">;
export type TokenCounter = Tables<"token_counters">;
export type RoomCounter = Tables<"room_counters">;
export type RoomCounterUpdate = Database["public"]["Tables"]["room_counters"]["Update"];
export type PlayerRequest = Tables<"player_requests">;
export type ChatMessage = Tables<"chat_messages">;
export type TokenAura = Tables<"token_auras">;
export type SceneDrawing = Tables<"scene_drawings">;

export type SceneUpdate = Database["public"]["Tables"]["scenes"]["Update"];
export type TokenUpdate = Database["public"]["Tables"]["tokens"]["Update"];
export type CombatantUpdate =
  Database["public"]["Tables"]["combatants"]["Update"];
export type RoomWebhookUpdate =
  Database["public"]["Tables"]["room_webhooks"]["Update"];
export type FogDoorUpdate = Database["public"]["Tables"]["fog_doors"]["Update"];

export type Member = {
  id: string;
  user_id: string;
  role: MemberRole;
  display_name: string;
};

export type Role = MemberRole;
