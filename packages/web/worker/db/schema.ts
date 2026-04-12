import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const cats = sqliteTable("cats", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  birthday: text("birthday"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const toiletRecords = sqliteTable(
  "toilet_records",
  {
    id: text("id").primaryKey(),
    catId: text("cat_id")
      .notNull()
      .references(() => cats.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["urination", "defecation"] }).notNull(),
    timestamp: text("timestamp").notNull(),
    condition: text("condition", {
      enum: ["normal", "soft", "diarrhea", "hard", "bloody"],
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    catIdTimestampIdx: index("toilet_records_cat_id_timestamp_idx").on(t.catId, t.timestamp),
  }),
);
