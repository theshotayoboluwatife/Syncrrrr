import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, teamInvitesTable, teamMembersTable } from "@workspace/db";
import { UpsertMeBody, GetMeResponse, UpsertMeResponse } from "@workspace/api-zod";
import { requireAuth, getSupabaseId } from "../lib/auth";

const router: IRouter = Router();

router.get("/users/me", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.supabaseId, supabaseId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(GetMeResponse.parse(user));
});

router.put("/users/me", requireAuth, async (req, res): Promise<void> => {
  const supabaseId = getSupabaseId(req);
  const parsed = UpsertMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.supabaseId, supabaseId));

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
        email: parsed.data.email,
        displayName: parsed.data.displayName,
        avatarUrl: parsed.data.avatarUrl ?? null,
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
      email: parsed.data.email,
      displayName: parsed.data.displayName,
      avatarUrl: parsed.data.avatarUrl ?? null,
    })
    .returning();

  // Auto-accept any pending team invites for this email
  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const pendingInvites = await db
    .select()
    .from(teamInvitesTable)
    .where(eq(teamInvitesTable.email, normalizedEmail));

  if (pendingInvites.length > 0) {
    await Promise.all(
      pendingInvites.map((inv) =>
        db.insert(teamMembersTable)
          .values({ teamId: inv.teamId, userId: created.id, role: inv.role })
      )
    );
    await db.delete(teamInvitesTable).where(eq(teamInvitesTable.email, normalizedEmail));
  }

  res.json(serializeUser(created));
});

export default router;
