import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, projectsTable, tracksTable, sequencesTable, sequenceTracksTable, teamsTable } from "@workspace/db";
import { GetSharedProjectParams, GetSharedTrackStreamParams } from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

router.get("/share/:shareToken", async (req, res): Promise<void> => {
  const params = GetSharedProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.shareToken, params.data.shareToken));

  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.shareExpiresAt.getTime() <= Date.now()) {
    res.status(410).json({ error: "Share link expired" });
    return;
  }

  const [team] = project.teamId
    ? await db.select().from(teamsTable).where(eq(teamsTable.id, project.teamId))
    : [null];

  const tracks = await db
    .select()
    .from(tracksTable)
    .where(eq(tracksTable.projectId, project.id))
    .orderBy(asc(tracksTable.createdAt));

  const allSequences = await db
    .select()
    .from(sequencesTable)
    .where(eq(sequencesTable.projectId, project.id))
    .orderBy(asc(sequencesTable.createdAt));

  // Filter sequences by sharedSequenceIds if set (null = all visible)
  const sharedIds = project.sharedSequenceIds as string[] | null;
  const sequences = sharedIds
    ? allSequences.filter((s) => sharedIds.includes(s.id))
    : allSequences;

  const sequencesWithTracks = await Promise.all(
    sequences.map(async (s) => {
      const seqTracks = await db
        .select({
          id: sequenceTracksTable.id,
          trackId: sequenceTracksTable.trackId,
          orderIndex: sequenceTracksTable.orderIndex,
          title: tracksTable.title,
          fileUrl: tracksTable.fileUrl,
          coverImageUrl: tracksTable.coverImageUrl,
          durationSeconds: tracksTable.durationSeconds,
          bpm: tracksTable.bpm,
          camelotKey: tracksTable.camelotKey,
          analyzed: tracksTable.analyzed,
        })
        .from(sequenceTracksTable)
        .innerJoin(tracksTable, eq(sequenceTracksTable.trackId, tracksTable.id))
        .where(eq(sequenceTracksTable.sequenceId, s.id))
        .orderBy(asc(sequenceTracksTable.orderIndex));

      return {
        id: s.id,
        projectId: s.projectId,
        name: s.name,
        linerNotes: s.linerNotes ?? null,
        createdBy: s.createdBy,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        tracks: seqTracks.map((t) => ({
          id: t.id,
          trackId: t.trackId,
          orderIndex: t.orderIndex,
          title: t.title,
          fileUrl: t.fileUrl,
          coverImageUrl: t.coverImageUrl ?? null,
          durationSeconds: t.durationSeconds ?? null,
          bpm: t.bpm ?? null,
          camelotKey: t.camelotKey ?? null,
          analyzed: t.analyzed,
        })),
      };
    })
  );

  res.json({
    id: project.id,
    title: project.title,
    description: project.description ?? null,
    coverImageUrl: project.coverImageUrl ?? null,
    shareExpiresAt: project.shareExpiresAt.toISOString(),
    teamId: team?.id ?? null,
    teamName: team?.name ?? null,
    teamImageUrl: team?.imageUrl ?? null,
    teamInviteToken: team?.inviteToken ?? null,
    viewerHasAccess: true,
    sequences: sequencesWithTracks,
    tracks: tracks.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      teamId: t.teamId ?? null,
      title: t.title,
      fileUrl: t.fileUrl,
      coverImageUrl: t.coverImageUrl ?? null,
      durationSeconds: t.durationSeconds ?? null,
      bpm: t.bpm ?? null,
      camelotKey: t.camelotKey ?? null,
      analyzed: t.analyzed,
      uploadedBy: t.uploadedBy,
      uploaderName: null,
      uploaderAvatarUrl: null,
      projectTitle: null,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

router.get("/share/:shareToken/stream/:trackId", async (req, res): Promise<void> => {
  const params = GetSharedTrackStreamParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.shareToken, params.data.shareToken));

  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.shareExpiresAt.getTime() <= Date.now()) {
    res.status(410).json({ error: "Share link expired" });
    return;
  }

  const [track] = await db
    .select()
    .from(tracksTable)
    .where(eq(tracksTable.id, params.data.trackId));

  if (!track || track.projectId !== project.id) {
    res.status(404).json({ error: "Track not found" });
    return;
  }

  res.json({ streamUrl: `/api/storage${track.fileUrl}` });
});

export default router;
