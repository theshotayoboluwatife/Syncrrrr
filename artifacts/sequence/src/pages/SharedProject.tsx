import React, { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { motion } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { SequenceTrack, SharedProject as SharedProjectData } from "@workspace/api-client-react";
import { Logo } from "@/components/Logo";
import { ProjectCover } from "@/lib/svg-generator";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { audioCacheService } from "@/lib/audio-cache";
import { SharedProjectWelcomeModal } from "@/components/SharedProjectWelcomeModal";
import { reportError } from "@/lib/error-reporting";
import { cn } from "@/lib/utils";

function formatDuration(s: number | null | undefined) {
  if (s == null || isNaN(s)) return null;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function EqualizerBars({ isPlaying }: { isPlaying: boolean }) {
  return (
    <svg width="11" height="10" viewBox="0 0 11 10" className="flex-shrink-0" aria-hidden>
      {isPlaying ? (
        <>
          <rect x="0" y="0" width="2.2" height="10" fill="#4ade80" rx="1">
            <animate attributeName="height" values="10;3;8;3;10" dur="1s" repeatCount="indefinite" />
            <animate attributeName="y" values="0;3.5;1;3.5;0" dur="1s" repeatCount="indefinite" />
          </rect>
          <rect x="4.4" y="0" width="2.2" height="10" fill="#4ade80" rx="1">
            <animate attributeName="height" values="4;10;5;9;4" dur="0.75s" repeatCount="indefinite" />
            <animate attributeName="y" values="3;0;2.5;0.5;3" dur="0.75s" repeatCount="indefinite" />
          </rect>
          <rect x="8.8" y="0" width="2.2" height="10" fill="#4ade80" rx="1">
            <animate attributeName="height" values="7;3;10;4;7" dur="0.9s" repeatCount="indefinite" />
            <animate attributeName="y" values="1.5;3.5;0;3;1.5" dur="0.9s" repeatCount="indefinite" />
          </rect>
        </>
      ) : (
        <>
          <rect x="0" y="4" width="2.2" height="3" fill="#4ade80" rx="1" opacity="0.55" />
          <rect x="4.4" y="2" width="2.2" height="6" fill="#4ade80" rx="1" opacity="0.55" />
          <rect x="8.8" y="5" width="2.2" height="2" fill="#4ade80" rx="1" opacity="0.55" />
        </>
      )}
    </svg>
  );
}

function PlayPauseGlyph({ isPlaying, size = 20 }: { isPlaying: boolean; size?: number }) {
  return isPlaying ? (
    <Pause size={size} strokeWidth={3} fill="currentColor" className="drop-shadow-[0_1px_0_rgba(0,0,0,0.18)]" />
  ) : (
    <Play size={size} strokeWidth={3} fill="currentColor" className="ml-0.5 drop-shadow-[0_1px_0_rgba(0,0,0,0.18)]" />
  );
}

function PrimaryPlayButton({
  isPlaying,
  className,
  iconSize = 22,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { isPlaying: boolean; iconSize?: number }) {
  return (
    <button
      {...props}
      className={cn(
        "group relative grid place-items-center rounded-full text-black transition-all duration-200",
        "bg-[radial-gradient(circle_at_35%_20%,#ffffff_0%,#f4fff7_28%,#1ed760_100%)]",
        "shadow-[0_10px_35px_rgba(29,185,84,0.24),inset_0_1px_0_rgba(255,255,255,0.78)]",
        "hover:scale-[1.04] hover:shadow-[0_14px_42px_rgba(29,185,84,0.34),inset_0_1px_0_rgba(255,255,255,0.86)] active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        "before:absolute before:inset-[2px] before:rounded-full before:bg-white/10 before:opacity-80",
        className,
      )}
    >
      <span className="relative z-10">
        <PlayPauseGlyph isPlaying={isPlaying} size={iconSize} />
      </span>
    </button>
  );
}

async function fetchPublicSharedProject(shareToken: string, signal?: AbortSignal) {
  const timeoutController = new AbortController();
  const timeout = window.setTimeout(() => timeoutController.abort(), 15000);
  const abortController = new AbortController();

  const abort = () => abortController.abort();
  signal?.addEventListener("abort", abort, { once: true });
  timeoutController.signal.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(`/api/share/${encodeURIComponent(shareToken)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Shared project request failed with ${response.status}`);
    }

    return (await response.json()) as SharedProjectData;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function SharedProject() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const { data: project, isLoading, isError, error } = useQuery({
    queryKey: ["public-shared-project", shareToken],
    queryFn: ({ signal }) => fetchPublicSharedProject(shareToken, signal),
    enabled: !!shareToken,
    retry: 1,
  });
  const { play, currentTrack, isPlaying, pause, resume, setPlayingSource, playingSequenceId } = useAudioPlayer();
  const [selectedSeqId, setSelectedSeqId] = useState<string | null>(null);
  const [linerNotesOpen, setLinerNotesOpen] = useState(false);
  const [cacheProgress, setCacheProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const cacheBatchRef = useRef<AbortController | null>(null);

  const viewerHasAccess = true;

  const activeSeqId = selectedSeqId || project?.sequences?.[0]?.id || null;
  const activeSeq = project?.sequences?.find(s => s.id === activeSeqId);

  useEffect(() => {
    if (error) {
      reportError(error, { area: "share", action: "load public project" });
    }
  }, [error]);

  // Use the explicitly-set sequence ID from context — this is set each time we
  // start a new sequence and is unambiguous even when the same track appears in
  // multiple sequences (which would fool a "find first match" scan).
  const playingSeqId = playingSequenceId;

  // Pre-cache tracks strategically: first track immediately, rest in order.
  // For return visits all tracks serve as blob URLs with instant seek.
  useEffect(() => {
    if (!viewerHasAccess) return; // do not pre-cache audio for gated viewers
    if (!activeSeq || activeSeq.tracks.length === 0) return;
    cacheBatchRef.current?.abort();

    const fileUrls = activeSeq.tracks.map(t => t.fileUrl);
    const total = fileUrls.length;

    // Check what's already cached so we can start the counter from the right value
    audioCacheService.countCached(fileUrls).then(already => {
      if (already >= total) {
        // Everything cached — preload blob URLs silently, no indicator
        audioCacheService.preloadSequence(fileUrls).catch(() => {});
        return;
      }

      let downloaded = already;
      setCacheProgress({ downloaded, total });

      // Cache first track with higher urgency (solo fetch, not in batch pool)
      audioCacheService.cacheTrack(fileUrls[0]).then(() => {
        downloaded = Math.max(downloaded, already + 1);
        setCacheProgress({ downloaded, total });
      });

      // Queue the rest via the batch pool
      const rest = fileUrls.slice(1);
      cacheBatchRef.current = audioCacheService.batchCache(rest, {
        onProgress: (done, _batchTotal) => {
          downloaded = already + 1 + done; // +1 for first track
          setCacheProgress({ downloaded, total });
          if (downloaded >= total) {
            setTimeout(() => setCacheProgress(null), 3000);
          }
        },
      });
    });

    return () => {
      cacheBatchRef.current?.abort();
    };
  }, [activeSeq?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a track finishes via the audio element, its data is cached for next time.
  // We also pre-cache any track we start playing.
  const playSharedTrack = (track: SequenceTrack, queue: SequenceTrack[], options?: { restartIfCurrent?: boolean }) => {
    const albumCover = project?.coverImageUrl ?? null;
    const toPlayer = (t: SequenceTrack) => ({
      id: t.trackId,
      title: t.title,
      fileUrl: t.fileUrl,
      coverImageUrl: t.coverImageUrl ?? albumCover,
      sourceType: "shared" as const,
      sourceTitle: project?.title ?? "Shared project",
      sourceSubtitle: project?.teamName ?? activeSeq?.name ?? null,
      durationSeconds: t.durationSeconds,
      bpm: t.bpm,
      camelotKey: t.camelotKey,
    });
    const trackId = track.trackId;
    // Toggle play/pause only when the same track is active AND it belongs to
    // the same sequence currently in the player. If the sequence differs (even
    // if the track ID matches because it appears in both), always start the new
    // sequence queue from scratch.
    if (currentTrack?.id === trackId && playingSeqId === activeSeqId && !options?.restartIfCurrent) {
      isPlaying ? pause() : resume();
    } else {
      // Tell the player bar which sequence this belongs to
      if (activeSeq) {
        setPlayingSource({ sequenceId: activeSeq.id, sequenceName: activeSeq.name });
      }
      play(toPlayer(track), queue.map(toPlayer));
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen bg-[#121212] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="h-screen bg-[#121212] flex flex-col items-center justify-center text-center px-4">
        <Logo size={36} />
        <h1 className="text-lg font-semibold text-foreground mt-4 mb-2">Link not found</h1>
        <p className="text-sm text-muted-foreground">This share link may have expired or been removed.</p>
      </div>
    );
  }

  const totalTracks = activeSeq?.tracks.length ?? 0;
  const totalDuration = activeSeq?.tracks.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0) ?? 0;
  const totalMins = Math.floor(totalDuration / 60);

  return (
    <div className="min-h-screen bg-[#121212] text-foreground flex flex-col pb-[calc(6rem+env(safe-area-inset-bottom))]">
      {/* Hero */}
      <div className="relative overflow-hidden">
        {project.coverImageUrl && (
          <div
            className="absolute inset-0 scale-110"
            style={{
              backgroundImage: `url(${project.coverImageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(40px) brightness(0.35)",
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#121212]/60 to-[#121212]" />

        <div className="relative z-10 px-4 pt-8 pb-6 flex flex-col items-center text-center sm:flex-row sm:items-end sm:text-left sm:px-8 sm:pt-12 sm:pb-8 gap-6 sm:gap-8 max-w-4xl mx-auto w-full">
          <div className="w-44 h-44 sm:w-56 sm:h-56 rounded-lg overflow-hidden shadow-2xl flex-shrink-0">
            <ProjectCover coverImageUrl={project.coverImageUrl} fill size={224} />
          </div>

          <div className="flex flex-col gap-3 sm:pb-2 min-w-0 w-full">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Album</p>
            <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-white leading-tight break-words hyphens-auto">
              {project.title}
            </h1>
            {project.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{project.description}</p>
            )}

            {project.teamName && (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <div className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0">
                  {project.teamImageUrl ? (
                    <img src={project.teamImageUrl!} alt={project.teamName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground">
                        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                      </svg>
                    </div>
                  )}
                </div>
                <span className="text-sm font-semibold text-white">{project.teamName}</span>
                {totalTracks > 0 && (
                  <>
                    <span className="text-muted-foreground text-sm">·</span>
                    <span className="text-sm text-muted-foreground">
                      {totalTracks} {totalTracks === 1 ? "track" : "tracks"}
                      {totalMins > 0 && `, ${totalMins} min`}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 sm:px-8 max-w-4xl mx-auto w-full">
        {/* Sequence tabs */}
        {project.sequences.length > 1 && (
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
            {project.sequences.map(seq => {
              const isViewing = seq.id === activeSeqId;
              const isPlayingFrom = seq.id === playingSeqId;
              return (
                <button
                  key={seq.id}
                  onClick={() => setSelectedSeqId(seq.id)}
                  className={`text-sm px-4 py-2 rounded-full whitespace-nowrap transition-colors flex-shrink-0 flex items-center gap-1.5 ${
                    isViewing
                      ? "bg-primary text-primary-foreground font-medium"
                      : "bg-white/10 text-muted-foreground hover:text-foreground hover:bg-white/15"
                  }`}
                >
                  {seq.name}
                  {isPlayingFrom && !isViewing && (
                    <EqualizerBars isPlaying={isPlaying} />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Play button */}
        {activeSeq && activeSeq.tracks.length > 0 && (() => {
          const seqIsInPlayer = playingSeqId === activeSeqId;
          const seqIsPlaying = seqIsInPlayer && isPlaying;
          return (
            <div className="flex items-center gap-4 mb-5 mt-2 px-1">
              <PrimaryPlayButton
                onClick={() => {
                  if (seqIsInPlayer) {
                    isPlaying ? pause() : resume();
                  } else {
                    playSharedTrack(activeSeq.tracks[0], activeSeq.tracks);
                  }
                }}
                className="w-14 h-14 flex-shrink-0"
                iconSize={22}
                isPlaying={seqIsPlaying}
                title={seqIsPlaying ? "Pause" : "Play"}
                aria-label={seqIsPlaying ? "Pause sequence" : "Play sequence"}
              />
            </div>
          );
        })()}

        {/* Liner Notes — shown first before track list */}
        {activeSeq?.linerNotes && (
          <div className="mb-6 rounded-xl bg-white/[0.04] border border-white/[0.09] overflow-hidden">
            {/* Header row */}
            <button
              onClick={() => setLinerNotesOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-primary">
                    <path d="M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3zm0 2a7 7 0 1 1 0 14A7 7 0 0 1 12 5zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>
                  </svg>
                </span>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-foreground/80">
                  Liner Notes
                </span>
              </div>
              {/* Visible pill toggle */}
              <span className={`w-7 h-7 rounded-full bg-white/[0.08] flex items-center justify-center transition-transform duration-200 flex-shrink-0 ${linerNotesOpen ? "rotate-180" : ""}`}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" className="text-foreground/70">
                  <path d="M7 10l5 5 5-5z"/>
                </svg>
              </span>
            </button>

            {/* Mobile: always shows 2-line clamp teaser; Desktop: accordion */}
            <div
              className={`px-4 text-sm text-[#b8b8b8] tracking-[0.01em] sm:hidden ${
                linerNotesOpen
                  ? "pb-4 leading-7 whitespace-pre-wrap overflow-hidden"
                  : "pb-2 leading-snug liner-notes-clamp"
              }`}
            >
              {activeSeq.linerNotes}
            </div>
            <div className="hidden sm:block">
              {linerNotesOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className="px-4 pb-4"
                >
                  <p className="text-sm leading-7 text-[#b8b8b8] whitespace-pre-wrap tracking-[0.01em]">
                    {activeSeq.linerNotes}
                  </p>
                </motion.div>
              )}
            </div>
          </div>
        )}

        {/* Track list */}
        {activeSeq && (
          <motion.div
            key={activeSeq.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="rounded-[22px] border border-white/[0.08] bg-white/[0.035] p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.22)] sm:rounded-xl sm:bg-transparent sm:border-0 sm:p-0 sm:shadow-none">
              {activeSeq.tracks.length > 0 && (
                <div className="hidden sm:flex items-center gap-3 px-4 pb-2 border-b border-white/10 mb-1">
                  <span className="w-8 text-center text-xs text-muted-foreground flex-shrink-0">#</span>
                  <span className="flex-1 text-xs text-muted-foreground">Title</span>
                  {cacheProgress && cacheProgress.downloaded < cacheProgress.total && (
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                      <span className="w-2.5 h-2.5 rounded-full border border-muted-foreground/40 border-t-transparent animate-spin inline-block" />
                      {cacheProgress.downloaded}/{cacheProgress.total}
                    </span>
                  )}
                  {cacheProgress && cacheProgress.downloaded >= cacheProgress.total && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-primary">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                  )}
                  <span className="w-20 text-right text-xs text-muted-foreground flex-shrink-0">Duration</span>
                </div>
              )}

              {activeSeq.tracks.map((track, i) => {
                const id = track.trackId;
                const isActive = currentTrack?.id === id;
                const dur = formatDuration(track.durationSeconds);
                return (
                  <button
                    key={id}
                    onClick={() => playSharedTrack(track, activeSeq.tracks, { restartIfCurrent: true })}
                    className={`w-full flex items-center gap-3 px-3 py-3.5 sm:px-4 sm:py-3 rounded-2xl sm:rounded-md group text-left transition-colors ${
                      isActive ? "bg-white/[0.11]" : "hover:bg-white/[0.07]"
                    }`}
                  >
                    {/* Number / play icon */}
                    <div className="w-9 h-9 grid place-items-center flex-shrink-0 relative rounded-full bg-white/[0.06] text-white/70 group-hover:text-black group-hover:bg-primary transition-colors">
                      <span className={`text-sm tabular-nums transition-opacity ${isActive ? "opacity-0" : "group-hover:opacity-0"}`}>
                        {i + 1}
                      </span>
                      <span className={`absolute inset-0 flex items-center justify-center transition-opacity ${isActive ? "opacity-100 text-primary group-hover:text-black" : "opacity-0 group-hover:opacity-100"}`}>
                        <PlayPauseGlyph isPlaying={isActive && isPlaying} size={15} />
                      </span>
                    </div>

                    {/* Cover art thumbnail — prefer per-track embedded art, fall back to album cover */}
                    <div className="w-11 h-11 sm:w-10 sm:h-10 rounded-lg sm:rounded overflow-hidden flex-shrink-0 shadow-sm">
                      <ProjectCover coverImageUrl={track.coverImageUrl ?? project.coverImageUrl} size={40} />
                    </div>

                    {/* Title */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-[15px] sm:text-sm font-medium truncate ${isActive ? "text-primary" : "text-white"}`}>
                        {track.title}
                      </p>
                      {dur && (
                        <p className="sm:hidden text-xs text-muted-foreground tabular-nums mt-0.5">{dur}</p>
                      )}
                    </div>

                    {/* Duration */}
                    <span className="hidden sm:block text-xs text-muted-foreground tabular-nums w-12 text-right flex-shrink-0">
                      {dur ?? "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {project.sequences.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">
            No sequences in this project yet.
          </div>
        )}
      </div>

      {/* Footer branding */}
      <div className="mt-auto pt-8 px-4 sm:px-8 max-w-4xl mx-auto w-full">
        <div className="flex items-center gap-2 border-t border-white/10 pt-6">
          <Logo size={16} />
          <span className="text-xs text-muted-foreground">Powered by Syncr</span>
        </div>
      </div>

      <SharedProjectWelcomeModal
        shareToken={shareToken}
        teamName={project.teamName ?? null}
        teamImageUrl={project.teamImageUrl ?? null}
        projectTitle={project.title}
      />
    </div>
  );
}
