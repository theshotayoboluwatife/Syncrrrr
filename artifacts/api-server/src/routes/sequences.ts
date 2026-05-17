import { Router, type IRouter } from "express";
import { eq, and, asc } from "drizzle-orm";
import { db, sequencesTable, sequenceTracksTable, tracksTable, projectMembersTable, usersTable, projectsTable, teamMembersTable } from "@workspace/db";
import {
  ListSequencesParams,
  CreateSequenceParams,
  CreateSequenceBody,
  GetSequenceParams,
  UpdateSequenceParams,
  UpdateSequenceBody,
  DeleteSequenceParams,
  DuplicateSequenceParams,
  AddTrackToSequenceParams,
  AddTrackToSequenceBody,
  RemoveTrackFromSequenceParams,
  ReorderSequenceTracksParams,
  ReorderSequenceTracksBody,
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
    const [teamMember] = await db
      .select()
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, project.teamId), eq(teamMembersTable.userId, userId)));
    if (teamMember) return true;
  }

  res.status(403).json({ error: "Forbidden" });
  return false;
}

async function getSequenceWithTracks(sequenceId: string) {
  const [sequence] = await db.select().from(sequencesTable).where(eq(sequencesTable.id, sequenceId));
  if (!sequence) return null;

  const seqTracks = await db
    .select({
      id: sequenceTracksTable.id,
      trackId: sequenceTracksTable.trackId,
      orderIndex: sequenceTracksTable.orderIndex,
      title: tracksTable.title,
      fileUrl: tracksTable.fileUrl,
      durationSeconds: tracksTable.durationSeconds,
      bpm: tracksTable.bpm,
      camelotKey: tracksTable.camelotKey,
      analyzed: tracksTable.analyzed,
    })
    .from(sequenceTracksTable)
    .innerJoin(tracksTable, eq(sequenceTracksTable.trackId, tracksTable.id))
    .where(eq(sequenceTracksTable.sequenceId, sequenceId))
    .orderBy(asc(sequenceTracksTable.orderIndex));

  return {
    id: sequence.id,
    projectId: sequence.projectId,
    name: sequence.name,
    linerNotes: sequence.linerNotes ?? null,
    createdBy: sequence.createdBy,
    createdAt: sequence.createdAt.toISOString(),
    updatedAt: sequence.updatedAt.toISOString(),
    tracks: seqTracks.map((t) => ({
      id: t.id,
      trackId: t.trackId,
      orderIndex: t.orderIndex,
      title: t.title,
      fileUrl: t.fileUrl,
      durationSeconds: t.durationSeconds ?? null,
      bpm: t.bpm ?? null,
      camelotKey: t.camelotKey ?? null,
      analyzed: t.analyzed,
    })),
  };
}

router.get("/projects/:projectId/sequences", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = ListSequencesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const sequences = await db
    .select()
    .from(sequencesTable)
    .where(eq(sequencesTable.projectId, params.data.projectId))
    .orderBy(asc(sequencesTable.createdAt));

  const withCounts = await Promise.all(
    sequences.map(async (s) => {
      const trackRows = await db
        .select({ id: sequenceTracksTable.id })
        .from(sequenceTracksTable)
        .where(eq(sequenceTracksTable.sequenceId, s.id));
      return {
        id: s.id,
        projectId: s.projectId,
        name: s.name,
        linerNotes: s.linerNotes ?? null,
        createdBy: s.createdBy,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        trackCount: trackRows.length,
      };
    })
  );

  res.json(withCounts);
});

router.post("/projects/:projectId/sequences", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = CreateSequenceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const parsed = CreateSequenceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [sequence] = await db
    .insert(sequencesTable)
    .values({
      projectId: params.data.projectId,
      name: parsed.data.name,
      createdBy: user.id,
    })
    .returning();

  res.status(201).json({
    id: sequence.id,
    projectId: sequence.projectId,
    name: sequence.name,
    createdBy: sequence.createdBy,
    createdAt: sequence.createdAt.toISOString(),
    updatedAt: sequence.updatedAt.toISOString(),
    trackCount: 0,
  });
});

router.get("/projects/:projectId/sequences/:sequenceId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = GetSequenceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const result = await getSequenceWithTracks(params.data.sequenceId);
  if (!result) { res.status(404).json({ error: "Sequence not found" }); return; }

  res.json(result);
});

router.patch("/projects/:projectId/sequences/:sequenceId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = UpdateSequenceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const parsed = UpdateSequenceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db
    .update(sequencesTable)
    .set({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.linerNotes !== undefined && { linerNotes: parsed.data.linerNotes }),
    })
    .where(eq(sequencesTable.id, params.data.sequenceId))
    .returning();

  if (!updated) { res.status(404).json({ error: "Sequence not found" }); return; }

  const trackRows = await db
    .select({ id: sequenceTracksTable.id })
    .from(sequenceTracksTable)
    .where(eq(sequenceTracksTable.sequenceId, updated.id));

  res.json({
    id: updated.id,
    projectId: updated.projectId,
    name: updated.name,
    linerNotes: updated.linerNotes ?? null,
    createdBy: updated.createdBy,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    trackCount: trackRows.length,
  });
});

router.delete("/projects/:projectId/sequences/:sequenceId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = DeleteSequenceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  await db.delete(sequencesTable).where(eq(sequencesTable.id, params.data.sequenceId));
  res.sendStatus(204);
});

router.post("/projects/:projectId/sequences/:sequenceId/duplicate", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = DuplicateSequenceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const [original] = await db.select().from(sequencesTable).where(eq(sequencesTable.id, params.data.sequenceId));
  if (!original) { res.status(404).json({ error: "Sequence not found" }); return; }

  const originalTracks = await db
    .select()
    .from(sequenceTracksTable)
    .where(eq(sequenceTracksTable.sequenceId, original.id))
    .orderBy(asc(sequenceTracksTable.orderIndex));

  const [newSequence] = await db
    .insert(sequencesTable)
    .values({
      projectId: original.projectId,
      name: `${original.name} (Copy)`,
      createdBy: user.id,
    })
    .returning();

  if (originalTracks.length > 0) {
    await db.insert(sequenceTracksTable).values(
      originalTracks.map((t) => ({
        sequenceId: newSequence.id,
        trackId: t.trackId,
        orderIndex: t.orderIndex,
      }))
    );
  }

  res.status(201).json({
    id: newSequence.id,
    projectId: newSequence.projectId,
    name: newSequence.name,
    createdBy: newSequence.createdBy,
    createdAt: newSequence.createdAt.toISOString(),
    updatedAt: newSequence.updatedAt.toISOString(),
    trackCount: originalTracks.length,
  });
});

router.post("/projects/:projectId/sequences/:sequenceId/tracks", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = AddTrackToSequenceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const parsed = AddTrackToSequenceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existingTracks = await db
    .select()
    .from(sequenceTracksTable)
    .where(eq(sequenceTracksTable.sequenceId, params.data.sequenceId))
    .orderBy(asc(sequenceTracksTable.orderIndex));

  const maxIndex = existingTracks.length > 0 ? existingTracks[existingTracks.length - 1].orderIndex : 0;

  await db.insert(sequenceTracksTable).values({
    sequenceId: params.data.sequenceId,
    trackId: parsed.data.trackId,
    orderIndex: maxIndex + 1,
  });

  const result = await getSequenceWithTracks(params.data.sequenceId);
  res.status(201).json(result);
});

router.delete("/projects/:projectId/sequences/:sequenceId/tracks/:trackId", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = RemoveTrackFromSequenceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  await db
    .delete(sequenceTracksTable)
    .where(and(
      eq(sequenceTracksTable.sequenceId, params.data.sequenceId),
      eq(sequenceTracksTable.trackId, params.data.trackId)
    ));

  const result = await getSequenceWithTracks(params.data.sequenceId);
  res.json(result);
});

router.patch("/projects/:projectId/sequences/:sequenceId/reorder", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const user = await getUserBySupabaseId(supabaseId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const params = ReorderSequenceTracksParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const hasAccess = await assertProjectAccess(params.data.projectId, user.id, res);
  if (!hasAccess) return;

  const parsed = ReorderSequenceTracksBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const seqTracks = await db
    .select()
    .from(sequenceTracksTable)
    .where(eq(sequenceTracksTable.sequenceId, params.data.sequenceId));

  const trackIdToSeqTrackId = Object.fromEntries(seqTracks.map((st) => [st.trackId, st.id]));

  await Promise.all(
    parsed.data.orderedTrackIds.map(async (trackId, index) => {
      const seqTrackId = trackIdToSeqTrackId[trackId];
      if (seqTrackId) {
        await db
          .update(sequenceTracksTable)
          .set({ orderIndex: index + 1 })
          .where(eq(sequenceTracksTable.id, seqTrackId));
      }
    })
  );

  const result = await getSequenceWithTracks(params.data.sequenceId);
  res.json(result);
});

export default router;
