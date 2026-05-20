import React, { useState, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useGetProject,
  useListTracks,
  useListTeamTracks,
  useListSequences,
  useGetSequence,
  useCreateTrack,
  useCreateSequence,
  useDeleteTrack,
  useDeleteProject,
  useDeleteSequence,
  useDuplicateSequence,
  useUpdateSequence,
  useUpdateProject,
  useAddTrackToSequence,
  useRemoveTrackFromSequence,
  useReorderSequenceTracks,
  useRequestUploadUrl,
  useUpdateTrack,
  useAddTeamTrackToProject,
  useAddMyTrackToProject,
  useListMyTracks,
  useListProjectMembers,
  useAddProjectMember,
  useRemoveProjectMember,
  useListTeamMembers,
  useListTeams,
  getListProjectsQueryKey,
  getListProjectMembersQueryKey,
  getListTracksQueryKey,
  getListTeamTracksQueryKey,
  getListSequencesQueryKey,
  getGetSequenceQueryKey,
  getGetProjectQueryKey,
} from "@workspace/api-client-react";
import type { Track, SequenceTrack } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { analyzeAudioFile, extractCoverArt } from "@/lib/audio-analyzer";
import { ProjectCover } from "@/lib/svg-generator";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { audioCacheService } from "@/lib/audio-cache";
import { uploadFileToStorage } from "@/lib/storage-upload";
import { reportError } from "@/lib/error-reporting";
import { UserAvatar } from "@/components/UserAvatar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/hooks/use-toast";
import { AUDIO_FILE_ACCEPT, splitAudioFiles } from "@/lib/file-accept";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function shareExpiryFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function formatShareExpiry(value?: string | null) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(s: number | null | undefined) {
  if (s == null || isNaN(s)) return "--:--";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function camelotColor(key: string | null) {
  if (!key) return "#555";
  const num = parseInt(key);
  const colors: Record<string, string> = {
    "1": "#e74c3c", "2": "#e67e22", "3": "#f1c40f", "4": "#2ecc71",
    "5": "#1abc9c", "6": "#3498db", "7": "#9b59b6", "8": "#e91e63",
    "9": "#ff5722", "10": "#4caf50", "11": "#00bcd4", "12": "#673ab7"
  };
  return colors[String(num)] || "#555";
}

// Shimmer skeleton for a loading track row
function UploaderAvatar({ name, avatarUrl, size = 22 }: { name: string | null | undefined; avatarUrl: string | null | undefined; size?: number }) {
  return <UserAvatar avatarUrl={avatarUrl} name={name || "Unknown uploader"} seed={name} size={size} className="ring-1 ring-border/40" title={name || "Unknown uploader"} />;
}

function TrackRowSkeleton({ index }: { index: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-md">
      <div className="w-4 flex-shrink-0" />
      <div className="w-6 flex-shrink-0" />
      <div className="w-8 h-8 rounded bg-muted/60 flex-shrink-0 animate-pulse" style={{ animationDelay: `${index * 60}ms` }} />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="h-3 rounded bg-muted/60 animate-pulse" style={{ width: `${45 + (index * 17) % 30}%`, animationDelay: `${index * 60}ms` }} />
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="w-12 h-3 rounded bg-muted/40 animate-pulse" style={{ animationDelay: `${index * 60 + 30}ms` }} />
        <div className="w-8 h-3 rounded bg-muted/40 animate-pulse" style={{ animationDelay: `${index * 60 + 60}ms` }} />
        <div className="w-10 h-3 rounded bg-muted/40 animate-pulse" style={{ animationDelay: `${index * 60 + 90}ms` }} />
      </div>
    </div>
  );
}

// Sortable sequence track row
function SortableTrackRow({
  track,
  index,
  onPlay,
  onActivate,
  onRemove,
  isPlaying,
  coverImageUrl,
}: {
  track: SequenceTrack;
  index: number;
  onPlay: () => void;
  onActivate: () => void;
  onRemove: () => void;
  isPlaying: boolean;
  coverImageUrl?: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: track.trackId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : transition,
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 50 : undefined,
    position: isDragging ? ("relative" as const) : undefined,
  };
  const pointerDownRef = React.useRef<{ x: number; y: number } | null>(null);
  const shouldIgnoreRowActivation = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return true;
    return !!target.closest("button,input,[data-drag-handle]");
  };
  const handleRowPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (shouldIgnoreRowActivation(event.target)) {
      pointerDownRef.current = null;
      return;
    }
    pointerDownRef.current = { x: event.clientX, y: event.clientY };
  };
  const handleRowPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!start || shouldIgnoreRowActivation(event.target)) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > 8) return;
    onActivate();
  };
  const handleRowClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button,input,[data-drag-handle]")) return;
    event.preventDefault();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onPointerDown={handleRowPointerDown}
      onPointerUp={handleRowPointerUp}
      onClick={handleRowClick}
      className={`flex items-center gap-2 sm:gap-3 px-2.5 sm:px-4 py-2.5 group cursor-pointer rounded-md ${isPlaying ? "bg-primary/10" : "hover:bg-accent/50"} transition-colors`}
    >
      <div
        {...attributes}
        {...listeners}
        data-drag-handle
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground opacity-40 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity touch-manipulation flex-shrink-0"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 9H4v2h16V9zm-16 6h16v-2H4v2z"/>
        </svg>
      </div>
      {/* Track number / play toggle */}
      <button
        onClick={onPlay}
        className="w-6 flex items-center justify-center flex-shrink-0 relative"
        title={isPlaying ? "Pause" : "Play"}
      >
        <span className={`text-xs tabular-nums transition-opacity ${isPlaying ? "opacity-0" : "text-muted-foreground group-hover:opacity-0"}`}>
          {index + 1}
        </span>
        <span className={`absolute inset-0 flex items-center justify-center transition-opacity ${isPlaying ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          {isPlaying ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-primary">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-foreground">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </span>
      </button>
      <div className="hidden sm:block w-8 h-8 rounded overflow-hidden flex-shrink-0">
        <ProjectCover coverImageUrl={coverImageUrl} size={32} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${isPlaying ? "text-primary font-medium" : "text-foreground"}`}>
          {track.title}
        </p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {track.bpm && (
          <span className="text-xs text-muted-foreground tabular-nums hidden group-hover:inline">
            {Math.round(track.bpm)} BPM
          </span>
        )}
        {track.camelotKey && (
          <span
            className="text-xs font-mono px-1.5 py-0.5 rounded"
            style={{ background: `${camelotColor(track.camelotKey)}22`, color: camelotColor(track.camelotKey) }}
          >
            {track.camelotKey}
          </span>
        )}
        <span className="text-xs text-muted-foreground tabular-nums">{formatDuration(track.durationSeconds)}</span>
        <button
          onClick={onRemove}
          className="w-7 h-7 sm:w-6 sm:h-6 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 flex items-center justify-center text-muted-foreground hover:text-foreground transition-all"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13H5v-2h14v2z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// Library track row
function LibraryTrackRow({
  track,
  onPlay,
  onActivate,
  onDelete,
  onAddToSequence,
  onRename,
  isPlaying,
  isAnalyzing,
  inSequence,
  hasActiveSequence,
  coverImageUrl,
}: {
  track: Track;
  onPlay: () => void;
  onActivate: () => void;
  onDelete: () => void;
  onAddToSequence?: () => void;
  onRename: (title: string) => void;
  isPlaying: boolean;
  isAnalyzing: boolean;
  inSequence?: boolean;
  hasActiveSequence?: boolean;
  coverImageUrl?: string | null;
}) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(track.title);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setEditValue(track.title);
    setIsEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 0);
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== track.title) onRename(trimmed);
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setEditValue(track.title);
    setIsEditing(false);
  };

  const rawCover = track.coverImageUrl ?? coverImageUrl ?? null;
  // Back-compat: older tracks stored bare "/objects/..." paths; the served route is /api/storage/objects/...
  const cover = rawCover && rawCover.startsWith("/objects/") ? `/api/storage${rawCover}` : rawCover;
  const [imgFailed, setImgFailed] = React.useState(false);
  React.useEffect(() => { setImgFailed(false); }, [cover]);
  const uploaderName = (track as Track & { uploaderName?: string | null }).uploaderName ?? null;
  const uploaderAvatarUrl = (track as Track & { uploaderAvatarUrl?: string | null }).uploaderAvatarUrl ?? null;
  const handleRowClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isEditing) return;
    const target = event.target as HTMLElement;
    if (target.closest("button,input")) return;
    onActivate();
  };

  return (
    <div
      onClick={handleRowClick}
      className={`flex items-center gap-2.5 px-2.5 py-2 group rounded-md ${
        isPlaying ? "bg-primary/10" : "hover:bg-accent/40"
      } transition-colors cursor-pointer`}
    >
      <button
        onClick={onPlay}
        className="relative w-9 h-9 rounded overflow-hidden flex-shrink-0 bg-gradient-to-br from-primary/30 to-primary/5 flex items-center justify-center"
        title={isPlaying ? "Pause" : "Play"}
      >
        {cover && !imgFailed ? (
          <img
            src={cover}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-primary/70">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
          </svg>
        )}
        <span className={`absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity ${isPlaying ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          {isPlaying ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
          )}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
              if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
            }}
            className="w-full bg-transparent border-b border-primary outline-none text-sm text-foreground pb-px"
            autoFocus
          />
        ) : (
          <p
            className={`text-sm truncate ${isPlaying ? "text-primary font-medium" : "text-foreground"}`}
            title={track.title}
          >
            {track.title}
          </p>
        )}
        {isAnalyzing && <p className="text-[10px] text-primary animate-pulse mt-0.5">Analyzing…</p>}
      </div>
      <div className="hidden sm:block flex-shrink-0" title={`Uploaded by ${uploaderName || "Unknown"}`}>
        <UploaderAvatar name={uploaderName} avatarUrl={uploaderAvatarUrl} size={20} />
      </div>
      <div className="flex items-center justify-end gap-0.5 flex-shrink-0">
        <button
          onClick={startEdit}
          className="hidden sm:flex w-7 h-7 rounded-full opacity-0 group-hover:opacity-100 items-center justify-center text-muted-foreground hover:text-foreground transition-all"
          title="Rename track"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
          </svg>
        </button>
        {hasActiveSequence && (
          inSequence ? (
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-primary"
              title="Already in sequence"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
            </div>
          ) : (
            <button
              onClick={onAddToSequence}
              className="w-7 h-7 rounded-full border border-border bg-muted hover:bg-primary hover:border-primary hover:text-primary-foreground flex items-center justify-center transition-colors text-muted-foreground"
              title="Add to sequence"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
            </button>
          )
        )}
        <button
          onClick={onDelete}
          className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground/80 hover:text-[#ff6b6b] hover:bg-white/5 transition-all"
          title="Delete track"
          aria-label={`Delete ${track.title}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M6 7l1 14h10l1-14" />
            <path d="M9 7V4h6v3" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function ProjectWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { play, currentTrack, isPlaying, pause, resume, playingSequenceId, setPlayingSource } = useAudioPlayer();

  const { data: project, isLoading: projectLoading } = useGetProject(projectId);
  const teamId = project?.teamId ?? null;
  // Project library is always project-scoped. Team tracks are loaded only for the "Add from team library" picker.
  const { data: tracks } = useListTracks(projectId);
  const { data: teamTracks } = useListTeamTracks(teamId ?? "", { query: { enabled: !!teamId } });
  const { data: myTracks } = useListMyTracks();
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [showMyPicker, setShowMyPicker] = useState(false);
  const [pickerSelection, setPickerSelection] = useState<Set<string>>(new Set());
  const [pickerAdding, setPickerAdding] = useState(false);
  React.useEffect(() => { if (!showTeamPicker && !showMyPicker) setPickerSelection(new Set()); }, [showTeamPicker, showMyPicker]);
  const { data: sequences, isLoading: sequencesLoading } = useListSequences(projectId);

  const [selectedSeqId, setSelectedSeqId] = useState<string | null>(null);
  const selectedSeqExists = !!selectedSeqId && (!sequences || sequences.some((seq) => seq.id === selectedSeqId));
  const { data: selectedSequence, isLoading: seqLoading } = useGetSequence(
    projectId,
    selectedSeqId || "",
    { query: { enabled: selectedSeqExists } }
  );
  const seqTrackCount = sequences?.find(s => s.id === selectedSeqId)?.trackCount ?? 5;
  const isSeqLoading = !!selectedSeqId && seqLoading;

  const [mobileTab, setMobileTab] = useState<"library" | "sequences">("sequences");
  const [cacheProgress, setCacheProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const cacheBatchRef = React.useRef<AbortController | null>(null);
  const [editingSeqName, setEditingSeqName] = useState(false);
  const [seqNameInput, setSeqNameInput] = useState("");
  const [renamingSeq, setRenamingSeq] = useState(false);
  const [linerNotesExpanded, setLinerNotesExpanded] = useState(false);
  const [editingLinerNotes, setEditingLinerNotes] = useState(false);
  const [linerNotesInput, setLinerNotesInput] = useState("");
  const [showEditDetails, setShowEditDetails] = useState(false);
  const [detailsTitle, setDetailsTitle] = useState("");
  const [detailsImageFile, setDetailsImageFile] = useState<File | null>(null);
  const [detailsImagePreview, setDetailsImagePreview] = useState<string | null>(null);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [creatingSequence, setCreatingSequence] = useState(false);
  const [sequenceToDelete, setSequenceToDelete] = useState<{ id: string; name: string } | null>(null);
  const [sequenceTrackToRemove, setSequenceTrackToRemove] = useState<{ trackId: string; title: string; sequenceId: string } | null>(null);
  const [libraryTrackToDelete, setLibraryTrackToDelete] = useState<{ id: string; title: string; isTeamLinked: boolean } | null>(null);

  // Team-owner per-project access control. The "Project access" section
  // inside the share modal is gated on (showShareModal && teamId && team owner).
  const { data: myTeams } = useListTeams({ query: { enabled: !!teamId } });
  const myTeamRole = myTeams?.find(t => t.id === teamId)?.role ?? null;
  const isTeamOwner = myTeamRole === "owner";
  const enableAccessUI = showShareModal && !!teamId && isTeamOwner;
  const { data: teamMembers } = useListTeamMembers(teamId ?? "", {
    query: { enabled: enableAccessUI },
  });
  const { data: projectMembers } = useListProjectMembers(projectId, {
    query: { enabled: enableAccessUI },
  });
  const addProjectMember = useAddProjectMember();
  const removeProjectMember = useRemoveProjectMember();
  const projectMemberIds = React.useMemo(
    () => new Set((projectMembers ?? []).map(m => m.userId)),
    [projectMembers]
  );
  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: getListProjectMembersQueryKey(projectId) });

  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadBatch, setUploadBatch] = useState<{ current: number; total: number } | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detailsImageInputRef = useRef<HTMLInputElement>(null);

  // Optimistic local track order for drag-and-drop (avoids snap-back)
  const [localOrderIds, setLocalOrderIds] = useState<string[] | null>(null);
  const [copiedShare, setCopiedShare] = useState(false);
  React.useEffect(() => { setLocalOrderIds(null); }, [selectedSeqId]);
  React.useEffect(() => {
    setEditingLinerNotes(false);
    setLinerNotesExpanded(false);
  }, [selectedSeqId]);
  React.useEffect(() => {
    if (localOrderIds && selectedSequence) {
      const serverOrder = selectedSequence.tracks.map(t => t.trackId).join(",");
      if (serverOrder === localOrderIds.join(",")) setLocalOrderIds(null);
    }
  }, [selectedSequence?.tracks, localOrderIds]);

  const displayTracks = React.useMemo(() => {
    if (!selectedSequence) return [];
    if (localOrderIds) {
      const map = new Map(selectedSequence.tracks.map(t => [t.trackId, t]));
      return localOrderIds.map(id => map.get(id)).filter(Boolean) as SequenceTrack[];
    }
    return selectedSequence.tracks;
  }, [selectedSequence, localOrderIds]);

  // Auto-fetch missing durations for tracks that have been analyzed but have no durationSeconds
  const fetchingDurations = React.useRef(new Set<string>());
  const updateTrackForDuration = useUpdateTrack();
  React.useEffect(() => {
    if (!tracks) return;
    const missing = tracks.filter(t => t.analyzed && t.durationSeconds == null);
    for (const track of missing) {
      if (fetchingDurations.current.has(track.id)) continue;
      fetchingDurations.current.add(track.id);
      const audio = new Audio();
      audio.preload = "metadata";
      const onLoaded = () => {
        const dur = audio.duration;
        if (dur && isFinite(dur)) {
          updateTrackForDuration
            .mutateAsync({ projectId, trackId: track.id, data: { durationSeconds: dur } })
            .then(() => invalidate())
            .catch(() => {});
        }
        audio.removeEventListener("loadedmetadata", onLoaded);
        audio.removeEventListener("error", onError);
        audio.src = "";
      };
      const onError = () => {
        fetchingDurations.current.delete(track.id);
        audio.removeEventListener("loadedmetadata", onLoaded);
        audio.removeEventListener("error", onError);
      };
      audio.addEventListener("loadedmetadata", onLoaded);
      audio.addEventListener("error", onError);
      audio.src = `/api/storage${track.fileUrl}`;
    }
  }, [tracks]); // eslint-disable-line react-hooks/exhaustive-deps

  const createTrack = useCreateTrack();
  const updateTrack = useUpdateTrack();
  const deleteTrack = useDeleteTrack();
  const addTeamTrackToProject = useAddTeamTrackToProject();
  const addMyTrackToProject = useAddMyTrackToProject();
  const createSequence = useCreateSequence();
  const deleteProject = useDeleteProject();
  const deleteSequence = useDeleteSequence();
  const duplicateSequence = useDuplicateSequence();
  const updateSequence = useUpdateSequence();
  const updateProject = useUpdateProject();
  const addTrackToSeq = useAddTrackToSequence();
  const removeTrackFromSeq = useRemoveTrackFromSequence();
  const reorderTracks = useReorderSequenceTracks();
  const requestUploadUrl = useRequestUploadUrl();

  React.useEffect(() => {
    if (!showEditDetails || !project) return;
    setDetailsTitle(project.title);
    setDetailsImageFile(null);
    setDetailsImagePreview(null);
    setConfirmDeleteProject(false);
  }, [showEditDetails, project?.id, project?.title, project?.coverImageUrl]);

  React.useEffect(() => {
    return () => {
      if (detailsImagePreview) URL.revokeObjectURL(detailsImagePreview);
    };
  }, [detailsImagePreview]);

  // Auto-select first sequence
  React.useEffect(() => {
    if (!sequences) return;
    if (selectedSeqId && !sequences.some((seq) => seq.id === selectedSeqId)) {
      setSelectedSeqId(sequences[0]?.id || null);
      return;
    }
    if (sequences.length > 0 && !selectedSeqId) {
      setSelectedSeqId(sequences[0].id);
    }
  }, [sequences, selectedSeqId]);

  // Background-cache the entire library when tracks load.
  // Runs once per tracks load; cancelled on unmount.
  React.useEffect(() => {
    if (!tracks || tracks.length === 0) return;
    const fileUrls = tracks.map(t => t.fileUrl);
    // Only cache tracks not already downloaded
    setCacheProgress(null);
    audioCacheService.countCached(fileUrls).then(already => {
      const uncached = fileUrls.filter(f => !audioCacheService.getBlobUrl(f));
      if (uncached.length === 0) return;
      // Report already-cached in the total so progress starts > 0
      const total = fileUrls.length;
      let downloaded = already;
      setCacheProgress({ downloaded, total });
      cacheBatchRef.current = audioCacheService.batchCache(uncached, {
        onProgress: (done, _batchTotal) => {
          downloaded = already + done;
          setCacheProgress({ downloaded, total });
          if (downloaded >= total) {
            setTimeout(() => setCacheProgress(null), 2000);
          }
        },
      });
    });
    return () => {
      cacheBatchRef.current?.abort();
    };
  }, [tracks]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the selected sequence changes, preload blob URLs for its tracks
  // so that any cached track plays instantly with no seek delay.
  React.useEffect(() => {
    if (!selectedSequence) return;
    const fileUrls = selectedSequence.tracks.map(t => t.fileUrl);
    audioCacheService.preloadSequence(fileUrls).catch(() => {});
  }, [selectedSequence]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListTracksQueryKey(projectId) });
    if (teamId) queryClient.invalidateQueries({ queryKey: getListTeamTracksQueryKey(teamId) });
    queryClient.invalidateQueries({ queryKey: getListSequencesQueryKey(projectId) });
    if (selectedSeqId) {
      queryClient.invalidateQueries({ queryKey: getGetSequenceQueryKey(projectId, selectedSeqId) });
    }
    queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
  }, [queryClient, projectId, teamId, selectedSeqId]);

  const updateProjectCaches = useCallback((updated: any) => {
    queryClient.setQueryData(getGetProjectQueryKey(projectId), updated);
    queryClient.setQueryData(getListProjectsQueryKey(), (old: any) =>
      Array.isArray(old)
        ? old.map((item) => (item.id === projectId ? { ...item, ...updated } : item))
        : old,
    );
  }, [queryClient, projectId]);

  const updateDashboardProjectCounts = useCallback((delta: { trackCount?: number; sequenceCount?: number }) => {
    queryClient.setQueryData(getListProjectsQueryKey(), (old: any) =>
      Array.isArray(old)
        ? old.map((item) => {
            if (item.id !== projectId) return item;
            return {
              ...item,
              ...(delta.trackCount
                ? { trackCount: Math.max(0, (item.trackCount ?? 0) + delta.trackCount) }
                : {}),
              ...(delta.sequenceCount
                ? { sequenceCount: Math.max(0, (item.sequenceCount ?? 0) + delta.sequenceCount) }
                : {}),
            };
          })
        : old,
    );
  }, [queryClient, projectId]);

  const handleUpload = async (files: FileList | null) => {
    if (!files) return;
    const { accepted: list, rejected } = splitAudioFiles(Array.from(files));
    if (rejected.length > 0) {
      toast({
        title: "Only audio tracks can be uploaded",
        description: "Choose MP3, WAV, M4A, AAC, FLAC, OGG, AIFF, or AIF tracks.",
      });
    }
    const total = list.length;
    if (total === 0) return;
    if (total > 1) setUploadBatch({ current: 0, total });
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (total > 1) setUploadBatch({ current: i + 1, total });
      try {
        const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync({
          data: { name: file.name, size: file.size, contentType: file.type || "audio/mpeg" }
        });

        await uploadFileToStorage({
          uploadURL,
          file,
          contentType: file.type || "audio/mpeg",
          onProgress: (percent) =>
            setUploadProgress((p) => ({ ...p, [file.name]: percent })),
        });

        setUploadProgress(p => { const n = { ...p }; delete n[file.name]; return n; });

        // Try to extract embedded cover art and upload it as a separate object.
        // Failures here must never block the track upload.
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
            // Store the full served URL ("/api/storage/objects/...") so <img src> works directly.
            coverObjectPath = `/api/storage${cover.objectPath}`;
          }
        } catch (e) {
          console.warn("Cover art upload failed (non-fatal):", e);
        }

        // Create track record first (without analysis). Server auto-inherits team_id when project has one.
        const trackName = file.name.replace(/\.[^.]+$/, "");
        const { id: trackId } = await createTrack.mutateAsync({
          projectId,
          data: { title: trackName, fileUrl: objectPath, coverImageUrl: coverObjectPath, analyzed: false },
        });
        updateDashboardProjectCounts({ trackCount: 1 });

        invalidate();

        // Now analyze in browser
        setAnalyzingIds(s => new Set(s).add(trackId));
        try {
          const { bpm, camelotKey, durationSeconds } = await analyzeAudioFile(file);
          await updateTrack.mutateAsync({
            projectId,
            trackId,
            data: { bpm: bpm ?? undefined, camelotKey: camelotKey ?? undefined, durationSeconds: durationSeconds ?? undefined, analyzed: true },
          });
          invalidate();
        } finally {
          setAnalyzingIds(s => { const n = new Set(s); n.delete(trackId); return n; });
        }
      } catch (err) {
        console.error("Upload error:", err);
        setUploadProgress(p => { const n = { ...p }; delete n[file.name]; return n; });
      }
    }
    setUploadBatch(null);
  };

  const handleCreateSequence = async () => {
    if (creatingSequence) return;
    setCreatingSequence(true);
    try {
      const seq = await createSequence.mutateAsync({
        projectId,
        data: { name: `Sequence ${(sequences?.length || 0) + 1}` }
      });
      if (tracks && tracks.length > 0) {
        await Promise.all(
          tracks.map(t =>
            addTrackToSeq.mutateAsync({ projectId, sequenceId: seq.id, data: { trackId: t.id } })
          )
        );
      }
      setSelectedSeqId(seq.id);
      updateDashboardProjectCounts({ sequenceCount: 1 });
      invalidate();
    } catch (error) {
      reportError(error, { area: "sequences", action: "create sequence" });
    } finally {
      setCreatingSequence(false);
    }
  };

  const handleDuplicateSeq = async () => {
    if (!selectedSeqId) return;
    const seq = await duplicateSequence.mutateAsync({ projectId, sequenceId: selectedSeqId });
    setSelectedSeqId(seq.id);
    updateDashboardProjectCounts({ sequenceCount: 1 });
    invalidate();
  };

  const handleDeleteSeq = async () => {
    if (!selectedSeqId || !sequences) return;
    const seq = sequences.find(s => s.id === selectedSeqId);
    setSequenceToDelete({ id: selectedSeqId, name: seq?.name || "this sequence" });
  };

  const handleConfirmDeleteSeq = async () => {
    if (!sequenceToDelete || !sequences) return;
    const deletingSequence = sequenceToDelete;
    const remaining = sequences.filter(s => s.id !== deletingSequence.id);
    const nextSeqId = remaining[0]?.id || null;

    setSequenceToDelete(null);
    setSelectedSeqId(nextSeqId);
    setLocalOrderIds(null);
    setLinerNotesExpanded(false);
    setEditingLinerNotes(false);
    setEditingSeqName(false);
    await queryClient.cancelQueries({ queryKey: getGetSequenceQueryKey(projectId, deletingSequence.id) });
    queryClient.removeQueries({ queryKey: getGetSequenceQueryKey(projectId, deletingSequence.id) });
    queryClient.setQueryData(getListSequencesQueryKey(projectId), remaining);

    try {
      await deleteSequence.mutateAsync({ projectId, sequenceId: deletingSequence.id });
    } catch (error) {
      setSelectedSeqId(deletingSequence.id);
      queryClient.setQueryData(getListSequencesQueryKey(projectId), sequences);
      reportError(error, { area: "sequences", action: "delete sequence" });
      return;
    }

    updateDashboardProjectCounts({ sequenceCount: -1 });
    invalidate();
  };

  const handleRenameSeq = async () => {
    if (renamingSeq) return;
    const sequenceId = selectedSeqId;
    const name = seqNameInput.trim();
    if (!sequenceId || !name) {
      setEditingSeqName(false);
      return;
    }
    const currentName = sequences?.find(s => s.id === sequenceId)?.name;
    if (name === currentName) {
      setEditingSeqName(false);
      return;
    }

    setRenamingSeq(true);
    try {
      const updated = await updateSequence.mutateAsync({ projectId, sequenceId, data: { name } });
      const nextName = updated.name ?? name;
      queryClient.setQueryData(getListSequencesQueryKey(projectId), (old: any) =>
        Array.isArray(old)
          ? old.map((seq) => (seq.id === sequenceId ? { ...seq, name: nextName } : seq))
          : old,
      );
      queryClient.setQueryData(getGetSequenceQueryKey(projectId, sequenceId), (old: any) =>
        old ? { ...old, name: nextName } : old,
      );
      queryClient.invalidateQueries({ queryKey: getListSequencesQueryKey(projectId) });
      queryClient.invalidateQueries({ queryKey: getGetSequenceQueryKey(projectId, sequenceId) });
      setEditingSeqName(false);
    } catch (error) {
      reportError(error, { area: "sequences", action: "rename sequence" });
      toast({
        title: "Could not update sequence",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRenamingSeq(false);
    }
  };

  const handleSaveLinerNotes = async () => {
    if (!selectedSeqId) { setEditingLinerNotes(false); return; }
    const updated = await updateSequence.mutateAsync({
      projectId,
      sequenceId: selectedSeqId,
      data: { linerNotes: linerNotesInput.trim() || null },
    });
    queryClient.setQueryData(getListSequencesQueryKey(projectId), (old: any) =>
      Array.isArray(old)
        ? old.map((seq) => (seq.id === selectedSeqId ? { ...seq, linerNotes: updated.linerNotes ?? null } : seq))
        : old,
    );
    queryClient.setQueryData(getGetSequenceQueryKey(projectId, selectedSeqId), (old: any) =>
      old ? { ...old, linerNotes: updated.linerNotes ?? null } : old,
    );
    queryClient.invalidateQueries({ queryKey: getListSequencesQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getGetSequenceQueryKey(projectId, selectedSeqId) });
    setEditingLinerNotes(false);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (!selectedSequence || !selectedSeqId) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const src = displayTracks;
    const oldIndex = src.findIndex(t => t.trackId === active.id);
    const newIndex = src.findIndex(t => t.trackId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...src];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    const newOrderIds = reordered.map(t => t.trackId);

    // Update locally first — no waiting, no snap-back
    setLocalOrderIds(newOrderIds);

    // Fire API in background
    reorderTracks.mutateAsync({
      projectId,
      sequenceId: selectedSeqId,
      data: { orderedTrackIds: newOrderIds }
    }).then(() => invalidate());
  };

  const handleAddToSeq = async (trackId: string) => {
    if (!selectedSeqId) return;
    await addTrackToSeq.mutateAsync({ projectId, sequenceId: selectedSeqId, data: { trackId } });
    invalidate();
    setMobileTab("sequences");
  };

  const handleRemoveFromSeq = async (trackId: string) => {
    if (!selectedSeqId) return;
    const t = selectedSequence?.tracks.find(st => st.trackId === trackId);
    setSequenceTrackToRemove({ trackId, title: t?.title || "this track", sequenceId: selectedSeqId });
  };

  const handleConfirmRemoveFromSeq = async () => {
    if (!sequenceTrackToRemove) return;
    await removeTrackFromSeq.mutateAsync({
      projectId,
      sequenceId: sequenceTrackToRemove.sequenceId,
      trackId: sequenceTrackToRemove.trackId,
    });
    setSequenceTrackToRemove(null);
    invalidate();
  };

  const playTrack = (
    track: Track | SequenceTrack,
    queue: (Track | SequenceTrack)[],
    sourceSeq?: { id: string; name: string } | null,
    options?: { restartIfCurrent?: boolean }
  ) => {
    const coverImageUrl = project?.coverImageUrl ?? null;
    const teamName = myTeams?.find(t => t.id === teamId)?.name ?? null;
    const toPlayerTrack = (t: Track | SequenceTrack) => ({
      id: "trackId" in t ? t.trackId : t.id,
      title: t.title,
      fileUrl: t.fileUrl,
      coverImageUrl,
      sourceType: "project" as const,
      sourceTitle: project?.title ?? "Project",
      sourceSubtitle: teamName ?? null,
      durationSeconds: t.durationSeconds,
      bpm: t.bpm,
      camelotKey: t.camelotKey,
    });
    const trackId = "trackId" in track ? track.trackId : track.id;
    if (currentTrack?.id === trackId && !options?.restartIfCurrent) {
      isPlaying ? pause() : resume();
    } else {
      play(toPlayerTrack(track), queue.map(toPlayerTrack));
      setPlayingSource({
        sequenceId: sourceSeq?.id ?? null,
        sequenceName: sourceSeq?.name ?? null,
      });
    }
  };

  const shareUrl = `${window.location.origin}${basePath}/share/${project?.shareToken}`;
  const canDeleteProject = teamId ? isTeamOwner : true;

  const handleShareDurationChange = async (days: number) => {
    const updated = await updateProject.mutateAsync({
      projectId,
      data: { shareExpiresAt: shareExpiryFromNow(days) },
    });
    updateProjectCaches(updated);
    invalidate();
  };

  const handleDetailsImageSelect = (file: File | undefined) => {
    if (!file) return;
    if (detailsImagePreview) URL.revokeObjectURL(detailsImagePreview);
    setDetailsImageFile(file);
    setDetailsImagePreview(URL.createObjectURL(file));
  };

  const handleSaveProjectDetails = async () => {
    if (!project) return;
    const title = detailsTitle.trim();
    if (!title) return;
    setDetailsSaving(true);
    try {
      const data: { title?: string; coverImageUrl?: string | null } = {};
      if (title !== project.title) data.title = title;
      if (detailsImageFile) {
        setCoverUploading(true);
        const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync({
          data: {
            name: detailsImageFile.name,
            size: detailsImageFile.size,
            contentType: detailsImageFile.type || "image/jpeg",
          },
        });
        await uploadFileToStorage({
          uploadURL,
          file: detailsImageFile,
          contentType: detailsImageFile.type || "image/jpeg",
        });
        data.coverImageUrl = `/api/storage${objectPath}`;
      }

      if (Object.keys(data).length > 0) {
        const updated = await updateProject.mutateAsync({ projectId, data });
        updateProjectCaches(updated);
        invalidate();
      }
      setShowEditDetails(false);
    } catch (error) {
      reportError(error, { area: "projects", action: "update project details" });
    } finally {
      setCoverUploading(false);
      setDetailsSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    await deleteProject.mutateAsync({ projectId });
    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    navigate(teamId ? `/dashboard?team=${teamId}` : "/dashboard");
  };

  const handleConfirmDeleteLibraryTrack = async () => {
    if (!libraryTrackToDelete) return;
    await deleteTrack.mutateAsync({ projectId, trackId: libraryTrackToDelete.id });
    setLibraryTrackToDelete(null);
    updateDashboardProjectCounts({ trackCount: -1 });
    invalidate();
  };

  if (projectLoading) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 border-b border-border flex-shrink-0">
        <button onClick={() => navigate("/dashboard")} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
        </button>

        <div className="relative w-9 h-9 rounded overflow-hidden flex-shrink-0">
          <ProjectCover coverImageUrl={project?.coverImageUrl} size={36} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{project?.title}</p>
          {project?.description && (
            <p className="hidden sm:block text-xs text-muted-foreground truncate">{project.description}</p>
          )}
        </div>

        <button
          onClick={() => setShowEditDetails(true)}
          className="flex items-center justify-center sm:gap-1.5 text-xs border border-border rounded-full w-9 h-9 sm:w-auto sm:h-auto sm:px-3 sm:py-1.5 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors flex-shrink-0"
          title="Edit details"
          aria-label="Edit details"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
          <span className="hidden sm:inline">Edit details</span>
        </button>

        <button
          onClick={() => setShowShareModal(true)}
          className="flex items-center justify-center sm:gap-1.5 text-xs border border-border rounded-full w-9 h-9 sm:w-auto sm:h-auto sm:px-3 sm:py-1.5 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors flex-shrink-0"
          title="Share"
          aria-label="Share"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
          </svg>
          <span className="hidden sm:inline">Share</span>
        </button>
      </div>

      {/* Mobile tab bar */}
      <div className="flex sm:hidden border-b border-border flex-shrink-0 bg-background">
        <button
          onClick={() => setMobileTab("sequences")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-medium transition-colors relative ${
            mobileTab === "sequences" ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>
          </svg>
          Sequences
          {mobileTab === "sequences" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
        </button>
        <button
          onClick={() => setMobileTab("library")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-medium transition-colors relative ${
            mobileTab === "library" ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
          </svg>
          Library
          {mobileTab === "library" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
        </button>
      </div>

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Track Library */}
        <div className={`${mobileTab === "library" ? "flex" : "hidden"} sm:flex w-full sm:w-72 sm:flex-shrink-0 border-r border-border flex-col bg-sidebar`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-shrink-0">
              Library
            </h2>
              {cacheProgress && cacheProgress.downloaded < cacheProgress.total && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="w-3 h-3 rounded-full border border-muted-foreground/40 border-t-transparent animate-spin flex-shrink-0" />
                  <span className="text-[10px] text-muted-foreground/70 tabular-nums truncate">
                    {cacheProgress.downloaded}/{cacheProgress.total}
                  </span>
                </div>
              )}
              {cacheProgress && cacheProgress.downloaded >= cacheProgress.total && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-primary flex-shrink-0">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              )}
            </div>
            <div className="flex items-center gap-1">
              {teamId && (
                <button
                  onClick={() => setShowTeamPicker(true)}
                  className="w-7 h-7 rounded-full bg-muted hover:bg-accent text-foreground flex items-center justify-center transition-colors"
                  title="Add from team library"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                  </svg>
                </button>
              )}
              <button
                onClick={() => setShowMyPicker(true)}
                className="w-7 h-7 rounded-full bg-muted hover:bg-accent text-foreground flex items-center justify-center transition-colors"
                title="Add from my library"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 transition-opacity"
                title="Upload tracks"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={AUDIO_FILE_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
          </div>

          {/* Upload progress */}
          {uploadBatch && (
            <div className="px-4 py-2 border-b border-border">
              <p className="text-xs font-semibold text-primary">
                Uploading {uploadBatch.current}/{uploadBatch.total}
              </p>
            </div>
          )}
          {Object.entries(uploadProgress).map(([name, pct]) => (
            <div key={name} className="px-4 py-2 border-b border-border">
              <p className="text-xs text-muted-foreground truncate mb-1">{name}</p>
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ))}

          <div className="flex-1 overflow-y-auto py-1">
            {tracks && tracks.length > 0 ? (
              tracks.map(track => {
                const alreadyInSeq = selectedSequence?.tracks.some(st => st.trackId === track.id) ?? false;
                return (
                  <LibraryTrackRow
                    key={track.id}
                    track={track}
                    isAnalyzing={analyzingIds.has(track.id)}
                    isPlaying={currentTrack?.id === track.id && isPlaying}
                    inSequence={alreadyInSeq}
                    hasActiveSequence={!!selectedSeqId}
                    coverImageUrl={project?.coverImageUrl}
                    onPlay={() => playTrack(track, tracks)}
                    onActivate={() => playTrack(track, tracks, null, { restartIfCurrent: true })}
                    onAddToSequence={() => handleAddToSeq(track.id)}
                    onRename={async (title) => {
                      await updateTrack.mutateAsync({ projectId, trackId: track.id, data: { title } });
                      invalidate();
                    }}
                    onDelete={async () => {
                      setLibraryTrackToDelete({ id: track.id, title: track.title, isTeamLinked: !!track.teamId });
                    }}
                  />
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <p className="text-xs text-muted-foreground mb-3">No tracks yet</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-primary hover:underline"
                >
                  Upload
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Sequences */}
        <div className={`${mobileTab === "sequences" ? "flex" : "hidden"} sm:flex flex-1 flex-col overflow-hidden`}>
          {/* Sequence tabs */}
          <div className="flex items-stretch border-b border-border flex-shrink-0 bg-background px-2 min-h-[44px]">
            <div className="flex items-end gap-0.5 flex-1 overflow-x-auto min-w-0 pt-2">
              {sequencesLoading && (
                <>
                  {[80, 64].map((w, i) => (
                    <div key={i} className="flex items-center gap-2 px-3.5 pb-3 pt-2">
                      <div className="h-2.5 bg-muted/60 animate-pulse rounded" style={{ width: w }} />
                      <div className="h-4 w-5 bg-muted/40 animate-pulse rounded-full" />
                    </div>
                  ))}
                </>
              )}
              {!sequencesLoading && sequences?.map(seq => (
                <button
                  key={seq.id}
                  onClick={() => setSelectedSeqId(seq.id)}
                  className={`relative flex items-center gap-1.5 px-3.5 pb-2.5 pt-1.5 text-xs whitespace-nowrap flex-shrink-0 transition-colors rounded-t-md ${
                    seq.id === selectedSeqId
                      ? "text-foreground font-medium bg-accent/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/20"
                  }`}
                >
                  {playingSequenceId === seq.id && isPlaying && (
                    <span className="flex items-end gap-[2px] h-3" aria-hidden="true">
                      {[0, 0.2, 0.1].map((delay, i) => (
                        <span
                          key={i}
                          className="inline-block w-[3px] rounded-sm bg-primary"
                          style={{
                            animation: `soundBar 0.7s ease-in-out ${delay}s infinite`,
                            height: "3px",
                          }}
                        />
                      ))}
                    </span>
                  )}
                  {seq.name}
                  <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded-full ${
                    seq.id === selectedSeqId ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  }`}>
                    {seq.trackCount}
                  </span>
                  {seq.id === selectedSeqId && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={handleCreateSequence}
              disabled={creatingSequence}
              className="flex-shrink-0 self-center ml-2 my-1.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 rounded-md px-2 py-1 transition-colors"
              title="New sequence"
            >
              {creatingSequence ? (
                <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
              )}
              {creatingSequence ? "Creating..." : "New"}
            </button>
          </div>

          {/* Sequence header */}
          {selectedSeqId && sequences && (
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/60 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                {editingSeqName ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      autoFocus
                      value={seqNameInput}
                      disabled={renamingSeq}
                      onChange={(e) => setSeqNameInput(e.target.value)}
                      onBlur={handleRenameSeq}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                        if (e.key === "Escape" && !renamingSeq) {
                          e.preventDefault();
                          setEditingSeqName(false);
                        }
                      }}
                      className="text-sm font-semibold bg-transparent border-b border-primary outline-none text-foreground w-48 disabled:opacity-60"
                    />
                    {renamingSeq && (
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                        <span className="h-3 w-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                        Updating
                      </span>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      const seq = sequences.find(s => s.id === selectedSeqId);
                      setSeqNameInput(seq?.name || "");
                      setEditingSeqName(true);
                    }}
                    className="group flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-primary transition-colors"
                    title="Click to rename"
                  >
                    {sequences.find(s => s.id === selectedSeqId)?.name}
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="opacity-0 group-hover:opacity-40 transition-opacity">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                    </svg>
                  </button>
                )}
                {selectedSequence && displayTracks.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {displayTracks.length} track{displayTracks.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {selectedSequence && displayTracks.length > 0 && (
                  <button
                    onClick={() => {
                      if (displayTracks.length > 0) {
                        const seq = sequences?.find(s => s.id === selectedSeqId);
                        playTrack(displayTracks[0], displayTracks, seq ? { id: seq.id, name: seq.name } : null);
                      }
                    }}
                    className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-full hover:opacity-90 transition-opacity font-medium"
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                    Play all
                  </button>
                )}
                <button
                  onClick={handleDuplicateSeq}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                  title="Duplicate sequence"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                  </svg>
                </button>
                <button
                  onClick={handleDeleteSeq}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Delete sequence"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Liner Notes */}
          {selectedSeqId && sequences && (
            <div className="border-b border-border/60 flex-shrink-0">
              <button
                className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-accent/20 transition-colors"
                onClick={() => {
                  if (!linerNotesExpanded) {
                    const seq = sequences.find(s => s.id === selectedSeqId);
                    setLinerNotesInput(seq?.linerNotes || "");
                  }
                  setLinerNotesExpanded(v => !v);
                  setEditingLinerNotes(false);
                }}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-primary">
                      <path d="M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3zm0 2a7 7 0 1 1 0 14A7 7 0 0 1 12 5zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>
                    </svg>
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-foreground/70">Liner Notes</span>
                </div>
                <span className={`w-6 h-6 rounded-md bg-accent flex items-center justify-center transition-transform flex-shrink-0 ${linerNotesExpanded ? "rotate-180" : ""}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-foreground/70">
                    <path d="M7 10l5 5 5-5z"/>
                  </svg>
                </span>
              </button>
              {linerNotesExpanded && (
                <div className="px-5 pb-4 pt-1">
                  {editingLinerNotes ? (
                    <div className="flex flex-col gap-2.5">
                      <textarea
                        autoFocus
                        value={linerNotesInput}
                        onChange={(e) => setLinerNotesInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") setEditingLinerNotes(false); }}
                        rows={5}
                        placeholder="Credits, inspirations, context — anything that belongs in the sleeve…"
                        className="w-full bg-[#161616] border border-border/80 rounded-lg text-sm leading-6 text-foreground/90 placeholder:text-muted-foreground/35 placeholder:italic px-3.5 py-2.5 outline-none focus:border-primary/40 resize-none tracking-[0.01em]"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditingLinerNotes(false)}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-accent/50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveLinerNotes}
                          disabled={updateSequence.isPending}
                          className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity disabled:opacity-60 font-medium"
                        >
                          {updateSequence.isPending ? (
                            <div className="w-3 h-3 rounded-full border border-primary-foreground/40 border-t-transparent animate-spin" />
                          ) : null}
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        const seq = sequences.find(s => s.id === selectedSeqId);
                        setLinerNotesInput(seq?.linerNotes || "");
                        setEditingLinerNotes(true);
                      }}
                      className="w-full text-left text-sm leading-[1.75] text-muted-foreground/75 hover:text-muted-foreground transition-colors min-h-[3rem] tracking-[0.01em]"
                    >
                      {sequences.find(s => s.id === selectedSeqId)?.linerNotes
                        ? <span className="whitespace-pre-wrap">{sequences.find(s => s.id === selectedSeqId)?.linerNotes}</span>
                        : <span className="italic opacity-35 text-xs">Credits, inspirations, context — anything that belongs in the sleeve…</span>
                      }
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Sequence track list */}
          <div className="flex-1 overflow-y-auto">
            {(sequencesLoading || (!selectedSeqId && sequencesLoading)) ? (
              <div className="py-2 px-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <TrackRowSkeleton key={i} index={i} />
                ))}
              </div>
            ) : !selectedSeqId ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <p className="text-sm text-muted-foreground mb-4">No sequences yet</p>
                <button onClick={handleCreateSequence} disabled={creatingSequence} className="text-sm text-primary hover:underline disabled:opacity-50">
                  {creatingSequence ? "Creating..." : "Create"}
                </button>
              </div>
            ) : isSeqLoading ? (
              <div className="py-2 px-2">
                {Array.from({ length: seqTrackCount }).map((_, i) => (
                  <TrackRowSkeleton key={i} index={i} />
                ))}
              </div>
            ) : selectedSequence && displayTracks.length > 0 ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={displayTracks.map(t => t.trackId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="py-2 px-2">
                    {displayTracks.map((track, i) => (
                      <SortableTrackRow
                        key={track.trackId}
                        track={track}
                        index={i}
                        isPlaying={currentTrack?.id === track.trackId && isPlaying}
                        coverImageUrl={project?.coverImageUrl}
                        onPlay={() => {
                          const seq = sequences?.find(s => s.id === selectedSeqId);
                          playTrack(track, displayTracks, seq ? { id: seq.id, name: seq.name } : null);
                        }}
                        onActivate={() => {
                          const seq = sequences?.find(s => s.id === selectedSeqId);
                          playTrack(track, displayTracks, seq ? { id: seq.id, name: seq.name } : null, { restartIfCurrent: true });
                        }}
                        onRemove={() => handleRemoveFromSeq(track.trackId)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground">
                    <path d="M9 19V6l12-3v13M9 19c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm12-3c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2z"/>
                  </svg>
                </div>
                <p className="text-sm font-medium text-foreground mb-1">Sequence is empty</p>
                <p className="text-xs text-muted-foreground">
                  {tracks && tracks.length > 0
                    ? "Tap + beside a track in the library to add it here"
                    : "Upload tracks to the library first, then add them here"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {sequenceToDelete && (
        <ConfirmDialog
          title="Delete sequence?"
          description={`"${sequenceToDelete.name}" will be removed from this project. Tracks in your library will stay where they are.`}
          confirmLabel="Delete sequence"
          isLoading={deleteSequence.isPending}
          onCancel={() => setSequenceToDelete(null)}
          onConfirm={handleConfirmDeleteSeq}
        />
      )}

      {sequenceTrackToRemove && (
        <ConfirmDialog
          title="Remove track from sequence?"
          description={`"${sequenceTrackToRemove.title}" will be removed from this sequence, but it will stay in your library.`}
          confirmLabel="Remove track"
          isLoading={removeTrackFromSeq.isPending}
          onCancel={() => setSequenceTrackToRemove(null)}
          onConfirm={handleConfirmRemoveFromSeq}
        />
      )}

      {libraryTrackToDelete && (
        <ConfirmDialog
          title={libraryTrackToDelete.isTeamLinked ? "Remove track from project?" : "Delete track?"}
          description={
            libraryTrackToDelete.isTeamLinked
              ? `"${libraryTrackToDelete.title}" will be removed from this project, but it will stay in the team library.`
              : `"${libraryTrackToDelete.title}" will be permanently deleted from this project.`
          }
          confirmLabel={libraryTrackToDelete.isTeamLinked ? "Remove track" : "Delete track"}
          isLoading={deleteTrack.isPending}
          onCancel={() => setLibraryTrackToDelete(null)}
          onConfirm={handleConfirmDeleteLibraryTrack}
        />
      )}

      {/* Edit Details Modal */}
      {showEditDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowEditDetails(false)}>
          <div
            className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-foreground">Edit project details</h2>
              <button onClick={() => setShowEditDetails(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>

            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Project image</p>
                <div className="flex items-center gap-4">
                  <div className="relative w-24 h-24 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                    {detailsImagePreview ? (
                      <img src={detailsImagePreview} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <ProjectCover coverImageUrl={project?.coverImageUrl} size={96} />
                    )}
                    {coverUploading && (
                      <div className="absolute inset-0 bg-black/65 flex items-center justify-center">
                        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => detailsImageInputRef.current?.click()}
                      className="px-3 py-2 text-xs font-medium border border-border rounded-lg text-foreground hover:bg-accent transition-colors"
                    >
                      Choose image
                    </button>
                    {detailsImageFile && (
                      <p className="text-xs text-muted-foreground mt-2 truncate max-w-[180px]">{detailsImageFile.name}</p>
                    )}
                  </div>
                  <input
                    ref={detailsImageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleDetailsImageSelect(e.target.files?.[0])}
                  />
                </div>
              </div>

              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Project name</span>
                <input
                  value={detailsTitle}
                  onChange={(e) => setDetailsTitle(e.target.value)}
                  className="mt-2 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                  placeholder="Project name"
                />
              </label>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowEditDetails(false)}
                  className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveProjectDetails}
                  disabled={detailsSaving || !detailsTitle.trim()}
                  className="px-3 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {detailsSaving ? "Saving..." : "Save changes"}
                </button>
              </div>

              {canDeleteProject && (
                <div className="border-t border-border pt-5">
                  <p className="text-sm font-medium text-destructive">Delete project</p>
                  <p className="text-xs text-muted-foreground mt-1">This permanently removes the project and its sequences.</p>
                  {!confirmDeleteProject ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteProject(true)}
                      className="mt-3 px-3 py-2 text-xs font-medium border border-destructive/50 text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
                    >
                      Delete project
                    </button>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Are you sure?</span>
                      <button
                        type="button"
                        onClick={handleDeleteProject}
                        disabled={deleteProject.isPending}
                        className="px-3 py-2 text-xs font-medium bg-destructive text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                      >
                        {deleteProject.isPending ? "Deleting..." : "Yes, delete"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteProject(false)}
                        className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowShareModal(false)}>
          <div className="bg-card border border-border rounded-xl shadow-2xl w-96 max-w-full mx-4 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">Share project</h2>
              <button onClick={() => setShowShareModal(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>

            {/* Sequence visibility toggles */}
            {sequences && sequences.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-2">Visible sequences in share link</p>
                <div className="space-y-1">
                  {sequences.map(seq => {
                    const currentIds = project?.sharedSequenceIds;
                    const isVisible = currentIds == null || currentIds.includes(seq.id);
                    return (
                      <label key={seq.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={isVisible}
                          className="accent-primary w-3.5 h-3.5"
                          onChange={async (e) => {
                            const allIds = sequences.map(s => s.id);
                            const currentVisible = currentIds ?? allIds;
                            const newIds = e.target.checked
                              ? [...currentVisible.filter(id => allIds.includes(id)), seq.id]
                              : currentVisible.filter(id => id !== seq.id);
                            const finalIds = newIds.length === allIds.length ? null : newIds;
                            await updateProject.mutateAsync({ projectId, data: { sharedSequenceIds: finalIds } });
                            invalidate();
                          }}
                        />
                        <span className="text-xs text-foreground truncate flex-1">{seq.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mb-4 rounded-lg border border-border bg-background/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">Link expires</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Current expiry: {formatShareExpiry(project?.shareExpiresAt)}
                  </p>
                </div>
                <select
                  disabled={updateProject.isPending}
                  defaultValue=""
                  onChange={(e) => {
                    const days = Number(e.target.value);
                    if (!days) return;
                    handleShareDurationChange(days);
                    e.currentTarget.value = "";
                  }}
                  className="bg-card border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="" disabled>Extend</option>
                  <option value="1">1 day</option>
                  <option value="3">3 days</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                </select>
              </div>
            </div>

            {/* Link copy area */}
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 min-w-0">
                <p className="text-xs text-muted-foreground truncate font-mono">{shareUrl}</p>
              </div>
              <button
                onClick={async () => {
                  try { await navigator.clipboard.writeText(shareUrl); }
                  catch {
                    const ta = document.createElement("textarea");
                    ta.value = shareUrl;
                    ta.style.position = "fixed"; ta.style.opacity = "0";
                    document.body.appendChild(ta); ta.focus(); ta.select();
                    document.execCommand("copy"); document.body.removeChild(ta);
                  }
                  setCopiedShare(true);
                  setTimeout(() => setCopiedShare(false), 2000);
                }}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-colors flex-shrink-0 ${copiedShare ? "bg-primary text-primary-foreground" : "bg-accent hover:bg-accent/80 text-foreground"}`}
              >
                {copiedShare ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                )}
                {copiedShare ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMyPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowMyPicker(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <div>
                <h3 className="text-base font-semibold text-foreground">Add from my library</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Pick tracks from your personal library to add to this project.
                </p>
              </div>
              <button
                onClick={() => setShowMyPicker(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {(() => {
                const projectTrackIds = new Set((tracks ?? []).map(t => t.id));
                const available = (myTracks ?? []).filter(t => !projectTrackIds.has(t.id));
                if (!myTracks) {
                  return (
                    <div className="space-y-2 p-2">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-12 bg-white/5 rounded-md animate-pulse" />
                      ))}
                    </div>
                  );
                }
                if (available.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                      <p className="text-sm font-medium text-foreground mb-1">Nothing to add</p>
                      <p className="text-xs text-muted-foreground">
                        Your personal library is empty, or every track is already in a project.
                      </p>
                    </div>
                  );
                }
                return available.map(track => {
                  const checked = pickerSelection.has(track.id);
                  const toggle = () => {
                    setPickerSelection(prev => {
                      const next = new Set(prev);
                      if (next.has(track.id)) next.delete(track.id);
                      else next.add(track.id);
                      return next;
                    });
                  };
                  return (
                    <label
                      key={track.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${checked ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-accent/50"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={toggle}
                        className="accent-primary w-4 h-4 flex-shrink-0"
                      />
                      <div className="w-9 h-9 rounded overflow-hidden flex-shrink-0">
                        <ProjectCover coverImageUrl={track.coverImageUrl} size={36} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{track.title}</p>
                        {track.bpm || track.camelotKey ? (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {track.bpm ? `${track.bpm} BPM` : ""}
                            {track.bpm && track.camelotKey ? " · " : ""}
                            {track.camelotKey ?? ""}
                          </p>
                        ) : null}
                      </div>
                    </label>
                  );
                });
              })()}
            </div>
            <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3 flex-shrink-0">
              <p className="text-xs text-muted-foreground">
                {pickerSelection.size > 0
                  ? `${pickerSelection.size} selected`
                  : "Select tracks to add"}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowMyPicker(false)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  disabled={pickerSelection.size === 0 || pickerAdding}
                  onClick={async () => {
                    setPickerAdding(true);
                    try {
                      let addedCount = 0;
                      for (const trackId of Array.from(pickerSelection)) {
                        try {
                          await addMyTrackToProject.mutateAsync({ projectId, trackId });
                          addedCount += 1;
                        } catch (e) {
                          console.error("Failed to add track", trackId, e);
                        }
                      }
                      if (addedCount > 0) updateDashboardProjectCounts({ trackCount: addedCount });
                      invalidate();
                      setShowMyPicker(false);
                    } finally {
                      setPickerAdding(false);
                    }
                  }}
                  className="text-sm bg-primary text-primary-foreground px-4 py-1.5 rounded-full hover:opacity-90 disabled:opacity-40 font-semibold transition-opacity"
                >
                  {pickerAdding
                    ? "Adding…"
                    : pickerSelection.size > 0
                      ? `Add ${pickerSelection.size}`
                      : "Add"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showTeamPicker && teamId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowTeamPicker(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <div>
                <h3 className="text-base font-semibold text-foreground">Add from team library</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Pick tracks to include in this project's library.
                </p>
              </div>
              <button
                onClick={() => setShowTeamPicker(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {(() => {
                const projectTrackIds = new Set((tracks ?? []).map(t => t.id));
                const available = (teamTracks ?? []).filter(t => !projectTrackIds.has(t.id));
                if (!teamTracks) {
                  return (
                    <div className="space-y-2 p-2">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-12 bg-white/5 rounded-md animate-pulse" />
                      ))}
                    </div>
                  );
                }
                if (available.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                      <p className="text-sm font-medium text-foreground mb-1">All caught up</p>
                      <p className="text-xs text-muted-foreground">
                        Every track in this team's library is already in this project.
                      </p>
                    </div>
                  );
                }
                return available.map(track => {
                  const checked = pickerSelection.has(track.id);
                  const toggle = () => {
                    setPickerSelection(prev => {
                      const next = new Set(prev);
                      if (next.has(track.id)) next.delete(track.id);
                      else next.add(track.id);
                      return next;
                    });
                  };
                  return (
                    <label
                      key={track.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${checked ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-accent/50"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={toggle}
                        className="accent-primary w-4 h-4 flex-shrink-0"
                      />
                      <div className="w-9 h-9 rounded bg-gradient-to-br from-primary/30 to-primary/5 flex items-center justify-center flex-shrink-0">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-primary/70">
                          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{track.title}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {track.uploaderName ? `by ${track.uploaderName}` : "by someone"}
                          {track.projectTitle ? ` · in ${track.projectTitle}` : ""}
                        </p>
                      </div>
                      <UserAvatar
                        avatarUrl={track.uploaderAvatarUrl}
                        name={track.uploaderName || "Unknown uploader"}
                        seed={track.uploaderName || track.id}
                        size={24}
                        className="ring-1 ring-border/40"
                      />
                    </label>
                  );
                });
              })()}
            </div>
            <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3 flex-shrink-0">
              <p className="text-xs text-muted-foreground">
                {pickerSelection.size > 0
                  ? `${pickerSelection.size} selected`
                  : "Select tracks to add"}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowTeamPicker(false)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  disabled={pickerSelection.size === 0 || pickerAdding}
                  onClick={async () => {
                    setPickerAdding(true);
                    try {
                      let addedCount = 0;
                      for (const trackId of Array.from(pickerSelection)) {
                        try {
                          await addTeamTrackToProject.mutateAsync({ projectId, trackId });
                          addedCount += 1;
                        } catch (e) {
                          console.error("Failed to add track", trackId, e);
                        }
                      }
                      if (addedCount > 0) updateDashboardProjectCounts({ trackCount: addedCount });
                      invalidate();
                      setShowTeamPicker(false);
                    } finally {
                      setPickerAdding(false);
                    }
                  }}
                  className="text-sm bg-primary text-primary-foreground px-4 py-1.5 rounded-full hover:opacity-90 disabled:opacity-40 font-semibold transition-opacity"
                >
                  {pickerAdding
                    ? "Adding…"
                    : pickerSelection.size > 0
                      ? `Add ${pickerSelection.size}`
                      : "Add"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
