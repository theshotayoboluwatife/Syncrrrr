import { pgTable, text, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { teamsTable } from "./teams";
import { usersTable } from "./users";

export const tracksTable = pgTable("tracks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  teamId: text("team_id").references(() => teamsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  fileUrl: text("file_url").notNull(),
  coverImageUrl: text("cover_image_url"),
  durationSeconds: real("duration_seconds"),
  bpm: real("bpm"),
  camelotKey: text("camelot_key"),
  analyzed: boolean("analyzed").notNull().default(false),
  uploadedBy: text("uploaded_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTrackSchema = createInsertSchema(tracksTable).omit({ id: true, createdAt: true });
export type InsertTrack = z.infer<typeof insertTrackSchema>;
export type Track = typeof tracksTable.$inferSelect;
