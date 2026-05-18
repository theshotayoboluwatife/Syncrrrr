import React, { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  useGetTeam,
  useUpdateTeam,
  useDeleteTeam,
  useListTeamMembers,
  useAddTeamMember,
  useUpdateTeamMember,
  useRemoveTeamMember,
  useCancelTeamInvite,
  useRefreshTeamInvite,
  useRequestUploadUrl,
  getListTeamsQueryKey,
  getGetTeamQueryKey,
  getListTeamMembersQueryKey,
  type TeamMember,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { uploadFileToStorage } from "@/lib/storage-upload";
import { UserAvatar } from "@/components/UserAvatar";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    owner: "bg-amber-500/20 text-amber-400",
    admin: "bg-primary/20 text-primary",
    member: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize ${colors[role] ?? colors.member}`}>
      {role}
    </span>
  );
}

export function TeamSettings() {
  const { teamId } = useParams<{ teamId: string }>();
  const [, navigate] = useLocation();
  useAuth();
  const queryClient = useQueryClient();

  const { data: team, isLoading: teamLoading } = useGetTeam(teamId);
  const { data: members, isLoading: membersLoading } = useListTeamMembers(teamId);
  const updateTeam = useUpdateTeam();
  const deleteTeam = useDeleteTeam();
  const addMember = useAddTeamMember();
  const updateMember = useUpdateTeamMember();
  const removeMember = useRemoveTeamMember();
  const cancelInvite = useCancelTeamInvite();
  const refreshInvite = useRefreshTeamInvite();
  const requestUploadUrl = useRequestUploadUrl();

  const [teamName, setTeamName] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteError, setInviteError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const currentRole = team?.role ?? "member";
  const isOwnerOrAdmin = currentRole === "owner" || currentRole === "admin";

  const activeMembers = members?.filter((m) => !m.pending) ?? [];
  const pendingInvites = members?.filter((m) => m.pending) ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListTeamsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTeamQueryKey(teamId) });
    queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey(teamId) });
  };

  const updateTeamCaches = (updated: any) => {
    queryClient.setQueryData(getGetTeamQueryKey(teamId), updated);
    queryClient.setQueryData(getListTeamsQueryKey(), (old: any) =>
      Array.isArray(old)
        ? old.map((item) => (item.id === teamId ? { ...item, ...updated } : item))
        : old,
    );
  };

  const handleRename = async () => {
    if (!teamName.trim()) return;
    const updated = await updateTeam.mutateAsync({ teamId, data: { name: teamName.trim() } });
    updateTeamCaches(updated);
    invalidate();
    setIsEditingName(false);
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteError("");
    try {
      await addMember.mutateAsync({ teamId, data: { email: inviteEmail.trim(), role: inviteRole } });
      invalidate();
      setInviteEmail("");
      setInviteRole("member");
    } catch (err: any) {
      const raw: string = err?.message || "Failed to add member";
      const colonIdx = raw.indexOf(": ");
      setInviteError(colonIdx !== -1 ? raw.slice(colonIdx + 2) : raw);
    }
  };

  const handleChangeRole = async (userId: string, role: string) => {
    await updateMember.mutateAsync({ teamId, userId, data: { role } });
    invalidate();
  };

  const handleConfirmRemoveMember = async () => {
    if (!memberToRemove?.userId) return;
    await removeMember.mutateAsync({ teamId, userId: memberToRemove.userId });
    setMemberToRemove(null);
    invalidate();
  };

  const handleCancelInvite = async (inviteId: string) => {
    await cancelInvite.mutateAsync({ teamId, inviteId });
    invalidate();
  };

  const handleDelete = async () => {
    await deleteTeam.mutateAsync({ teamId });
    queryClient.invalidateQueries({ queryKey: getListTeamsQueryKey() });
    navigate("/dashboard");
  };

  const inviteUrl = team?.inviteToken
    ? `${window.location.origin}${basePath}/join/${team.inviteToken}`
    : null;

  const handleCopyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = inviteUrl;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2000);
  };

  const handleRefreshInvite = async () => {
    const updated = await refreshInvite.mutateAsync({ teamId });
    queryClient.invalidateQueries({ queryKey: getGetTeamQueryKey(teamId) });
    queryClient.setQueryData(getGetTeamQueryKey(teamId), updated);
  };

  const handleImageUpload = async (file: File) => {
    setImageUploading(true);
    try {
      const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type || "image/jpeg" }
      });
      await uploadFileToStorage({
        uploadURL,
        file,
        contentType: file.type || "image/jpeg",
      });
      const publicUrl = `/api/storage${objectPath}`;
      const updated = await updateTeam.mutateAsync({ teamId, data: { imageUrl: publicUrl } });
      updateTeamCaches(updated);
      invalidate();
    } catch (err) {
      console.error("Team image upload error:", err);
    } finally {
      setImageUploading(false);
    }
  };

  if (teamLoading) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Team not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
          </button>
          <div>
            <h1 className="text-base font-semibold text-foreground">{team.name}</h1>
            <p className="text-xs text-muted-foreground capitalize">{team.memberCount} member{team.memberCount !== 1 ? "s" : ""} · Your role: {currentRole}</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        {/* Team profile */}
        {isOwnerOrAdmin && (
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-3">Team profile</h2>
            <div className="flex items-center gap-4">
              <div
                className="relative w-16 h-16 rounded-lg overflow-hidden cursor-pointer group/img bg-muted flex-shrink-0"
                onClick={() => imageInputRef.current?.click()}
                title="Change team image"
              >
                {team.imageUrl ? (
                  <img src={team.imageUrl} alt={team.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-muted-foreground">
                    {team.name[0]?.toUpperCase()}
                  </div>
                )}
                <div className={`absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity ${imageUploading ? "opacity-100" : "opacity-75 group-hover/img:opacity-100"}`}>
                  {imageUploading ? (
                    <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                    </svg>
                  )}
                </div>
              </div>
              <div>
                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="text-xs font-medium text-foreground hover:text-primary transition-colors"
                >
                  Change team image
                </button>
                <p className="text-xs text-muted-foreground mt-0.5">PNG, JPG up to 5MB</p>
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) handleImageUpload(e.target.files[0]); }}
              />
            </div>
          </section>
        )}

        {/* Team name */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Team name</h2>
          {isEditingName ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setIsEditingName(false); }}
                className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={handleRename}
                disabled={!teamName.trim() || updateTeam.isPending}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={() => setIsEditingName(false)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
              <span className="text-sm text-foreground">{team.name}</span>
              {isOwnerOrAdmin && (
                <button
                  onClick={() => { setTeamName(team.name); setIsEditingName(true); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Rename
                </button>
              )}
            </div>
          )}
        </section>

        {/* Members */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Members</h2>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {membersLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading...</div>
            ) : (
              <>
                {activeMembers.map((member, i) => (
                  <div
                    key={member.userId ?? member.email}
                    className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-border" : ""}`}
                  >
                    <UserAvatar avatarUrl={member.avatarUrl} name={member.displayName ?? member.email} seed={member.email} size={36} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground font-medium truncate">{member.displayName ?? member.email}</p>
                      <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isOwnerOrAdmin && member.role !== "owner" && member.userId ? (
                        <select
                          value={member.role}
                          onChange={(e) => handleChangeRole(member.userId!, e.target.value)}
                          className="text-xs bg-transparent border border-border rounded px-2 py-1 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="admin">admin</option>
                          <option value="member">member</option>
                        </select>
                      ) : (
                        <RoleBadge role={member.role} />
                      )}
                      {isOwnerOrAdmin && member.role !== "owner" && member.userId && (
                        <button
                          onClick={() => setMemberToRemove(member)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="Remove member"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Pending invites */}
                {isOwnerOrAdmin && pendingInvites.map((inv, i) => (
                  <div
                    key={inv.inviteId ?? inv.email}
                    className={`flex items-center gap-3 px-4 py-3 border-t border-border bg-muted/20`}
                  >
                    <div
                      className="rounded-full bg-muted/60 flex items-center justify-center text-xs font-medium text-muted-foreground flex-shrink-0"
                      style={{ width: 36, height: 36 }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground">
                        <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-muted-foreground truncate">{inv.email}</p>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 whitespace-nowrap">
                          Invite pending
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground/60">Pending invitation · role: {inv.role}</p>
                    </div>
                    <button
                      onClick={() => inv.inviteId && handleCancelInvite(inv.inviteId)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      title="Cancel invite"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                      </svg>
                    </button>
                  </div>
                ))}

                {!membersLoading && activeMembers.length === 0 && pendingInvites.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">No members yet.</div>
                )}
              </>
            )}
          </div>
        </section>

        {/* Invite link */}
        {isOwnerOrAdmin && inviteUrl && (
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-3">Invite link</h2>
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Anyone with this link can join {team.name} as a member.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <div className="flex-1 min-w-0 bg-background border border-border rounded-lg px-3 py-2">
                  <p className="text-xs text-muted-foreground font-mono truncate">{inviteUrl}</p>
                </div>
                <button
                  onClick={handleCopyInvite}
                  className={`w-full sm:w-auto flex-shrink-0 flex items-center justify-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg border transition-colors ${
                    copiedInvite
                      ? "bg-primary/10 border-primary text-primary"
                      : "border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {copiedInvite ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                      <span className="sm:hidden">Copy</span>
                      <span className="hidden sm:inline">Copy link</span>
                    </>
                  )}
                </button>
              </div>
              <button
                onClick={handleRefreshInvite}
                disabled={refreshInvite.isPending}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              >
                {refreshInvite.isPending ? "Resetting…" : "Reset link (invalidates old link)"}
              </button>
            </div>
          </section>
        )}

        {/* Invite member by email */}
        {isOwnerOrAdmin && (
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-3">Invite by email</h2>
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Send a direct team invitation to a collaborator.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => { setInviteEmail(e.target.value); setInviteError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                  placeholder="name@example.com"
                  className="w-full sm:flex-1 min-w-0 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full sm:w-auto bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={handleInvite}
                  disabled={!inviteEmail.trim() || addMember.isPending}
                  className="w-full sm:w-auto px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity whitespace-nowrap"
                >
                  {addMember.isPending ? "Sending..." : "Send invite"}
                </button>
              </div>
              {inviteError && <p className="text-xs text-destructive">{inviteError}</p>}
            </div>
          </section>
        )}

        {/* Danger zone */}
        {currentRole === "owner" && (
          <section>
            <h2 className="text-sm font-semibold text-destructive mb-3">Danger zone</h2>
            <div className="bg-card border border-destructive/30 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-foreground font-medium">Delete team</p>
                <p className="text-xs text-muted-foreground mt-0.5">This will permanently delete the team and all team projects.</p>
              </div>
              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full sm:w-auto px-3 py-1.5 text-xs font-medium border border-destructive/50 text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
                >
                  Delete
                </button>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-xs text-muted-foreground text-center sm:text-left">Are you sure?</span>
                  <button
                    onClick={handleDelete}
                    disabled={deleteTeam.isPending}
                    className="w-full sm:w-auto px-3 py-1.5 text-xs font-medium bg-destructive text-white rounded-lg hover:opacity-90 disabled:opacity-40"
                  >
                    {deleteTeam.isPending ? "Deleting..." : "Yes, delete"}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="w-full sm:w-auto px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
      {memberToRemove && (
        <ConfirmDialog
          title="Remove team member?"
          description={`${memberToRemove.displayName || memberToRemove.email} will lose access to this team and its projects.`}
          confirmLabel="Remove member"
          isLoading={removeMember.isPending}
          onCancel={() => setMemberToRemove(null)}
          onConfirm={handleConfirmRemoveMember}
        />
      )}
    </div>
  );
}
