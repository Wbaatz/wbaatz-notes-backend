import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adViewsTable = pgTable("ad_views", {
  id: serial("id").primaryKey(),
  noteId: integer("note_id").notNull(),
  accessToken: text("access_token").notNull(),
  viewerFingerprint: text("viewer_fingerprint"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAdViewSchema = createInsertSchema(adViewsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAdView = z.infer<typeof insertAdViewSchema>;
export type AdView = typeof adViewsTable.$inferSelect;
