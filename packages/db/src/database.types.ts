// STUB — replaced by `pnpm --filter @club/db gen:types` once the project is linked (P0.2).
// PLAN §2.7: regenerate this file in the same PR as any migration.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
