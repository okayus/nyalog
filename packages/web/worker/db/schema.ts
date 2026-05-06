import { sqliteTable, text, index, integer, primaryKey, real } from "drizzle-orm/sqlite-core";

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

export const medicalRecords = sqliteTable(
  "medical_records",
  {
    id: text("id").primaryKey(),
    catId: text("cat_id")
      .notNull()
      .references(() => cats.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["blood_test", "other"] }).notNull(),
    recordedAt: text("recorded_at").notNull(),
    title: text("title"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    catIdRecordedAtIdx: index("medical_records_cat_id_recorded_at_idx").on(t.catId, t.recordedAt),
  }),
);

export const medicalRecordAttachments = sqliteTable(
  "medical_record_attachments",
  {
    id: text("id").primaryKey(),
    medicalRecordId: text("medical_record_id")
      .notNull()
      .references(() => medicalRecords.id, { onDelete: "cascade" }),
    r2Key: text("r2_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    originalFilename: text("original_filename"),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    medicalRecordIdIdx: index("medical_record_attachments_medical_record_id_idx").on(
      t.medicalRecordId,
    ),
  }),
);

// 血液検査画像の Vision LLM 解析結果。1 attachment : 1 analysis。
// 再解析時は status / started_at / finished_at / raw_response を update し、
// 関連 blood_test_values は delete-then-insert で全置換 (PR 3 の UI で再解析前に確認)。
export const bloodTestAnalyses = sqliteTable(
  "blood_test_analyses",
  {
    id: text("id").primaryKey(),
    attachmentId: text("attachment_id")
      .notNull()
      .unique()
      .references(() => medicalRecordAttachments.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "running", "succeeded", "failed"],
    }).notNull(),
    modelName: text("model_name").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    errorMessage: text("error_message"),
    rawResponse: text("raw_response"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    attachmentIdIdx: index("blood_test_analyses_attachment_id_idx").on(t.attachmentId),
  }),
);

export const bloodTestValues = sqliteTable(
  "blood_test_values",
  {
    id: text("id").primaryKey(),
    analysisId: text("analysis_id")
      .notNull()
      .references(() => bloodTestAnalyses.id, { onDelete: "cascade" }),
    itemCode: text("item_code").notNull(),
    itemLabel: text("item_label").notNull(),
    unit: text("unit"),
    valueText: text("value_text").notNull(),
    valueNumeric: real("value_numeric"),
    refLow: real("ref_low"),
    refHigh: real("ref_high"),
    refText: text("ref_text"),
    flag: text("flag", {
      enum: ["normal", "high", "low", "abnormal", "unknown"],
    }).notNull(),
    notes: text("notes"),
    rowIndex: integer("row_index").notNull(),
    reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    analysisIdIdx: index("blood_test_values_analysis_id_idx").on(t.analysisId),
  }),
);
