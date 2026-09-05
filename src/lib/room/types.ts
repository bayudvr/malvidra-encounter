import type { Database, Tables } from "@/lib/database.types";

export type Room = Tables<"rooms">;
export type Scene = Tables<"scenes">;
export type Token = Tables<"tokens">;
export type Asset = Tables<"assets">;
export type Combatant = Tables<"combatants">;
export type RoomWebhook = Tables<"room_webhooks">;
export type FogPolygon = Tables<"fog_polygons">;
export type FogDoor = Tables<"fog_doors">;

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
  role: "dm" | "player";
  display_name: string;
};

export type Role = "dm" | "player";
