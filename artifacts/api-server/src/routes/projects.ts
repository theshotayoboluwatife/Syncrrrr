import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, projectsTable, projectMembersTable, usersTable, tracksTable, sequencesTable, teamsTable, teamMembersTable } from "@workspace/db";
import {
  CreateProjectBody,
  UpdateProjectBody,
  UpdateProjectParams,
  DeleteProjectParams,
  GetProjectParams,
  ListProjectMembersParams,
  AddProjectMemberBody,
  AddProjectMemberParams,
  RemoveProjectMemberParams,
} from "@workspace/api-zod";
import { requireAuth, getSupabaseId } from "../lib/auth";

const router: IRouter = Router();

async function getUserBySupabaseId(supabaseId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.supabaseId, supabaseId));
  return user;
}

async function assertProjectAccess(projectId: string, userId: string, res: any): Promise<boolean> {
  const [member] = await db
    .select()
    .from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId)));
  if (member) return true;

  const [project] = await db
    .select({ teamId: projectsTable.teamId, memberOnly: projectsTable.memberOnly })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));
  if (project?.teamId) {
    const [teamMember] = await db
      .select()
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, project.teamId), eq(teamMembersTable.userId, userId)));
    if (teamMember) return true;
  }

  res.status(403).json({ error: "Forbidden" });
  return false;
}

router.get("/projects", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) {
    res.status(401).json({ error: "User not found, please sync" });
    return;
  }

  const members = await db
    .select({ projectId: projectMembersTable.projectId, role: projectMembersTable.role })
    .from(projectMembersTable)
    .where(eq(projectMembersTable.userId, user.id));

  const userTeamMemberships = await db
    .select({ teamId: teamMembersTable.teamId, role: teamMembersTable.role })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.userId, user.id));

  const userTeamIds = userTeamMemberships.map((m) => m.teamId);

  let teamProjects: (typeof projectsTable.$inferSelect)[] = [];
  if (userTeamIds.length > 0) {
    teamProjects = await db.select().from(projectsTable).where(
      sql`${projectsTable.teamId} = ANY(ARRAY[${sql.join(userTeamIds.map(id => sql`${id}`), sql`, `)}]::text[])`
    );
  }

  const directProjectIds = members.map((m) => m.projectId);
  let directProjects: (typeof projectsTable.$inferSelect)[] = [];
  if (directProjectIds.length > 0) {
    directProjects = await db.select().from(projectsTable).where(
      sql`${projectsTable.id} = ANY(ARRAY[${sql.join(directProjectIds.map(id => sql`${id}`), sql`, `)}]::text[])`
    );
  }

  const allProjectsMap = new Map<string, typeof projectsTable.$inferSelect>();
  for (const p of [...directProjects, ...teamProjects]) allProjectsMap.set(p.id, p);
  const projects = Array.from(allProjectsMap.values());

  if (projects.length === 0) { res.json([]); return; }

  const allIds = projects.map((p) => p.id);

  const trackCounts = await db
    .select({ projectId: tracksTable.projectId, count: sql<number>`count(*)::int` })
    .from(tracksTable)
    .where(sql`${tracksTable.projectId} = ANY(ARRAY[${sql.join(allIds.map(id => sql`${id}`), sql`, `)}]::text[])`)
    .groupBy(tracksTable.projectId);

  const sequenceCounts = await db
    .select({ projectId: sequencesTable.projectId, count: sql<number>`count(*)::int` })
    .from(sequencesTable)
    .where(sql`${sequencesTable.projectId} = ANY(ARRAY[${sql.join(allIds.map(id => sql`${id}`), sql`, `)}]::text[])`)
    .groupBy(sequencesTable.projectId);

  const trackCountMap = Object.fromEntries(trackCounts.map((t) => [t.projectId, t.count]));
  const seqCountMap = Object.fromEntries(sequenceCounts.map((s) => [s.projectId, s.count]));
  const roleMap = Object.fromEntries(members.map((m) => [m.projectId, m.role]));
  const teamRoleMap = Object.fromEntries(userTeamMemberships.map((m) => [m.teamId, m.role]));
  const creatorIds = Array.from(new Set(projects.map((p) => p.createdBy)));
  const creators = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(creatorIds.map(id => sql`${id}`), sql`, `)}]::text[])`);
  const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));

  const result = projects.map((p) => {
    const creator = creatorMap.get(p.createdBy);
    return {
      id: p.id,
      title: p.title,
      description: p.description ?? null,
      coverImageUrl: p.coverImageUrl ?? null,
      shareToken: p.shareToken,
      shareExpiresAt: p.shareExpiresAt.toISOString(),
      teamId: p.teamId ?? null,
      sharedSequenceIds: p.sharedSequenceIds ?? null,
      memberOnly: p.memberOnly === "true",
      trackCount: trackCountMap[p.id] ?? 0,
      sequenceCount: seqCountMap[p.id] ?? 0,
      role: roleMap[p.id] ?? (p.teamId ? (teamRoleMap[p.teamId] ?? "member") : "editor"),
      createdBy: p.createdBy,
      creatorDisplayName: creator?.displayName ?? "Unknown",
      creatorAvatarUrl: creator?.avatarUrl ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  });

  res.json(result);
});

router.post("/projects", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) {
    res.status(401).json({ error: "User not found, please sync" });
    return;
  }

  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const teamId = (parsed.data as any).teamId ?? null;

  if (teamId) {
    const [teamMember] = await db
      .select()
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, user.id)));
    if (!teamMember) {
      res.status(403).json({ error: "You are not a member of this team" });
      return;
    }
  }

  const [project] = await db
    .insert(projectsTable)
    .values({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      coverImageUrl: parsed.data.coverImageUrl ?? null,
      teamId: teamId ?? null,
      createdBy: user.id,
    })
    .returning();

  await db.insert(projectMembersTable).values({
    projectId: project.id,
    userId: user.id,
    role: "owner",
  });

  res.status(201).json({
    ...project,
    description: project.description ?? null,
    coverImageUrl: project.coverImageUrl ?? null,
    teamId: project.teamId ?? null,
    shareExpiresAt: project.shareExpiresAt.toISOString(),
    sharedSequenceIds: project.sharedSequenceIds ?? null,
    memberOnly: project.memberOnly === "true",
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  });
});

router.get("/projects/:projectId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  res.json({
    ...project,
    description: project.description ?? null,
    coverImageUrl: project.coverImageUrl ?? null,
    teamId: project.teamId ?? null,
    shareExpiresAt: project.shareExpiresAt.toISOString(),
    sharedSequenceIds: project.sharedSequenceIds ?? null,
    memberOnly: project.memberOnly === "true",
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  });
});

router.patch("/projects/:projectId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db
    .update(projectsTable)
    .set({
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      ...(parsed.data.coverImageUrl !== undefined && { coverImageUrl: parsed.data.coverImageUrl }),
      ...(parsed.data.shareExpiresAt !== undefined && { shareExpiresAt: new Date(parsed.data.shareExpiresAt) }),
      ...(parsed.data.sharedSequenceIds !== undefined && { sharedSequenceIds: parsed.data.sharedSequenceIds }),
      ...(parsed.data.memberOnly !== undefined && { memberOnly: parsed.data.memberOnly ? "true" as const : "false" as const }),
    })
    .where(eq(projectsTable.id, params.data.projectId))
    .returning();

  res.json({
    ...updated,
    description: updated.description ?? null,
    coverImageUrl: updated.coverImageUrl ?? null,
    teamId: updated.teamId ?? null,
    shareExpiresAt: updated.shareExpiresAt.toISOString(),
    sharedSequenceIds: updated.sharedSequenceIds ?? null,
    memberOnly: updated.memberOnly === "true",
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

router.delete("/projects/:projectId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.projectId));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (project.teamId) {
    const [teamMember] = await db
      .select()
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, project.teamId), eq(teamMembersTable.userId, user.id)));

    if (!teamMember || teamMember.role !== "owner") {
      res.status(403).json({ error: "Only the team owner can delete this project" });
      return;
    }

    await db.delete(projectsTable).where(eq(projectsTable.id, params.data.projectId));
    res.sendStatus(204);
    return;
  }

  const [member] = await db
    .select()
    .from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, params.data.projectId), eq(projectMembersTable.userId, user.id)));

  if (!member || member.role !== "owner") {
    res.status(403).json({ error: "Only the owner can delete a project" });
    return;
  }

  await db.delete(projectsTable).where(eq(projectsTable.id, params.data.projectId));
  res.sendStatus(204);
});

router.get("/projects/:projectId/members", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = ListProjectMembersParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const members = await db
    .select({
      userId: projectMembersTable.userId,
      role: projectMembersTable.role,
      invitedAt: projectMembersTable.invitedAt,
      email: usersTable.email,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(projectMembersTable)
    .innerJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
    .where(eq(projectMembersTable.projectId, params.data.projectId));

  res.json(members.map((m) => ({
    ...m,
    avatarUrl: m.avatarUrl ?? null,
    invitedAt: m.invitedAt.toISOString(),
  })));
});

router.post("/projects/:projectId/members", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = AddProjectMemberParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const parsed = AddProjectMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email));
  if (!targetUser) {
    res.status(404).json({ error: "User not found. They must sign up first." });
    return;
  }

  const [existing] = await db
    .select()
    .from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, params.data.projectId), eq(projectMembersTable.userId, targetUser.id)));

  if (existing) {
    res.status(409).json({ error: "User is already a member" });
    return;
  }

  const [member] = await db
    .insert(projectMembersTable)
    .values({
      projectId: params.data.projectId,
      userId: targetUser.id,
      role: parsed.data.role ?? "editor",
    })
    .returning();

  res.status(201).json({
    userId: member.userId,
    email: targetUser.email,
    displayName: targetUser.displayName,
    avatarUrl: targetUser.avatarUrl ?? null,
    role: member.role,
    invitedAt: member.invitedAt.toISOString(),
  });
});

router.delete("/projects/:projectId/members/:userId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const currentUser = await getUserBySupabaseId(supabaseId);
  if (!currentUser) { res.status(401).json({ error: "User not found" }); return; }

  const params = RemoveProjectMemberParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, currentUser.id, res);
  if (!hasAccess) return;

  await db
    .delete(projectMembersTable)
    .where(and(
      eq(projectMembersTable.projectId, params.data.projectId),
      eq(projectMembersTable.userId, params.data.userId)
    ));

  res.sendStatus(204);
});

export default router;
