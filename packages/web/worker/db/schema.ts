import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const cats = sqliteTable("cats", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  birthday: text("birthday"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
