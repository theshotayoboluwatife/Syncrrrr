import React, { useRef, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import {
  useListProjects, useCreateProject, getListProjectsQueryKey,
  useListTeams, useCreateTeam, getListTeamsQueryKey,
  useCreateMyTrack,
  useCreateTeamTrack,
  useUpdateMyTrack,
  useUpdateTeamTrack,
  useRequestUploadUrl,
  getListMyTracksQueryKey,
  getListTeamTracksQueryKey,
  type ProjectSummary,
  type TeamSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Logo } from "@/components/Logo";
import { SignOutConfirmDialog } from "@/components/SignOutConfirmDialog";
import { UserAvatar } from "@/components/UserAvatar";
import { ProjectCover } from "@/lib/svg-generator";
import { getAuthAvatarUrl, getAuthDisplayName } from "@/lib/auth-user";
import { analyzeAudioFile, extractCoverArt } from "@/lib/audio-analyzer";
import { AUDIO_FILE_ACCEPT, splitAudioFiles } from "@/lib/file-accept";
import { uploadFileToStorage } from "@/lib/storage-upload";
import { toast } from "@/hooks/use-toast";

const WORKSPACE_KEY = "syncr_workspace";

function CreateProjectDialog({
  onClose,
  onCreated,
  teamId,
}: {
  onClose: () => void;
  onCreated: () => void;
  teamId?: string | null;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const createProject = useCreateProject();

  const handleCreate = async () => {
    if (!title.trim()) return;
    await createProject.mutateAsync({
      data: { title: title.trim(), description: description.trim() || null, teamId: teamId ?? null },
    });
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-card border border-border rounded-xl p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground mb-4">New project</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Project name</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="My debut EP"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project?"
              rows={2}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground resize-none"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || createProject.isPending}
            className="flex-1 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {createProject.isPending ? "Creating..." : "Create"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function CreateTeamDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (team: TeamSummary) => void }) {
  const [name, setName] = useState("");
  const createTeam = useCreateTeam();

  const handleCreate = async () => {
    if (!name.trim()) return;
    const team = await createTeam.mutateAsync({ data: { name: name.trim() } });
    onCreated(team);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-card border border-border rounded-xl p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground mb-1">Create a team</h2>
        <p className="text-xs text-muted-foreground mb-4">Teams share one library and can have multiple projects.</p>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Team name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Team name"
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || createTeam.isPending}
            className="flex-1 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {createTeam.isPending ? "Creating..." : "Create team"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function TeamAvatar({ name, imageUrl, size = 28 }: { name: string; imageUrl?: string | null; size?: number }) {
  if (imageUrl) {
    return (
      <div className="rounded-md overflow-hidden flex-shrink-0" style={{ width: size, height: size }}>
        <img src={imageUrl} alt={name} className="w-full h-full object-cover" />
      </div>
    );
  }
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const colors = ["#7c3aed", "#0ea5e9", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div
      className="rounded-md flex items-center justify-center text-white font-bold flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38, background: color }}
    >
      {initials}
    </div>
  );
}

function TeamManageIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 19v-1.2c0-2.2 1.8-4 4-4h1.4" />
      <path d="M9 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M15 9.2a2.4 2.4 0 1 0 0-4.8" />
      <path d="M16.4 19.1H14v-2.4l4.7-4.7 2.4 2.4-4.7 4.7z" />
      <path d="m17.8 12.9 2.4 2.4" />
    </svg>
  );
}

function ProjectCard({ project, onClick, index }: { project: ProjectSummary; onClick: () => void; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="group cursor-pointer"
      onClick={onClick}
    >
      {/* Album art */}
      <div className="relative rounded-lg overflow-hidden aspect-square mb-3 bg-[#282828] shadow-lg group-hover:shadow-2xl transition-shadow">
        <ProjectCover coverImageUrl={project.coverImageUrl} fill />
        {/* Hover play button */}
        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-primary flex items-center justify-center shadow-xl opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-200">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-black ml-0.5">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>
      {/* Text */}
      <div className="px-1">
        <p className="text-sm font-semibold text-foreground line-clamp-2 sm:truncate sm:line-clamp-none group-hover:text-white transition-colors leading-tight min-h-[2.25rem] sm:min-h-0">
          {project.title}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {project.trackCount} track{project.trackCount !== 1 ? "s" : ""}
          {project.sequenceCount > 0 && ` · ${project.sequenceCount} sequence${project.sequenceCount !== 1 ? "s" : ""}`}
        </p>
        <div className="mt-2 flex items-center gap-1.5 min-w-0">
          <UserAvatar
            avatarUrl={project.creatorAvatarUrl}
            name={project.creatorDisplayName}
            seed={project.createdBy}
            size={18}
            className="ring-1 ring-border/40"
          />
          <span className="text-[11px] text-muted-foreground truncate">{project.creatorDisplayName}</span>
        </div>
      </div>
    </motion.div>
  );
}

export function Dashboard() {
  const [, navigate] = useLocation();
  const { user, signOut } = useAuth();
  const { data: projects, isLoading } = useListProjects({
    query: {
      refetchOnMount: "always",
    },
  });
  const { data: teams, isLoading: teamsLoading } = useListTeams();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestUploadUrl = useRequestUploadUrl();
  const createMyTrack = useCreateMyTrack();
  const createTeamTrack = useCreateTeamTrack();
  const updateMyTrack = useUpdateMyTrack();
  const updateTeamTrack = useUpdateTeamTrack();
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [showMobileCreateMenu, setShowMobileCreateMenu] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [quickUpload, setQuickUpload] = useState<{ label: string; progress: number } | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const teamFromUrl = params.get("team");
    return teamFromUrl || localStorage.getItem(WORKSPACE_KEY) || "personal";
  });

  useEffect(() => {
    localStorage.setItem(WORKSPACE_KEY, selectedWorkspaceId);
  }, [selectedWorkspaceId]);

  const currentTeam = teams?.find((t) => t.id === selectedWorkspaceId) ?? null;

  const filteredProjects = projects?.filter((p) =>
    selectedWorkspaceId === "personal" ? p.teamId == null : p.teamId === selectedWorkspaceId
  );

  const handleCreated = () => {
    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
  };

  const handleTeamCreated = (team: TeamSummary) => {
    queryClient.invalidateQueries({ queryKey: getListTeamsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    setSelectedWorkspaceId(team.id);
  };

  const openQuickUpload = () => {
    setShowMobileCreateMenu(false);
    fileInputRef.current?.click();
  };

  const handleQuickUpload = async (files: FileList | null) => {
    if (!files) return;
    const { accepted, rejected } = splitAudioFiles(Array.from(files));
    if (rejected.length > 0) {
      toast({
        title: "Only audio tracks can be uploaded",
        description: "Choose MP3, WAV, M4A, AAC, FLAC, OGG, AIFF, or AIF tracks.",
      });
    }
    if (accepted.length === 0) return;

    for (let i = 0; i < accepted.length; i++) {
      const file = accepted[i];
      const label = accepted.length > 1 ? `Uploading ${i + 1}/${accepted.length}` : "Uploading track";
      setQuickUpload({ label, progress: 0 });
      try {
        const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync({
          data: { name: file.name, size: file.size, contentType: file.type || "audio/mpeg" },
        });
        await uploadFileToStorage({
          uploadURL,
          file,
          contentType: file.type || "audio/mpeg",
          onProgress: (progress) => setQuickUpload({ label, progress }),
        });

        let coverObjectPath: string | null = null;
        try {
          const coverBlob = await extractCoverArt(file);
          if (coverBlob) {
            const ext = coverBlob.type === "image/png" ? "png" : "jpg";
            const cover = await requestUploadUrl.mutateAsync({
              data: {
                name: file.name.replace(/\.[^.]+$/, "") + ".cover." + ext,
                size: coverBlob.size,
                contentType: coverBlob.type,
              },
            });
            await uploadFileToStorage({
              uploadURL: cover.uploadURL,
              file: coverBlob,
              contentType: coverBlob.type,
            });
            coverObjectPath = `/api/storage${cover.objectPath}`;
          }
        } catch (err) {
          console.warn("Cover art upload failed:", err);
        }

        const title = file.name.replace(/\.[^.]+$/, "");
        if (currentTeam) {
          const { id: trackId } = await createTeamTrack.mutateAsync({
            teamId: currentTeam.id,
            data: { title, fileUrl: objectPath, coverImageUrl: coverObjectPath, analyzed: false },
          });
          queryClient.invalidateQueries({ queryKey: getListTeamTracksQueryKey(currentTeam.id) });
          try {
            const { bpm, camelotKey, durationSeconds } = await analyzeAudioFile(file);
            await updateTeamTrack.mutateAsync({
              teamId: currentTeam.id,
              trackId,
              data: {
                bpm: bpm ?? undefined,
                camelotKey: camelotKey ?? undefined,
                durationSeconds: durationSeconds ?? undefined,
                analyzed: true,
              },
            });
            queryClient.invalidateQueries({ queryKey: getListTeamTracksQueryKey(currentTeam.id) });
          } catch (err) {
            console.warn("Track analysis failed:", err);
          }
        } else {
          const { id: trackId } = await createMyTrack.mutateAsync({
            data: { title, fileUrl: objectPath, coverImageUrl: coverObjectPath, analyzed: false },
          });
          queryClient.invalidateQueries({ queryKey: getListMyTracksQueryKey() });
          try {
            const { bpm, camelotKey, durationSeconds } = await analyzeAudioFile(file);
            await updateMyTrack.mutateAsync({
              trackId,
              data: {
                bpm: bpm ?? undefined,
                camelotKey: camelotKey ?? undefined,
                durationSeconds: durationSeconds ?? undefined,
                analyzed: true,
              },
            });
            queryClient.invalidateQueries({ queryKey: getListMyTracksQueryKey() });
          } catch (err) {
            console.warn("Track analysis failed:", err);
          }
        }
      } catch (err) {
        console.error("Quick upload failed:", err);
        toast({
          title: "Upload failed",
          description: "Try again in a moment.",
        });
      }
    }
    setQuickUpload(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOut();
    setIsSigningOut(false);
    setShowSignOutConfirm(false);
    navigate("/sign-in");
  };

  const displayName = getAuthDisplayName(user);
  const avatarUrl = getAuthAvatarUrl(user);

  return (
    <div className="h-full bg-background flex overflow-hidden">
      {/* Left sidebar — desktop only */}
      <div className="hidden sm:flex w-60 flex-shrink-0 bg-[#111] border-r border-border flex-col">
        {/* Logo */}
        <div className="px-5 py-5 flex items-center border-b border-border">
          <Logo size={26} />
        </div>

        {/* Workspaces */}
        <div className="flex-1 overflow-y-auto py-4 px-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-2 mb-3">Workspaces</p>

          {/* Personal */}
          <button
            onClick={() => setSelectedWorkspaceId("personal")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all group ${
              selectedWorkspaceId === "personal"
                ? "bg-white/10 text-white"
                : "text-muted-foreground hover:text-white hover:bg-white/5"
            }`}
          >
            <UserAvatar avatarUrl={avatarUrl} name={displayName} seed={user?.id} size={32} />
            <span className="truncate font-medium">Personal</span>
          </button>

          {/* Teams */}
          {!teamsLoading && (teams?.length ?? 0) > 0 && (
            <div className="mt-4">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-2 mb-2">Teams</p>
              {teams?.map((team) => (
                <div key={team.id} className="group/item relative">
                  <button
                    onClick={() => setSelectedWorkspaceId(team.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                      selectedWorkspaceId === team.id
                        ? "bg-white/10 text-white"
                        : "text-muted-foreground hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <TeamAvatar name={team.name} imageUrl={team.imageUrl} size={32} />
                    <span className="truncate flex-1 text-left font-medium">{team.name}</span>
                  </button>
                  {selectedWorkspaceId === team.id && (
                    <button
                      onClick={() => navigate(`/teams/${team.id}/settings`)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-white bg-[#111]/80 transition-colors"
                      title="Team settings"
                    >
                      <TeamManageIcon size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Create team + user */}
        <div className="p-3 border-t border-border space-y-1">
          <button
            onClick={() => setShowCreateTeam(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs text-muted-foreground hover:text-white hover:bg-white/5 transition-all"
          >
            <div className="w-6 h-6 rounded border border-border flex items-center justify-center flex-shrink-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
            </div>
            <span>New team</span>
          </button>
          <div className="w-full flex items-center gap-1 group">
            <button
              onClick={() => navigate("/account")}
              className="flex-1 flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs text-muted-foreground hover:text-white hover:bg-white/5 transition-all min-w-0"
              title="Account & settings"
            >
              <UserAvatar avatarUrl={avatarUrl} name={displayName} seed={user?.id} size={24} />
              <span className="truncate">{displayName}</span>
            </button>
            <button
              onClick={() => setShowSignOutConfirm(true)}
              title="Sign out"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-white/5 transition-all flex-shrink-0"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Doodle bg layer — very subtle */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage: `url(${import.meta.env.BASE_URL}doodle-bg.png)`,
            backgroundSize: "640px auto",
            backgroundRepeat: "repeat",
          }}
        />
        {/* Spacer so children stack above the bg layer */}
        <div className="relative flex-1 flex flex-col overflow-hidden">
        {/* Mobile header */}
        <div className="flex sm:hidden items-center justify-between gap-3 px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center">
            <Logo size={22} />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => navigate(currentTeam ? `/teams/${currentTeam.id}/library` : "/library")}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-primary/12 text-primary hover:bg-primary/20 border border-primary/30 transition-colors"
              title={currentTeam ? "Team library" : "Personal library"}
              aria-label={currentTeam ? "Team library" : "Personal library"}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 7.5h11.5a2.5 2.5 0 0 1 0 5H8.5a2.5 2.5 0 0 0 0 5H19" />
                <path d="M5 12.5h4" />
                <path d="M15 17.5h4" />
                <path d="M18.5 6.5v2" />
                <path d="M18.5 16.5v2" />
              </svg>
            </button>
            {currentTeam && (
              <button
                onClick={() => navigate(`/teams/${currentTeam.id}/settings`)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/8 text-foreground hover:bg-white/12 border border-border/60 transition-colors"
                title="Team settings"
                aria-label="Team settings"
              >
                <TeamManageIcon size={14} />
              </button>
            )}
            <button
              onClick={() => navigate("/account")}
              className="w-8 h-8 rounded-full bg-muted overflow-hidden flex items-center justify-center text-xs font-semibold text-foreground flex-shrink-0"
              title="Account & settings"
            >
              <UserAvatar avatarUrl={avatarUrl} name={displayName} seed={user?.id} size={32} />
            </button>
          </div>
        </div>

        {/* Mobile workspace selector */}
        <div className="flex sm:hidden items-center gap-2 px-4 py-2.5 border-b border-border overflow-x-auto flex-shrink-0 scrollbar-none">
          <button
            onClick={() => setSelectedWorkspaceId("personal")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap flex-shrink-0 transition-all font-medium ${
              selectedWorkspaceId === "personal"
                ? "bg-white text-black"
                : "text-muted-foreground bg-white/10 hover:bg-white/15"
            }`}
          >
            <div className="w-4 h-4 rounded-full bg-muted overflow-hidden flex items-center justify-center text-[10px]">
              <UserAvatar avatarUrl={avatarUrl} name={displayName} seed={user?.id} size={16} />
            </div>
            Personal
          </button>
          {teams?.map(team => (
            <button
              key={team.id}
              onClick={() => setSelectedWorkspaceId(team.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap flex-shrink-0 transition-all font-medium ${
                selectedWorkspaceId === team.id
                  ? "bg-white text-black"
                  : "text-muted-foreground bg-white/10 hover:bg-white/15"
              }`}
            >
              <TeamAvatar name={team.name} imageUrl={team.imageUrl} size={16} />
              {team.name}
            </button>
          ))}
        </div>

        {/* Desktop top bar */}
        <div className="hidden sm:flex items-center justify-between px-6 py-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-foreground">
              {currentTeam ? currentTeam.name : "Your Library"}
            </h1>
            {currentTeam && (
              <span className="text-xs text-muted-foreground bg-white/10 px-2.5 py-1 rounded-full capitalize font-medium">
                {currentTeam.role}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={openQuickUpload}
              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary border border-primary/30 hover:border-primary/60 bg-primary/10 hover:bg-primary/15 px-3 py-1.5 rounded-full transition-all font-medium"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17.5h9.2a4.3 4.3 0 0 0 .5-8.57A6 6 0 0 0 5.34 7.3 4.9 4.9 0 0 0 7 17.5z" />
                <path d="M12 17V10" />
                <path d="m8.9 13.1 3.1-3.1 3.1 3.1" />
              </svg>
              Upload track
            </button>
            {!currentTeam && (
              <button
                onClick={() => navigate(`/library`)}
                className="flex items-center gap-1.5 text-xs text-foreground hover:text-white border border-border/60 hover:border-white/30 bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-full transition-all font-medium"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                Library
              </button>
            )}
            {currentTeam && (
              <>
                <button
                  onClick={() => navigate(`/teams/${currentTeam.id}/library`)}
                  className="flex items-center gap-1.5 text-xs text-foreground hover:text-white border border-border/60 hover:border-white/30 bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-full transition-all font-medium"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                  </svg>
                  Library
                </button>
                <button
                  onClick={() => navigate(`/teams/${currentTeam.id}/settings`)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white border border-border/60 hover:border-white/20 px-3 py-1.5 rounded-full transition-all"
                >
                  <TeamManageIcon size={13} />
                  Settings
                </button>
              </>
            )}
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 text-sm bg-primary text-primary-foreground px-4 py-2 rounded-full hover:opacity-90 transition-opacity font-semibold"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
              New project
            </button>
          </div>
        </div>

        {/* Projects grid */}
        <div className="flex-1 overflow-auto px-4 sm:px-6 pb-8">
          <div className="max-w-7xl mx-auto">
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="space-y-3">
                    <div className="aspect-square rounded-lg bg-white/5 animate-pulse" />
                    <div className="space-y-1.5 px-1">
                      <div className="h-3 bg-white/5 rounded animate-pulse w-3/4" />
                      <div className="h-2.5 bg-white/5 rounded animate-pulse w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredProjects && filteredProjects.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
                <AnimatePresence>
                  {filteredProjects.map((project, i) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      index={i}
                      onClick={() => navigate(`/projects/${project.id}`)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-5">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                  </svg>
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  {currentTeam ? `No projects in ${currentTeam.name} yet` : "No projects yet"}
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  {currentTeam
                    ? "Create a project to start sequencing tracks from your team library."
                    : "Start a project to upload tracks and build sequences."}
                </p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="text-sm bg-primary text-primary-foreground px-5 py-2 rounded-full hover:opacity-90 transition-opacity font-semibold"
                >
                  Create project
                </button>
              </div>
            )}
          </div>
        </div>
        </div>

        {/* Mobile create FAB */}
        <div className="sm:hidden fixed right-4 bottom-24 z-40 flex flex-col items-end gap-3">
          <AnimatePresence>
            {showMobileCreateMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                className="w-56 rounded-2xl border border-border bg-card/95 shadow-2xl shadow-black/40 backdrop-blur overflow-hidden"
              >
                <button
                  onClick={() => {
                    setShowMobileCreateMenu(false);
                    setShowCreate(true);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-foreground hover:bg-white/8 transition-colors"
                >
                  <span className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 5h14v14H5z" />
                      <path d="M12 8v8" />
                      <path d="M8 12h8" />
                    </svg>
                  </span>
                  <span className="font-semibold">New project</span>
                </button>
                <div className="h-px bg-border" />
                <button
                  onClick={() => {
                    setShowMobileCreateMenu(false);
                    setShowCreateTeam(true);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-foreground hover:bg-white/8 transition-colors"
                >
                  <span className="w-9 h-9 rounded-full bg-white/10 text-foreground flex items-center justify-center flex-shrink-0">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                    </svg>
                  </span>
                  <span className="font-semibold">New team</span>
                </button>
                <div className="h-px bg-border" />
                <button
                  onClick={openQuickUpload}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-foreground hover:bg-white/8 transition-colors"
                >
                  <span className="w-9 h-9 rounded-full bg-primary/15 text-primary border border-primary/30 flex items-center justify-center flex-shrink-0">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 17.5h9.2a4.3 4.3 0 0 0 .5-8.57A6 6 0 0 0 5.34 7.3 4.9 4.9 0 0 0 7 17.5z" />
                      <path d="M12 17V10" />
                      <path d="m8.9 13.1 3.1-3.1 3.1 3.1" />
                    </svg>
                  </span>
                  <span className="font-semibold">Upload track</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={() => setShowMobileCreateMenu((open) => !open)}
            className="w-14 h-14 rounded-full bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.22),transparent_32%),linear-gradient(135deg,hsl(var(--primary)),#16a34a)] text-primary-foreground shadow-2xl shadow-black/50 ring-1 ring-primary/40 flex items-center justify-center active:scale-95 transition-transform"
            title="Create"
            aria-label={showMobileCreateMenu ? "Close create menu" : "Create project or team"}
            aria-expanded={showMobileCreateMenu}
          >
            <motion.svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              animate={{ rotate: showMobileCreateMenu ? 90 : 0 }}
              transition={{ duration: 0.18 }}
            >
              {showMobileCreateMenu ? (
                <>
                  <path d="M7 7l10 10" />
                  <path d="M17 7 7 17" />
                </>
              ) : (
                <>
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </>
              )}
            </motion.svg>
          </button>
        </div>
        {quickUpload && (
          <div className="fixed right-4 bottom-40 sm:bottom-6 z-40 w-56 rounded-xl border border-border bg-card/95 p-3 shadow-xl shadow-black/30 backdrop-blur">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-xs font-medium text-foreground">{quickUpload.label}</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{Math.round(quickUpload.progress)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${quickUpload.progress}%` }} />
            </div>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={AUDIO_FILE_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => handleQuickUpload(e.target.files)}
        />
      </div>

      <AnimatePresence>
        {showCreate && (
          <CreateProjectDialog
            onClose={() => setShowCreate(false)}
            onCreated={handleCreated}
            teamId={currentTeam?.id ?? null}
          />
        )}
        {showCreateTeam && (
          <CreateTeamDialog
            onClose={() => setShowCreateTeam(false)}
            onCreated={handleTeamCreated}
          />
        )}
        {showSignOutConfirm && (
          <SignOutConfirmDialog
            isSigningOut={isSigningOut}
            onCancel={() => setShowSignOutConfirm(false)}
            onConfirm={handleSignOut}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
