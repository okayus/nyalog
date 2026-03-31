import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const cats = sqliteTable("cats", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});
