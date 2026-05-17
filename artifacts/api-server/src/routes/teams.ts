import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, teamsTable, teamMembersTable, teamInvitesTable, usersTable } from "@workspace/db";
import { requireAuth, getSupabaseId, getSupabaseUser, supabaseAdmin } from "../lib/auth";
import { createDefaultAvatarDataUrl } from "../lib/defaultAvatar";

const router: IRouter = Router();

async function getUserBySupabaseId(supabaseId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.supabaseId, supabaseId));
  return user;
}

function metadataString(user: { user_metadata?: Record<string, unknown> } | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = user?.user_metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function refreshStoredAvatarFromSupabaseAuth(member: {
  supabaseId: string;
  avatarUrl: string | null;
}) {
  if (member.avatarUrl && !member.avatarUrl.startsWith("data:image/svg+xml")) return member.avatarUrl;

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(member.supabaseId);
  if (error || !data.user) return member.avatarUrl;

  const avatarUrl = metadataString(data.user, ["avatar_url", "picture", "photo_url"]);
  if (!avatarUrl || avatarUrl === member.avatarUrl) return member.avatarUrl;

  await db
    .update(usersTable)
    .set({ avatarUrl })
    .where(eq(usersTable.supabaseId, member.supabaseId));

  return avatarUrl;
}

async function ensureUserFromSupabase(req: Parameters<typeof getSupabaseUser>[0]) {
  const supabaseUser = getSupabaseUser(req);
  const supabaseId = supabaseUser.id;
  const email = supabaseUser.email?.trim().toLowerCase();
  if (!email) return null;

  const displayName =
    metadataString(supabaseUser, ["user_name", "preferred_username", "full_name", "name"]) ||
    email.split("@")[0] ||
    "Syncr user";
  const avatarUrl = metadataString(supabaseUser, ["avatar_url", "picture", "photo_url"]);
  const fallbackAvatarUrl = createDefaultAvatarDataUrl(supabaseId, displayName);

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.supabaseId, supabaseId));
  if (existing) {
    const [updated] = await db
      .update(usersTable)
      .set({
        email,
        displayName,
        avatarUrl: avatarUrl ?? existing.avatarUrl ?? fallbackAvatarUrl,
      })
      .where(eq(usersTable.supabaseId, supabaseId))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      supabaseId,
      email,
      displayName,
      avatarUrl: avatarUrl ?? fallbackAvatarUrl,
    })
    .returning();

  return created;
}

async function assertTeamAccess(teamId: string, userId: string, res: any, minRole?: "owner" | "admin"): Promise<{ member: typeof teamMembersTable.$inferSelect } | false> {
  const [member] = await db
    .select()
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)));
  if (!member) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  if (minRole === "owner" && member.role !== "owner") {
    res.status(403).json({ error: "Only the team owner can do this" });
    return false;
  }
  if (minRole === "admin" && member.role !== "owner" && member.role !== "admin") {
    res.status(403).json({ error: "Only admins can do this" });
    return false;
  }
  return { member };
}

function serializeTeam(t: typeof teamsTable.$inferSelect, role: string, memberCount: number) {
  const isAdminOrOwner = role === "owner" || role === "admin";
  return {
    id: t.id,
    name: t.name,
    imageUrl: t.imageUrl ?? null,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    memberCount,
    role,
    inviteToken: isAdminOrOwner ? t.inviteToken : null,
  };
}

router.get("/teams", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const memberships = await db
    .select({ teamId: teamMembersTable.teamId, role: teamMembersTable.role })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.userId, user.id));

  if (memberships.length === 0) { res.json([]); return; }

  const teamIds = memberships.map((m) => m.teamId);
  const teams = await db.select().from(teamsTable).where(
    sql`${teamsTable.id} = ANY(ARRAY[${sql.join(teamIds.map(id => sql`${id}`), sql`, `)}]::text[])`
  );

  const memberCounts = await db
    .select({ teamId: teamMembersTable.teamId, count: sql<number>`count(*)::int` })
    .from(teamMembersTable)
    .where(sql`${teamMembersTable.teamId} = ANY(ARRAY[${sql.join(teamIds.map(id => sql`${id}`), sql`, `)}]::text[])`)
    .groupBy(teamMembersTable.teamId);

  const countMap = Object.fromEntries(memberCounts.map((c) => [c.teamId, c.count]));
  const roleMap = Object.fromEntries(memberships.map((m) => [m.teamId, m.role]));

  res.json(teams.map((t) => serializeTeam(t, roleMap[t.id] ?? "member", countMap[t.id] ?? 1)));
});

router.post("/teams", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const [team] = await db.insert(teamsTable).values({ name: name.trim(), createdBy: user.id }).returning();
  await db.insert(teamMembersTable).values({ teamId: team.id, userId: user.id, role: "owner" });

  res.status(201).json(serializeTeam(team, "owner", 1));
});

router.get("/teams/:teamId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const { teamId } = req.params;
  const access = await assertTeamAccess(teamId, user.id, res);
  if (!access) return;

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, teamId));

  res.json(serializeTeam(team, access.member.role, count));
});

router.patch("/teams/:teamId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const { teamId } = req.params;
  const access = await assertTeamAccess(teamId, user.id, res, "admin");
  if (!access) return;

  const { name, imageUrl } = req.body;

  const updates: Record<string, unknown> = {};
  if (name !== undefined) {
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    updates.name = name.trim();
  }
  if (imageUrl !== undefined) updates.imageUrl = imageUrl;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db.update(teamsTable).set(updates).where(eq(teamsTable.id, teamId)).returning();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, teamId));

  res.json(serializeTeam(updated, access.member.role, count));
});

router.delete("/teams/:teamId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const { teamId } = req.params;
  const access = await assertTeamAccess(teamId, user.id, res, "owner");
  if (!access) return;

  await db.delete(teamsTable).where(eq(teamsTable.id, teamId));
  res.sendStatus(204);
});

router.post("/teams/:teamId/refresh-invite", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const { teamId } = req.params;
  const access = await assertTeamAccess(teamId, user.id, res, "admin");
  if (!access) return;

  const newToken = crypto.randomUUID();
  const [updated] = await db
    .update(teamsTable)
    .set({ inviteToken: newToken })
    .where(eq(teamsTable.id, teamId))
    .returning();

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, teamId));

  res.json(serializeTeam(updated, access.member.role, count));
});

router.get("/teams/:teamId/members", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const { teamId } = req.params;
  const access = await assertTeamAccess(teamId, user.id, res);
  if (!access) return;

  const members = await db
    .select({
      userId: teamMembersTable.userId,
      role: teamMembersTable.role,
      invitedAt: teamMembersTable.invitedAt,
      email: usersTable.email,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
      supabaseId: usersTable.supabaseId,
    })
    .from(teamMembersTable)
    .innerJoin(usersTable, eq(teamMembersTable.userId, usersTable.id))
    .where(eq(teamMembersTable.teamId, teamId));

  const activeMembers = await Promise.all(
    members.map(async (m) => ({
      userId: m.userId,
      role: m.role,
      email: m.email,
      displayName: m.displayName,
      pending: false as const,
      avatarUrl: await refreshStoredAvatarFromSupabaseAuth({
        supabaseId: m.supabaseId,
        avatarUrl: m.avatarUrl ?? null,
      }),
      invitedAt: m.invitedAt.toISOString(),
    })),
  );

  // Include pending invites (only visible to admins/owners)
  const isAdminOrOwner = access.member.role === "owner" || access.member.role === "admin";
  if (isAdminOrOwner) {
    const pendingInvites = await db
      .select()
      .from(teamInvitesTable)
      .where(eq(teamInvitesTable.teamId, teamId));

    const pendingItems = pendingInvites.map((inv) => ({
      inviteId: inv.id,
      userId: null,
      email: inv.email,
      displayName: null,
      avatarUrl: null,
      role: inv.role,
      invitedAt: inv.createdAt.toISOString(),
      pending: true as const,
    }));

    res.json([...activeMembers, ...pendingItems]);
    return;
  }

  res.json(activeMembers);
});

router.post("/teams/:teamId/members", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const { teamId } = req.params;
  const access = await assertTeamAccess(teamId, user.id, res, "admin");
  if (!access) return;

  const { email, role } = req.body;
  if (!email || typeof email !== "string") { res.status(400).json({ error: "email is required" }); return; }

  const normalizedEmail = email.trim().toLowerCase();

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));

  if (targetUser) {
    const [existing] = await db
      .select()
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, targetUser.id)));

    if (existing) {
      res.status(409).json({ error: "User is already a team member" });
      return;
    }
  }

  // Store a pending invite for direct email invites. The recipient accepts or declines it.
  const [existingInvite] = await db
    .select()
    .from(teamInvitesTable)
    .where(and(eq(teamInvitesTable.teamId, teamId), eq(teamInvitesTable.email, normalizedEmail)));

  if (existingInvite) {
    res.status(409).json({ error: "An invite has already been sent to this email" });
    return;
  }

  const [invite] = await db
    .insert(teamInvitesTable)
    .values({ teamId, email: normalizedEmail, role: role ?? "member", invitedBy: user.id })
    .returning();

  res.status(201).json({
    inviteId: invite.id,
    pending: true,
    userId: null,
    email: invite.email,
    displayName: null,
    avatarUrl: null,
    role: invite.role,
    invitedAt: invite.createdAt.toISOString(),
  });
});

router.patch("/teams/:teamId/members/:userId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const { teamId, userId } = req.params;
  const access = await assertTeamAccess(teamId, user.id, res, "admin");
  if (!access) return;

  const { role } = req.body;
  if (!role) { res.status(400).json({ error: "role is required" }); return; }

  const [existing] = await db
    .select()
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)));
  if (!existing) { res.status(404).json({ error: "Member not found" }); return; }

  if (existing.role === "owner" && role !== "owner") {
    res.status(403).json({ error: "Cannot change the owner's role" });
    return;
  }

  const [updated] = await db
    .update(teamMembersTable)
    .set({ role })
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)))
    .returning();

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  res.json({
    userId: updated.userId,
    email: targetUser.email,
    displayName: targetUser.displayName,
    avatarUrl: targetUser.avatarUrl ?? null,
    role: updated.role,
    invitedAt: updated.invitedAt.toISOString(),
  });
});

router.delete("/teams/:teamId/members/:userId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const { teamId, userId } = req.params;

  if (userId === user.id) {
    res.status(400).json({ error: "Cannot remove yourself — transfer ownership first or delete the team" });
    return;
  }

  const access = await assertTeamAccess(teamId, user.id, res, "admin");
  if (!access) return;

  const [target] = await db
    .select()
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)));

  if (target?.role === "owner") {
    res.status(403).json({ error: "Cannot remove the team owner" });
    return;
  }

  await db
    .delete(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)));

  res.sendStatus(204);
});

router.delete("/teams/:teamId/invites/:inviteId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const { teamId, inviteId } = req.params;
  const access = await assertTeamAccess(teamId, user.id, res, "admin");
  if (!access) return;

  const [invite] = await db
    .select()
    .from(teamInvitesTable)
    .where(and(eq(teamInvitesTable.id, inviteId), eq(teamInvitesTable.teamId, teamId)));

  if (!invite) { res.status(404).json({ error: "Invite not found" }); return; }

  await db.delete(teamInvitesTable).where(eq(teamInvitesTable.id, inviteId));
  res.sendStatus(204);
});

router.get("/join/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.inviteToken, token));
  if (!team) { res.status(404).json({ error: "Invalid invite link" }); return; }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, team.id));

  const [creator] = await db.select().from(usersTable).where(eq(usersTable.id, team.createdBy));

  res.json({
    teamId: team.id,
    teamName: team.name,
    teamImageUrl: team.imageUrl ?? null,
    memberCount: count,
    createdBy: creator?.displayName ?? "Unknown",
  });
});

router.post("/join/:token", requireAuth, async (req, res): Promise<void> => {
  const user = await ensureUserFromSupabase(req);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const { token } = req.params;
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.inviteToken, token));
  if (!team) { res.status(404).json({ error: "Invalid invite link" }); return; }

  const [existing] = await db
    .select()
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, team.id), eq(teamMembersTable.userId, user.id)));

  if (!existing) {
    await db.insert(teamMembersTable).values({ teamId: team.id, userId: user.id, role: "member" });
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, team.id));

  const role = existing?.role ?? "member";
  res.json(serializeTeam(team, role, count));
});

export default router;
