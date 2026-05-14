import { pgTable, text, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { tracksTable } from "./tracks";
import { usersTable } from "./users";

export const sequencesTable = pgTable("sequences", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  linerNotes: text("liner_notes"),
  createdBy: text("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSequenceSchema = createInsertSchema(sequencesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSequence = z.infer<typeof insertSequenceSchema>;
export type Sequence = typeof sequencesTable.$inferSelect;

export const sequenceTracksTable = pgTable("sequence_tracks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sequenceId: text("sequence_id").notNull().references(() => sequencesTable.id, { onDelete: "cascade" }),
  trackId: text("track_id").notNull().references(() => tracksTable.id, { onDelete: "cascade" }),
  orderIndex: real("order_index").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSequenceTrackSchema = createInsertSchema(sequenceTracksTable).omit({ id: true, addedAt: true });
export type InsertSequenceTrack = z.infer<typeof insertSequenceTrackSchema>;
export type SequenceTrack = typeof sequenceTracksTable.$inferSelect;
