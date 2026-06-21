import { pgTable, serial, boolean } from "drizzle-orm/pg-core";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  requireAdEveryVisit: boolean("require_ad_every_visit").notNull().default(false),
});

export type Settings = typeof settingsTable.$inferSelect;
