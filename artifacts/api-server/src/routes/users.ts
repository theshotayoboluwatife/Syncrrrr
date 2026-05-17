import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, usersTable, teamInvitesTable, teamMembersTable, teamsTable } from "@workspace/db";
import { UpsertMeBody, GetMeResponse, UpsertMeResponse } from "@workspace/api-zod";
import { requireAuth, getSupabaseId } from "../lib/auth";
import { createDefaultAvatarDataUrl } from "../lib/defaultAvatar";

const router: IRouter = Router();

function sendServerError(req: any, res: any, error: unknown, message: string) {
  req.log?.error({ err: error }, message);
  res.status(500).json({
    error: message,
    ...(process.env.NODE_ENV !== "production" && error instanceof Error
      ? { detail: error.message }
      : {}),
  });
}

router.get("/users/me", requireAuth, async (req, res): Promise<void> => {
  try {
    const supabaseId = getSupabaseId(req);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.supabaseId, supabaseId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(GetMeResponse.parse({
      ...user,
      avatarUrl: user.avatarUrl ?? null,
      createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
    }));
  } catch (error) {
    sendServerError(req, res, error, "Failed to load user profile");
  }
});

router.put("/users/me", requireAuth, async (req, res): Promise<void> => {
  try {
    const supabaseId = getSupabaseId(req);
    const parsed = UpsertMeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.supabaseId, supabaseId));
    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const displayName = parsed.data.displayName.trim() || normalizedEmail.split("@")[0] || "Syncr user";
    const providedAvatarUrl = parsed.data.avatarUrl?.trim() || null;

    function serializeUser(u: typeof existing) {
      return UpsertMeResponse.parse({
        ...u,
        avatarUrl: u!.avatarUrl ?? null,
        createdAt: u!.createdAt instanceof Date ? u!.createdAt.toISOString() : u!.createdAt,
      });
    }

    if (existing) {
      const [updated] = await db
        .update(usersTable)
        .set({
          email: normalizedEmail,
          displayName,
          avatarUrl: providedAvatarUrl ?? existing.avatarUrl ?? createDefaultAvatarDataUrl(supabaseId, displayName),
        })
        .where(eq(usersTable.supabaseId, supabaseId))
        .returning();
      res.json(serializeUser(updated));
      return;
    }

    const [created] = await db
      .insert(usersTable)
      .values({
        supabaseId,
        email: normalizedEmail,
        displayName,
        avatarUrl: providedAvatarUrl ?? createDefaultAvatarDataUrl(supabaseId, displayName),
      })
      .returning();

    res.json(serializeUser(created));
  } catch (error) {
    sendServerError(req, res, error, "Failed to sync user profile");
  }
});

router.get("/users/me/invites", requireAuth, async (req, res): Promise<void> => {
  try {
    const supabaseId = getSupabaseId(req);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.supabaseId, supabaseId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const invites = await db
      .select({
        inviteId: teamInvitesTable.id,
        teamId: teamsTable.id,
        teamName: teamsTable.name,
        teamImageUrl: teamsTable.imageUrl,
        role: teamInvitesTable.role,
        invitedAt: teamInvitesTable.createdAt,
      })
      .from(teamInvitesTable)
      .innerJoin(teamsTable, eq(teamInvitesTable.teamId, teamsTable.id))
      .where(eq(teamInvitesTable.email, user.email.toLowerCase()));

    res.json(invites.map((invite) => ({
      ...invite,
      teamImageUrl: invite.teamImageUrl ?? null,
      invitedAt: invite.invitedAt instanceof Date ? invite.invitedAt.toISOString() : invite.invitedAt,
    })));
  } catch (error) {
    sendServerError(req, res, error, "Failed to load invitations");
  }
});

router.post("/users/me/invites/:inviteId/accept", requireAuth, async (req, res): Promise<void> => {
  try {
    const supabaseId = getSupabaseId(req);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.supabaseId, supabaseId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { inviteId } = req.params;
    const [invite] = await db
      .select()
      .from(teamInvitesTable)
      .where(and(eq(teamInvitesTable.id, inviteId), eq(teamInvitesTable.email, user.email.toLowerCase())));

    if (!invite) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }

    const [existingMember] = await db
      .select()
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, invite.teamId), eq(teamMembersTable.userId, user.id)));

    if (!existingMember) {
      await db
        .insert(teamMembersTable)
        .values({ teamId: invite.teamId, userId: user.id, role: invite.role });
    }

    await db.delete(teamInvitesTable).where(eq(teamInvitesTable.id, invite.id));
    res.json({ accepted: true, teamId: invite.teamId });
  } catch (error) {
    sendServerError(req, res, error, "Failed to accept invitation");
  }
});

router.delete("/users/me/invites/:inviteId", requireAuth, async (req, res): Promise<void> => {
  try {
    const supabaseId = getSupabaseId(req);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.supabaseId, supabaseId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { inviteId } = req.params;
    await db
      .delete(teamInvitesTable)
      .where(and(eq(teamInvitesTable.id, inviteId), eq(teamInvitesTable.email, user.email.toLowerCase())));

    res.status(204).send();
  } catch (error) {
    sendServerError(req, res, error, "Failed to decline invitation");
  }
});

export default router;
