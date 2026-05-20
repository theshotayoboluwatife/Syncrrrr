import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { ProjectCover } from "@/lib/svg-generator";
import { cn } from "@/lib/utils";

function formatTime(s: number) {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function PlayPauseGlyph({ isPlaying, size = 20 }: { isPlaying: boolean; size?: number }) {
  return isPlaying ? (
    <Pause size={size} strokeWidth={3} fill="currentColor" className="drop-shadow-[0_1px_0_rgba(0,0,0,0.18)]" />
  ) : (
    <Play size={size} strokeWidth={3} fill="currentColor" className="ml-0.5 drop-shadow-[0_1px_0_rgba(0,0,0,0.18)]" />
  );
}

function PlayerIconButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "group relative grid place-items-center rounded-full text-white/70 transition-all duration-200",
        "hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        "after:absolute after:inset-0 after:rounded-full after:bg-white/[0.07] after:opacity-0 after:transition-opacity hover:after:opacity-100",
        className,
      )}
    >
      <span className="relative z-10 transition-transform duration-200 group-hover:scale-105">{children}</span>
    </button>
  );
}

function PrimaryPlayButton({
  isPlaying,
  className,
  iconSize = 20,
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

function NowPlayingView({
  onClose,
}: {
  onClose: () => void;
}) {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    pause,
    resume,
    next,
    previous,
    seek,
    playingSequenceName,
  } = useAudioPlayer();
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (!currentTrack) return null;

  const sourceTitle = currentTrack.sourceTitle || playingSequenceName || "Syncr";
  const sourceSubtitle = currentTrack.sourceSubtitle && currentTrack.sourceSubtitle !== sourceTitle
    ? currentTrack.sourceSubtitle
    : null;

  return (
    <div className="fixed inset-0 z-[80] bg-[#050505] text-white overflow-y-auto">
      <div className="absolute inset-0 opacity-35 blur-3xl scale-110">
        <ProjectCover coverImageUrl={currentTrack.coverImageUrl} fill />
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_16%,rgba(29,185,84,0.22),transparent_34%),linear-gradient(180deg,rgba(5,5,5,0.1)_0%,#050505_62%)]" />

      <div className="relative min-h-full flex flex-col px-5 py-5 sm:px-8 sm:py-7 max-w-xl mx-auto">
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center transition-colors"
            title="Close"
            aria-label="Close now playing"
          >
            <ChevronDown size={22} strokeWidth={2.7} />
          </button>
          <div className="min-w-0 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">Playing from</p>
            <p className="text-sm font-semibold truncate">{sourceTitle}</p>
          </div>
          <div className="w-10 h-10" />
        </div>

        <div className="flex-1 flex flex-col justify-center py-8 sm:py-10">
          <div className="relative mx-auto w-full max-w-[360px] aspect-square rounded-[22px] overflow-hidden shadow-[0_28px_90px_rgba(0,0,0,0.58)] ring-1 ring-white/10">
            <ProjectCover coverImageUrl={currentTrack.coverImageUrl} fill />
          </div>

          <div className="mt-8 text-center px-1">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight leading-tight">{currentTrack.title}</h2>
            <p className="mt-2 text-base text-white/68 truncate">
              {sourceSubtitle || sourceTitle}
            </p>
          </div>

          <div className="mt-8">
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={(e) => seek(Number(e.target.value))}
              className="w-full"
              style={{ "--progress": `${progressPct}%` } as React.CSSProperties}
            />
            <div className="mt-2 flex items-center justify-between text-xs tabular-nums text-white/45">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-center gap-6">
            <PlayerIconButton
              onClick={previous}
              className="h-14 w-14 bg-white/[0.06] ring-1 ring-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              title="Previous"
              aria-label="Previous track"
            >
              <SkipBack size={28} strokeWidth={2.7} fill="currentColor" />
            </PlayerIconButton>
            <PrimaryPlayButton
              onClick={isPlaying ? pause : resume}
              className="h-[82px] w-[82px]"
              title={isPlaying ? "Pause" : "Play"}
              aria-label={isPlaying ? "Pause" : "Play"}
              isPlaying={isPlaying}
              iconSize={34}
            />
            <PlayerIconButton
              onClick={next}
              className="h-14 w-14 bg-white/[0.06] ring-1 ring-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              title="Next"
              aria-label="Next track"
            >
              <SkipForward size={28} strokeWidth={2.7} fill="currentColor" />
            </PlayerIconButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AudioPlayerBar() {
  const { currentTrack, isPlaying, currentTime, duration, volume, pause, resume, next, previous, seek, setVolume, playingSequenceName } = useAudioPlayer();
  const rangeRef = useRef<HTMLInputElement>(null);
  const [showNowPlaying, setShowNowPlaying] = useState(false);
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const sourceTitle = currentTrack?.sourceTitle || playingSequenceName || null;

  useEffect(() => {
    if (rangeRef.current && duration > 0) {
      rangeRef.current.style.setProperty("--progress", `${progressPct}%`);
    }
  }, [currentTime, duration, progressPct]);

  if (!currentTrack) {
    return (
      <>
        {/* Mobile idle */}
        <div className="sm:hidden h-16 bg-[#181818] border-t border-white/10 flex items-center px-4 gap-3">
          <div className="w-10 h-10 rounded bg-[#282828] flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[#535353]">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
          <p className="text-sm text-[#535353] flex-1">Nothing playing</p>
        </div>
        {/* Desktop idle */}
        <div className="hidden sm:flex h-20 border-t border-border bg-[#0a0a0a] items-center px-4 gap-4">
          <div className="w-12 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">Select a track to play</p>
        </div>
      </>
    );
  }

  return (
    <>
      {showNowPlaying && <NowPlayingView onClose={() => setShowNowPlaying(false)} />}

      {/* ── MOBILE PLAYER ── */}
      <div className="sm:hidden select-none bg-[#111] border-t border-white/10 shadow-[0_-18px_45px_rgba(0,0,0,0.45)]">
        {/* Full-width seekable progress bar */}
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={(e) => seek(Number(e.target.value))}
          className="mobile-seek w-full block"
          style={{ "--progress": `${progressPct}%` } as React.CSSProperties}
        />

        {/* Main row */}
        <div className="flex items-center px-3 h-14 gap-3">
          {/* Cover + track info — tappable to seek */}
          <button
            className="flex items-center gap-3 flex-1 min-w-0 text-left"
            onClick={() => setShowNowPlaying(true)}
          >
            <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0">
              <ProjectCover coverImageUrl={currentTrack.coverImageUrl} size={40} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate leading-tight">{currentTrack.title}</p>
              {sourceTitle && (
                <p className="text-xs text-[#a7a7a7] truncate leading-tight">{sourceTitle}</p>
              )}
            </div>
          </button>

          {/* Controls */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <PlayerIconButton
              onClick={previous}
              className="h-10 w-10"
              title="Previous"
              aria-label="Previous track"
            >
              <SkipBack size={21} strokeWidth={2.8} fill="currentColor" />
            </PlayerIconButton>
            <PrimaryPlayButton
              onClick={isPlaying ? pause : resume}
              className="h-10 w-10"
              title={isPlaying ? "Pause" : "Play"}
              aria-label={isPlaying ? "Pause" : "Play"}
              isPlaying={isPlaying}
              iconSize={19}
            />
            <PlayerIconButton
              onClick={next}
              className="h-10 w-10"
              title="Next"
              aria-label="Next track"
            >
              <SkipForward size={21} strokeWidth={2.8} fill="currentColor" />
            </PlayerIconButton>
          </div>
        </div>
      </div>

      {/* ── DESKTOP PLAYER ── */}
      <div className="hidden sm:flex h-20 border-t border-white/10 bg-[#080808]/95 backdrop-blur-xl items-center px-4 gap-4 select-none shadow-[0_-18px_55px_rgba(0,0,0,0.42)]">
        {/* Track info */}
        <button
          onClick={() => setShowNowPlaying(true)}
          className="flex items-center gap-3 w-64 flex-shrink-0 text-left rounded-lg hover:bg-white/5 p-1.5 -ml-1.5 transition-colors"
        >
          <div className="w-11 h-11 rounded overflow-hidden flex-shrink-0">
            <ProjectCover coverImageUrl={currentTrack.coverImageUrl} size={44} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{currentTrack.title}</p>
            {sourceTitle && (
              <p className="text-xs text-primary/80 truncate">{sourceTitle}</p>
            )}
          </div>
        </button>

        {/* Player controls + seek */}
        <div className="flex-1 flex flex-col items-center gap-1">
          <div className="flex items-center gap-4">
            <PlayerIconButton
              onClick={previous}
              className="h-9 w-9 bg-white/[0.035] ring-1 ring-white/[0.06]"
              title="Previous"
              aria-label="Previous track"
            >
              <SkipBack size={20} strokeWidth={2.8} fill="currentColor" />
            </PlayerIconButton>
            <PrimaryPlayButton
              onClick={isPlaying ? pause : resume}
              className="h-10 w-10"
              title={isPlaying ? "Pause" : "Play"}
              aria-label={isPlaying ? "Pause" : "Play"}
              isPlaying={isPlaying}
              iconSize={18}
            />
            <PlayerIconButton
              onClick={next}
              className="h-9 w-9 bg-white/[0.035] ring-1 ring-white/[0.06]"
              title="Next"
              aria-label="Next track"
            >
              <SkipForward size={20} strokeWidth={2.8} fill="currentColor" />
            </PlayerIconButton>
          </div>
          <div className="w-full max-w-sm flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">{formatTime(currentTime)}</span>
            <input
              ref={rangeRef}
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={(e) => seek(Number(e.target.value))}
              className="flex-1"
              style={{ "--progress": `${progressPct}%` } as React.CSSProperties}
            />
            <span className="text-xs text-muted-foreground w-8 tabular-nums">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Volume */}
        <div className="w-32 flex-shrink-0 flex items-center gap-2">
          <Volume2 size={16} strokeWidth={2.4} className="text-muted-foreground" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="flex-1"
            style={{ "--progress": `${volume * 100}%` } as React.CSSProperties}
          />
        </div>
      </div>
    </>
  );
}
