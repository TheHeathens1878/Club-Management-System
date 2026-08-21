import { z } from "zod";

/** Shared zod primitives; domain schemas are added per phase. */
export const uuidSchema = z.string().uuid();
export const emailSchema = z.string().trim().toLowerCase().email();
/** UK mobile/landline, loosely validated; normalised downstream. */
export const phoneSchema = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/);
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
