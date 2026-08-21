export type { Database, Json } from "./database.types";

import type { Database } from "./database.types";

/** Row type helper: `Tables<"people">` */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T] extends { Row: infer R } ? R : never;

/** Enum helper: `Enums<"role">` */
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];
