import React, { useEffect, useRef } from "react";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { ProjectCover } from "@/lib/svg-generator";

function formatTime(s: number) {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function AudioPlayerBar() {
  const { currentTrack, isPlaying, currentTime, duration, volume, pause, resume, next, previous, seek, setVolume, playingSequenceName } = useAudioPlayer();
  const rangeRef = useRef<HTMLInputElement>(null);
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

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
      {/* ── MOBILE PLAYER ── */}
      <div className="sm:hidden select-none bg-[#181818] border-t border-white/10">
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
            onClick={isPlaying ? pause : resume}
          >
            <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0">
              <ProjectCover coverImageUrl={currentTrack.coverImageUrl} size={40} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate leading-tight">{currentTrack.title}</p>
              {playingSequenceName && (
                <p className="text-xs text-[#a7a7a7] truncate leading-tight">{playingSequenceName}</p>
              )}
            </div>
          </button>

          {/* Controls */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={previous}
              className="w-10 h-10 flex items-center justify-center text-[#a7a7a7] active:text-white transition-colors"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
              </svg>
            </button>
            <button
              onClick={isPlaying ? pause : resume}
              className="w-10 h-10 flex items-center justify-center text-white"
            >
              {isPlaying ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              ) : (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>
            <button
              onClick={next}
              className="w-10 h-10 flex items-center justify-center text-[#a7a7a7] active:text-white transition-colors"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── DESKTOP PLAYER ── */}
      <div className="hidden sm:flex h-20 border-t border-border bg-[#0a0a0a] items-center px-4 gap-4 select-none">
        {/* Track info */}
        <div className="flex items-center gap-3 w-64 flex-shrink-0">
          <div className="w-11 h-11 rounded overflow-hidden flex-shrink-0">
            <ProjectCover coverImageUrl={currentTrack.coverImageUrl} size={44} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{currentTrack.title}</p>
            {playingSequenceName && (
              <p className="text-xs text-primary/80 truncate">{playingSequenceName}</p>
            )}
          </div>
        </div>

        {/* Player controls + seek */}
        <div className="flex-1 flex flex-col items-center gap-1">
          <div className="flex items-center gap-5">
            <button onClick={previous} className="text-muted-foreground hover:text-foreground transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
              </svg>
            </button>
            <button
              onClick={isPlaying ? pause : resume}
              className="w-9 h-9 rounded-full bg-white flex items-center justify-center hover:scale-105 transition-transform"
            >
              {isPlaying ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#121212">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#121212">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>
            <button onClick={next} className="text-muted-foreground hover:text-foreground transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
              </svg>
            </button>
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground">
            <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
          </svg>
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
