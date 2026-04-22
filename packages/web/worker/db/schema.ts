import { sqliteTable, text, index, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const credentials = sqliteTable(
  "credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull(),
    transports: text("transports"),
    deviceName: text("device_name"),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
  },
  (t) => ({
    userIdIdx: index("credentials_user_id_idx").on(t.userId),
  }),
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    userIdIdx: index("sessions_user_id_idx").on(t.userId),
  }),
);

export const spaces = sqliteTable("spaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const spaceMembers = sqliteTable(
  "space_members",
  {
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.spaceId, t.userId] }),
    userIdIdx: index("space_members_user_id_idx").on(t.userId),
  }),
);

export const cats = sqliteTable(
  "cats",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    birthday: text("birthday"),
    themeColor: text("theme_color").notNull().default("gray"),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => users.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    spaceIdIdx: index("cats_space_id_idx").on(t.spaceId),
  }),
);

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
    createdBy: text("created_by").references(() => users.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    catIdTimestampIdx: index("toilet_records_cat_id_timestamp_idx").on(t.catId, t.timestamp),
  }),
);
