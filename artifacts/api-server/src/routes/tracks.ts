import { Router, type IRouter } from "express";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { db, tracksTable, projectMembersTable, teamMembersTable, usersTable, projectsTable } from "@workspace/db";
import {
  ListTracksParams,
  CreateTrackParams,
  CreateTrackBody,
  UpdateTrackParams,
  UpdateTrackBody,
  UpdateTrackResponse,
  DeleteTrackParams,
  ListTracksResponse,
  ListTeamTracksParams,
  CreateTeamTrackParams,
  CreateTeamTrackBody,
  UpdateTeamTrackParams,
  UpdateTeamTrackBody,
  UpdateTeamTrackResponse,
  DeleteTeamTrackParams,
  ListTeamTracksResponse,
  AddTeamTrackToProjectParams,
  AddMyTrackToProjectParams,
  CreateMyTrackBody,
  UpdateMyTrackParams,
  UpdateMyTrackBody,
  UpdateMyTrackResponse,
  DeleteMyTrackParams,
  ListMyTracksResponse,
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
    .select({ teamId: projectsTable.teamId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));
  if (project?.teamId) {
    const teamMember = await getTeamMembership(project.teamId, userId);
    if (teamMember) return true;
  }

  res.status(403).json({ error: "Forbidden" });
  return false;
}

async function getTeamMembership(teamId: string, userId: string) {
  const [member] = await db
    .select()
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)));
  return member ?? null;
}

async function assertTeamAccess(teamId: string, userId: string, res: any): Promise<boolean> {
  const member = await getTeamMembership(teamId, userId);
  if (!member) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

async function assertTeamAdmin(teamId: string, userId: string, res: any): Promise<boolean> {
  const member = await getTeamMembership(teamId, userId);
  if (!member) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  if (member.role !== "owner" && member.role !== "admin") {
    res.status(403).json({ error: "Only team admins can do this" });
    return false;
  }
  return true;
}

type EnrichedTrack = typeof tracksTable.$inferSelect & {
  uploaderName?: string | null;
  uploaderAvatarUrl?: string | null;
  projectTitle?: string | null;
};

function serializeTrack(t: EnrichedTrack) {
  return {
    id: t.id,
    projectId: t.projectId ?? null,
    teamId: t.teamId ?? null,
    title: t.title,
    fileUrl: t.fileUrl,
    coverImageUrl: t.coverImageUrl ?? null,
    durationSeconds: t.durationSeconds ?? null,
    bpm: t.bpm ?? null,
    camelotKey: t.camelotKey ?? null,
    analyzed: t.analyzed,
    uploadedBy: t.uploadedBy,
    uploaderName: t.uploaderName ?? null,
    uploaderAvatarUrl: t.uploaderAvatarUrl ?? null,
    projectTitle: t.projectTitle ?? null,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
  };
}

async function enrichTracks(rows: (typeof tracksTable.$inferSelect)[]): Promise<EnrichedTrack[]> {
  if (rows.length === 0) return [];
  const userIds = Array.from(new Set(rows.map(r => r.uploadedBy)));
  const projectIds = Array.from(new Set(rows.map(r => r.projectId).filter((x): x is string => !!x)));
  const [users, projects] = await Promise.all([
    userIds.length > 0
      ? db.select({ id: usersTable.id, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
          .from(usersTable)
          .where(inArray(usersTable.id, userIds))
      : Promise.resolve([] as { id: string; displayName: string; avatarUrl: string | null }[]),
    projectIds.length > 0
      ? db.select({ id: projectsTable.id, title: projectsTable.title })
          .from(projectsTable)
          .where(inArray(projectsTable.id, projectIds))
      : Promise.resolve([] as { id: string; title: string }[]),
  ]);
  const userMap = new Map(users.map(u => [u.id, u]));
  const projectMap = new Map(projects.map(p => [p.id, p]));
  return rows.map(r => ({
    ...r,
    uploaderName: userMap.get(r.uploadedBy)?.displayName ?? null,
    uploaderAvatarUrl: userMap.get(r.uploadedBy)?.avatarUrl ?? null,
    projectTitle: r.projectId ? projectMap.get(r.projectId)?.title ?? null : null,
  }));
}

async function enrichOne(row: typeof tracksTable.$inferSelect): Promise<EnrichedTrack> {
  const [enriched] = await enrichTracks([row]);
  return enriched;
}

// ── Project-scoped tracks ─────────────────────────────────────────────────────

router.get("/projects/:projectId/tracks", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = ListTracksParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const tracks = await db
    .select()
    .from(tracksTable)
    .where(eq(tracksTable.projectId, params.data.projectId))
    .orderBy(tracksTable.createdAt);

  const enriched = await enrichTracks(tracks);
  res.json(ListTracksResponse.parse(enriched.map(serializeTrack)));
});

router.post("/projects/:projectId/tracks", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = CreateTrackParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const parsed = CreateTrackBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // If the project belongs to a team, the new track joins both libraries.
  const [project] = await db
    .select({ teamId: projectsTable.teamId })
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.projectId));

  const [track] = await db
    .insert(tracksTable)
    .values({
      projectId: params.data.projectId,
      teamId: project?.teamId ?? null,
      title: parsed.data.title,
      fileUrl: parsed.data.fileUrl,
      coverImageUrl: parsed.data.coverImageUrl ?? null,
      durationSeconds: parsed.data.durationSeconds ?? null,
      bpm: parsed.data.bpm ?? null,
      camelotKey: parsed.data.camelotKey ?? null,
      analyzed: parsed.data.analyzed ?? false,
      uploadedBy: user.id,
    })
    .returning();

  res.status(201).json(serializeTrack(await enrichOne(track)));
});

router.patch("/projects/:projectId/tracks/:trackId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = UpdateTrackParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const parsed = UpdateTrackBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // If this track is part of a team library, renaming requires team admin/owner.
  // Metadata-only edits (analyze, duration backfill) remain allowed for any project member.
  if (parsed.data.title !== undefined) {
    const [existing] = await db
      .select({ teamId: tracksTable.teamId })
      .from(tracksTable)
      .where(and(eq(tracksTable.id, params.data.trackId), eq(tracksTable.projectId, params.data.projectId)));
    if (existing?.teamId) {
      const ok = await assertTeamAdmin(existing.teamId, user.id, res);
      if (!ok) return;
    }
  }

  const [updated] = await db
    .update(tracksTable)
    .set({
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.bpm !== undefined && { bpm: parsed.data.bpm }),
      ...(parsed.data.camelotKey !== undefined && { camelotKey: parsed.data.camelotKey }),
      ...(parsed.data.durationSeconds !== undefined && { durationSeconds: parsed.data.durationSeconds }),
      ...(parsed.data.analyzed !== undefined && { analyzed: parsed.data.analyzed }),
      ...(parsed.data.coverImageUrl !== undefined && { coverImageUrl: parsed.data.coverImageUrl }),
    })
    .where(and(eq(tracksTable.id, params.data.trackId), eq(tracksTable.projectId, params.data.projectId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Track not found" }); return; }

  res.json(UpdateTrackResponse.parse(serializeTrack(await enrichOne(updated))));
});

router.delete("/projects/:projectId/tracks/:trackId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = DeleteTrackParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  // If the track is also in a team library, unlink it from this project rather than fully deleting it.
  const [existing] = await db
    .select()
    .from(tracksTable)
    .where(and(eq(tracksTable.id, params.data.trackId), eq(tracksTable.projectId, params.data.projectId)));

  if (!existing) {
    res.sendStatus(204);
    return;
  }

  if (existing.teamId) {
    await db
      .update(tracksTable)
      .set({ projectId: null })
      .where(eq(tracksTable.id, existing.id));
  } else {
    await db
      .delete(tracksTable)
      .where(eq(tracksTable.id, existing.id));
  }

  res.sendStatus(204);
});

// ── Add team library track into a specific project's library ─────────────────

router.post("/projects/:projectId/library/:trackId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = AddTeamTrackToProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  // Look up project to confirm it has a team and the track is in the same team
  const [project] = await db
    .select({ teamId: projectsTable.teamId })
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.projectId));
  if (!project?.teamId) { res.status(403).json({ error: "Project is not part of a team" }); return; }

  // Caller must be a member of the team that owns the track (project membership alone is not enough,
  // since project members may include non-team collaborators).
  const teamOk = await assertTeamAccess(project.teamId, user.id, res);
  if (!teamOk) return;

  const [track] = await db
    .select()
    .from(tracksTable)
    .where(eq(tracksTable.id, params.data.trackId));
  if (!track || track.teamId !== project.teamId) {
    res.status(404).json({ error: "Track not found in this team" });
    return;
  }

  // Already in this project: no-op success
  if (track.projectId === params.data.projectId) {
    res.json(serializeTrack(await enrichOne(track)));
    return;
  }

  // Prevent reassigning (stealing) a track that's already in another project.
  if (track.projectId && track.projectId !== params.data.projectId) {
    res.status(409).json({ error: "Track is already assigned to another project. Remove it from there first." });
    return;
  }

  const [updated] = await db
    .update(tracksTable)
    .set({ projectId: params.data.projectId })
    .where(eq(tracksTable.id, params.data.trackId))
    .returning();

  res.json(serializeTrack(await enrichOne(updated)));
});

// ── Add personal library track into a specific project's library ─────────────

router.post("/projects/:projectId/library/me/:trackId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = AddMyTrackToProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const [track] = await db
    .select()
    .from(tracksTable)
    .where(eq(tracksTable.id, params.data.trackId));
  if (!track || track.uploadedBy !== user.id || track.teamId !== null) {
    res.status(404).json({ error: "Track not found in your personal library" });
    return;
  }

  if (track.projectId === params.data.projectId) {
    res.json(serializeTrack(await enrichOne(track)));
    return;
  }

  if (track.projectId && track.projectId !== params.data.projectId) {
    res.status(409).json({ error: "Track is already assigned to another project. Remove it from there first." });
    return;
  }

  const [updated] = await db
    .update(tracksTable)
    .set({ projectId: params.data.projectId })
    .where(eq(tracksTable.id, params.data.trackId))
    .returning();

  res.json(serializeTrack(await enrichOne(updated)));
});

// ── Team-scoped tracks (shared library) ──────────────────────────────────────

router.get("/teams/:teamId/tracks", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = ListTeamTracksParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertTeamAccess(params.data.teamId, user.id, res);
  if (!hasAccess) return;

  const tracks = await db
    .select()
    .from(tracksTable)
    .where(eq(tracksTable.teamId, params.data.teamId))
    .orderBy(tracksTable.createdAt);

  const enriched = await enrichTracks(tracks);
  res.json(ListTeamTracksResponse.parse(enriched.map(serializeTrack)));
});

router.post("/teams/:teamId/tracks", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = CreateTeamTrackParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertTeamAccess(params.data.teamId, user.id, res);
  if (!hasAccess) return;

  const parsed = CreateTeamTrackBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [track] = await db
    .insert(tracksTable)
    .values({
      projectId: null,
      teamId: params.data.teamId,
      title: parsed.data.title,
      fileUrl: parsed.data.fileUrl,
      coverImageUrl: parsed.data.coverImageUrl ?? null,
      durationSeconds: parsed.data.durationSeconds ?? null,
      bpm: parsed.data.bpm ?? null,
      camelotKey: parsed.data.camelotKey ?? null,
      analyzed: parsed.data.analyzed ?? false,
      uploadedBy: user.id,
    })
    .returning();

  res.status(201).json(serializeTrack(await enrichOne(track)));
});

router.patch("/teams/:teamId/tracks/:trackId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = UpdateTeamTrackParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateTeamTrackBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Allow background metadata updates (analysis/duration backfill) by any team member.
  // Restrict user-facing edits (title) to team admins/owners.
  const isTitleEdit = parsed.data.title !== undefined;
  if (isTitleEdit) {
    const ok = await assertTeamAdmin(params.data.teamId, user.id, res);
    if (!ok) return;
  } else {
    const ok = await assertTeamAccess(params.data.teamId, user.id, res);
    if (!ok) return;
  }

  const [updated] = await db
    .update(tracksTable)
    .set({
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.bpm !== undefined && { bpm: parsed.data.bpm }),
      ...(parsed.data.camelotKey !== undefined && { camelotKey: parsed.data.camelotKey }),
      ...(parsed.data.durationSeconds !== undefined && { durationSeconds: parsed.data.durationSeconds }),
      ...(parsed.data.analyzed !== undefined && { analyzed: parsed.data.analyzed }),
      ...(parsed.data.coverImageUrl !== undefined && { coverImageUrl: parsed.data.coverImageUrl }),
    })
    .where(and(eq(tracksTable.id, params.data.trackId), eq(tracksTable.teamId, params.data.teamId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Track not found" }); return; }

  res.json(UpdateTeamTrackResponse.parse(serializeTrack(await enrichOne(updated))));
});

router.delete("/teams/:teamId/tracks/:trackId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = DeleteTeamTrackParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const ok = await assertTeamAdmin(params.data.teamId, user.id, res);
  if (!ok) return;

  await db
    .delete(tracksTable)
    .where(and(eq(tracksTable.id, params.data.trackId), eq(tracksTable.teamId, params.data.teamId)));

  res.sendStatus(204);
});

// ── Personal library (tracks owned by user, not in any team or project) ─────

router.get("/users/me/tracks", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const tracks = await db
    .select()
    .from(tracksTable)
    .where(and(
      eq(tracksTable.uploadedBy, user.id),
      isNull(tracksTable.teamId),
      isNull(tracksTable.projectId),
    ))
    .orderBy(tracksTable.createdAt);

  const enriched = await enrichTracks(tracks);
  res.json(ListMyTracksResponse.parse(enriched.map(serializeTrack)));
});

router.post("/users/me/tracks", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const parsed = CreateMyTrackBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [track] = await db
    .insert(tracksTable)
    .values({
      projectId: null,
      teamId: null,
      title: parsed.data.title,
      fileUrl: parsed.data.fileUrl,
      coverImageUrl: parsed.data.coverImageUrl ?? null,
      durationSeconds: parsed.data.durationSeconds ?? null,
      bpm: parsed.data.bpm ?? null,
      camelotKey: parsed.data.camelotKey ?? null,
      analyzed: parsed.data.analyzed ?? false,
      uploadedBy: user.id,
    })
    .returning();

  res.status(201).json(serializeTrack(await enrichOne(track)));
});

router.patch("/users/me/tracks/:trackId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = UpdateMyTrackParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateMyTrackBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db
    .update(tracksTable)
    .set({
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.bpm !== undefined && { bpm: parsed.data.bpm }),
      ...(parsed.data.camelotKey !== undefined && { camelotKey: parsed.data.camelotKey }),
      ...(parsed.data.durationSeconds !== undefined && { durationSeconds: parsed.data.durationSeconds }),
      ...(parsed.data.analyzed !== undefined && { analyzed: parsed.data.analyzed }),
      ...(parsed.data.coverImageUrl !== undefined && { coverImageUrl: parsed.data.coverImageUrl }),
    })
    .where(and(
      eq(tracksTable.id, params.data.trackId),
      eq(tracksTable.uploadedBy, user.id),
      isNull(tracksTable.teamId),
      isNull(tracksTable.projectId),
    ))
    .returning();

  if (!updated) { res.status(404).json({ error: "Track not found" }); return; }

  res.json(UpdateMyTrackResponse.parse(serializeTrack(await enrichOne(updated))));
});

router.delete("/users/me/tracks/:trackId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = DeleteMyTrackParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  await db
    .delete(tracksTable)
    .where(and(
      eq(tracksTable.id, params.data.trackId),
      eq(tracksTable.uploadedBy, user.id),
      isNull(tracksTable.teamId),
      isNull(tracksTable.projectId),
    ));

  res.sendStatus(204);
});

export default router;
