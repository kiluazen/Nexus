import { z } from "zod";

const LOCAL_DATE_DESC =
  "The user's local date (YYYY-MM-DD). Always pass this from the user's timezone; if omitted the server falls back to the UTC date, which can land an evening entry on the wrong day.";

export const LogInput = z.object({
  entries: z.array(z.record(z.string(), z.unknown())).min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(LOCAL_DATE_DESC).optional(),
});

export const HistoryInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(LOCAL_DATE_DESC).optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(LOCAL_DATE_DESC).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(LOCAL_DATE_DESC).optional(),
  type: z.enum(["workout", "meal", "weight"]).optional(),
  friend_id: z.string().optional(),
});

export const UpdateInput = z.object({
  entry_id: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export const FriendsInput = z.object({
  action: z.enum(["list", "add", "accept", "reject", "remove"]),
  code: z.string().optional(),
  email: z.string().optional(),
});

export type LogInputT = z.infer<typeof LogInput>;
export type HistoryInputT = z.infer<typeof HistoryInput>;
export type UpdateInputT = z.infer<typeof UpdateInput>;
export type FriendsInputT = z.infer<typeof FriendsInput>;
