import React, { useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  useListMyTracks,
  useCreateMyTrack,
  useUpdateMyTrack,
  useDeleteMyTrack,
  useRequestUploadUrl,
  getListMyTracksQueryKey,
} from "@workspace/api-client-react";
import type { Track } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { analyzeAudioFile, extractCoverArt } from "@/lib/audio-analyzer";
import { uploadFileToStorage } from "@/lib/storage-upload";
import { Logo } from "@/components/Logo";
import { UserAvatar } from "@/components/UserAvatar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/hooks/use-toast";
import { AUDIO_FILE_ACCEPT, splitAudioFiles } from "@/lib/file-accept";

function fmtDuration(s: number | null | undefined) {
  if (s == null || isNaN(s)) return "--:--";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function camelotColor(key: string | null) {
  if (!key) return "#555";
  const colors: Record<string, string> = {
    "1": "#e74c3c", "2": "#e67e22", "3": "#f1c40f", "4": "#2ecc71",
    "5": "#1abc9c", "6": "#3498db", "7": "#9b59b6", "8": "#e91e63",
    "9": "#ff5722", "10": "#4caf50", "11": "#00bcd4", "12": "#673ab7",
  };
  return colors[String(parseInt(key))] || "#555";
}

function TrackCover({ url }: { url: string | null | undefined }) {
  const src = url && url.startsWith("/objects/") ? `/api/storage${url}` : url;
  const [failed, setFailed] = useState(false);
  React.useEffect(() => { setFailed(false); }, [src]);
  return (
    <div className="w-10 h-10 sm:w-11 sm:h-11 rounded overflow-hidden flex-shrink-0 bg-gradient-to-br from-primary/30 to-primary/5 flex items-center justify-center">
      {src && !failed ? (
        <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-primary/70">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
        </svg>
      )}
    </div>
  );
}

function UploaderAvatar({ name, avatarUrl, size = 22 }: { name: string | null; avatarUrl: string | null; size?: number }) {
  return <UserAvatar avatarUrl={avatarUrl} name={name || "Unknown uploader"} seed={name} size={size} className="ring-1 ring-border/40" title={name || "Unknown uploader"} />;
}

function TrackRow({
  track,
  index,
  isPlaying,
  isAnalyzing,
  onPlay,
  onRename,
  onDelete,
}: {
  track: Track;
  index: number;
  isPlaying: boolean;
  isAnalyzing: boolean;
  onPlay: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(track.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setVal(track.title);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };
  const commit = () => {
    const t = val.trim();
    if (t && t !== track.title) onRename(t);
    setEditing(false);
  };
  const handleRowClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (editing) return;
    const target = event.target as HTMLElement;
    if (target.closest("button,input")) return;
    onPlay();
  };

  return (
    <div
      onClick={handleRowClick}
      className={`grid grid-cols-[40px_minmax(0,1fr)_64px] sm:grid-cols-[32px_44px_1fr_28px_100px] items-center gap-2.5 sm:gap-3 px-2.5 sm:px-4 py-2.5 group rounded-md ${
        isPlaying ? "bg-primary/10" : "hover:bg-accent/40"
      } transition-colors cursor-pointer`}
    >
      {/* Play / index */}
      <button onClick={onPlay} className="hidden sm:flex text-xs tabular-nums text-muted-foreground relative w-6 items-center justify-center">
        <span className={`transition-opacity ${isPlaying ? "opacity-0" : "group-hover:opacity-0"}`}>{index + 1}</span>
        <span className={`absolute inset-0 flex items-center justify-center transition-opacity ${isPlaying ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          {isPlaying ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-primary">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-foreground">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </span>
      </button>

      {/* Cover */}
      <TrackCover url={track.coverImageUrl} />

      {/* Title */}
      <div className="min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
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
        {isAnalyzing && <span className="text-[10px] text-primary animate-pulse">Analyzing…</span>}
      </div>

      {/* Uploader avatar */}
      <div className="hidden sm:flex items-center justify-center" title={`Uploaded by ${track.uploaderName || "you"}`}>
        <UploaderAvatar name={track.uploaderName} avatarUrl={track.uploaderAvatarUrl} />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1">
        <button
          onClick={startEdit}
          className="w-7 h-7 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 flex items-center justify-center text-muted-foreground hover:text-foreground transition-all"
          title="Rename"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="w-7 h-7 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 flex items-center justify-center text-muted-foreground hover:text-destructive transition-all"
          title="Delete"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function PersonalLibrary() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { play, currentTrack, isPlaying } = useAudioPlayer();

  const { data: tracks } = useListMyTracks();

  const createTrack = useCreateMyTrack();
  const updateTrack = useUpdateMyTrack();
  const deleteTrack = useDeleteMyTrack();
  const requestUploadUrl = useRequestUploadUrl();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadBatch, setUploadBatch] = useState<{ current: number; total: number } | null>(null);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [trackToDelete, setTrackToDelete] = useState<Track | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListMyTracksQueryKey() });

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
          data: { name: file.name, size: file.size, contentType: file.type || "audio/mpeg" },
        });
        await uploadFileToStorage({
          uploadURL,
          file,
          contentType: file.type || "audio/mpeg",
          onProgress: (percent) =>
            setUploadProgress((p) => ({ ...p, [file.name]: percent })),
        });
        setUploadProgress(p => { const n = { ...p }; delete n[file.name]; return n; });

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
        } catch (e) {
          console.warn("Cover art upload failed (non-fatal):", e);
        }

        const trackName = file.name.replace(/\.[^.]+$/, "");
        const { id: trackId } = await createTrack.mutateAsync({
          data: { title: trackName, fileUrl: objectPath, coverImageUrl: coverObjectPath, analyzed: false },
        });
        invalidate();

        setAnalyzingIds(s => new Set(s).add(trackId));
        try {
          const { bpm, camelotKey, durationSeconds } = await analyzeAudioFile(file);
          await updateTrack.mutateAsync({
            trackId,
            data: {
              bpm: bpm ?? undefined,
              camelotKey: camelotKey ?? undefined,
              durationSeconds: durationSeconds ?? undefined,
              analyzed: true,
            },
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

  const playTrack = (track: Track) => {
    if (!tracks) return;
    play(
      { id: track.id, title: track.title, fileUrl: track.fileUrl, coverImageUrl: track.coverImageUrl, sourceType: "personal", sourceTitle: "Personal Library", durationSeconds: track.durationSeconds, bpm: track.bpm, camelotKey: track.camelotKey },
      tracks.map(t => ({ id: t.id, title: t.title, fileUrl: t.fileUrl, coverImageUrl: t.coverImageUrl, sourceType: "personal" as const, sourceTitle: "Personal Library", durationSeconds: t.durationSeconds, bpm: t.bpm, camelotKey: t.camelotKey })),
    );
  };

  const handleConfirmDeleteTrack = async () => {
    if (!trackToDelete) return;
    await deleteTrack.mutateAsync({ trackId: trackToDelete.id });
    setTrackToDelete(null);
    invalidate();
  };

  return (
    <div className="h-full bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate("/dashboard")}
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            title="Back to dashboard"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
            </svg>
          </button>
          <div className="hidden sm:block">
            <Logo size={22} />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-foreground truncate">Personal Library</h1>
            <p className="text-xs text-muted-foreground">
              {tracks ? `${tracks.length} track${tracks.length !== 1 ? "s" : ""}` : "Loading…"}
            </p>
          </div>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-2 text-sm w-10 h-10 sm:w-auto sm:h-auto sm:px-4 sm:py-2 rounded-full bg-primary/15 sm:bg-primary text-primary sm:text-primary-foreground border border-primary/30 sm:border-transparent hover:bg-primary/20 sm:hover:opacity-90 font-semibold transition-all"
          title="Upload track"
          aria-label="Upload track"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17.5h9.2a4.3 4.3 0 0 0 .5-8.57A6 6 0 0 0 5.34 7.3 4.9 4.9 0 0 0 7 17.5z" />
            <path d="M12 17V10" />
            <path d="m8.9 13.1 3.1-3.1 3.1 3.1" />
          </svg>
          <span className="hidden sm:inline">Upload track</span>
        </button>
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
      {(uploadBatch || Object.entries(uploadProgress).length > 0) && (
        <div className="px-4 sm:px-6 py-2 border-b border-border space-y-1.5 flex-shrink-0">
          {uploadBatch && (
            <p className="text-xs font-semibold text-primary">
              Uploading {uploadBatch.current}/{uploadBatch.total}
            </p>
          )}
          {Object.entries(uploadProgress).map(([name, pct]) => (
            <div key={name}>
              <p className="text-xs text-muted-foreground truncate mb-1">{name}</p>
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Track list */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-2 sm:px-4 py-4">
          {tracks && tracks.length > 0 ? (
            <>
              {/* Column headers */}
              <div className="hidden sm:grid sm:grid-cols-[32px_44px_1fr_28px_100px] items-center gap-3 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border/50 mb-2">
                <span>#</span>
                <span></span>
                <span>Title</span>
                <span></span>
                <span></span>
              </div>
              {tracks.map((track, i) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={i}
                  isPlaying={currentTrack?.id === track.id && isPlaying}
                  isAnalyzing={analyzingIds.has(track.id)}
                  onPlay={() => playTrack(track)}
                  onRename={async (title) => {
                    await updateTrack.mutateAsync({ trackId: track.id, data: { title } });
                    invalidate();
                  }}
                  onDelete={() => setTrackToDelete(track)}
                />
              ))}
            </>
          ) : tracks ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-5">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </div>
              <p className="text-sm font-medium text-foreground mb-1">Your personal library is empty</p>
              <p className="text-xs text-muted-foreground mb-4">Upload tracks to build your personal library.</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-sm bg-primary text-primary-foreground px-5 py-2 rounded-full hover:opacity-90 font-semibold transition-opacity"
              >
                Upload
              </button>
            </div>
          ) : (
            <div className="space-y-2 py-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-12 bg-white/5 rounded-md animate-pulse" />
              ))}
            </div>
          )}
        </div>
      </div>
      {trackToDelete && (
        <ConfirmDialog
          title="Delete track?"
          description={
            trackToDelete.projectId
              ? `"${trackToDelete.title}" will be removed from your personal library and any project using it.`
              : `"${trackToDelete.title}" will be removed from your personal library.`
          }
          confirmLabel="Delete track"
          isLoading={deleteTrack.isPending}
          onCancel={() => setTrackToDelete(null)}
          onConfirm={handleConfirmDeleteTrack}
        />
      )}
    </div>
  );
}
