import { pgTable, text, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { teamsTable } from "./teams";

export const projectsTable = pgTable("projects", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  coverImageUrl: text("cover_image_url"),
  shareToken: text("share_token").notNull().unique().$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id").references(() => teamsTable.id, { onDelete: "cascade" }),
  sharedSequenceIds: json("shared_sequence_ids").$type<string[] | null>(),
  memberOnly: text("member_only").$type<"true" | "false">().default("false").notNull(),
  createdBy: text("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, shareToken: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;

export const projectMembersTable = pgTable("project_members", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("editor"),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProjectMemberSchema = createInsertSchema(projectMembersTable).omit({ id: true, invitedAt: true });
export type InsertProjectMember = z.infer<typeof insertProjectMemberSchema>;
export type ProjectMember = typeof projectMembersTable.$inferSelect;
