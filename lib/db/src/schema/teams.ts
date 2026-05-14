import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const teamsTable = pgTable("teams", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  inviteToken: text("invite_token").unique().$defaultFn(() => crypto.randomUUID()),
  imageUrl: text("image_url"),
});

export const insertTeamSchema = createInsertSchema(teamsTable).omit({ id: true, createdAt: true });
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Team = typeof teamsTable.$inferSelect;

export const teamMembersTable = pgTable("team_members", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id").notNull().references(() => teamsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTeamMemberSchema = createInsertSchema(teamMembersTable).omit({ id: true, invitedAt: true });
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TeamMember = typeof teamMembersTable.$inferSelect;

export const teamInvitesTable = pgTable("team_invites", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id").notNull().references(() => teamsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  invitedBy: text("invited_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.teamId, t.email)]);
