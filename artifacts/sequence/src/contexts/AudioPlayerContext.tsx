import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from "react";
import { audioCacheService } from "@/lib/audio-cache";
import { resolveCoverUrl } from "@/lib/image-cache";

export interface PlayerTrack {
  id: string;
  title: string;
  fileUrl: string;
  coverImageUrl?: string | null;
  sourceType?: "project" | "personal" | "team" | "shared";
  sourceTitle?: string | null;
  sourceSubtitle?: string | null;
  durationSeconds?: number | null;
  bpm?: number | null;
  camelotKey?: string | null;
}

interface AudioPlayerContextValue {
  currentTrack: PlayerTrack | null;
  queue: PlayerTrack[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playingSequenceId: string | null;
  playingSequenceName: string | null;
  play: (track: PlayerTrack, queue?: PlayerTrack[]) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  previous: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  setQueue: (tracks: PlayerTrack[]) => void;
  setPlayingSource: (info: { sequenceId: string | null; sequenceName: string | null }) => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

/**
 * Background-cache a track and call onReady(blobUrl) once it's stored.
 * Used to switch a streaming audio element to local playback once downloaded.
 */
function bgCache(fileUrl: string, onReady?: (blobUrl: string) => void) {
  const existing = audioCacheService.getBlobUrl(fileUrl);
  if (existing) { onReady?.(existing); return; }
  audioCacheService.cacheTrack(fileUrl)
    .then(success => {
      if (success && onReady) {
        const blob = audioCacheService.getBlobUrl(fileUrl);
        if (blob) onReady(blob);
      }
    })
    .catch(() => {});
}

function absoluteArtworkUrl(url?: string | null) {
  if (!url || typeof window === "undefined") return null;
  const resolved = resolveCoverUrl(url);
  if (resolved.startsWith("blob:") || /^https?:\/\//i.test(resolved)) return resolved;
  return `${window.location.origin}${resolved.startsWith("/") ? resolved : `/${resolved}`}`;
}

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<PlayerTrack[]>([]);
  const currentTrackRef = useRef<PlayerTrack | null>(null);
  const rafRef = useRef<number>(0);
  const isSeekingRef = useRef(false);

  const [currentTrack, setCurrentTrack] = useState<PlayerTrack | null>(null);
  const [queue, setQueueState] = useState<PlayerTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [playingSequenceId, setPlayingSequenceId] = useState<string | null>(null);
  const [playingSequenceName, setPlayingSequenceName] = useState<string | null>(null);

  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);

  const startRaf = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !isSeekingRef.current) setCurrentTime(audio.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopRaf = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = volume;
    audioRef.current = audio;

    const onDuration = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      stopRaf();
      setIsPlaying(false);
      const q = queueRef.current;
      const ct = currentTrackRef.current;
      const idx = q.findIndex(t => t.id === ct?.id);
      if (idx >= 0 && idx < q.length - 1) {
        const next = q[idx + 1];
        // Use cached URL if available, else stream
        audio.src = audioCacheService.getPlaybackUrl(next.fileUrl);
        audio.load();
        audio.play().then(() => {
          setCurrentTrack(next);
          setIsPlaying(true);
          startRaf();
          // Pre-cache the track after
          if (idx + 2 < q.length) bgCache(q[idx + 2].fileUrl);
        }).catch(() => {});
        // Background-cache if not already stored
        bgCache(next.fileUrl);
      }
    };
    const onSeeking = () => { isSeekingRef.current = true; };
    const onSeeked = () => { isSeekingRef.current = false; setCurrentTime(audio.currentTime); };
    const onPlay = () => { setIsPlaying(true); startRaf(); };
    const onPause = () => { setIsPlaying(false); stopRaf(); };

    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("seeking", onSeeking);
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("seeking", onSeeking);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.pause();
      audio.src = "";
      stopRaf();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback((track: PlayerTrack, newQueue?: PlayerTrack[]) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (newQueue) setQueueState(newQueue);
    setCurrentTrack(track);
    setCurrentTime(0);
    setDuration(0);

    // Always stream immediately — use blob URL if already in memory, else network
    const src = audioCacheService.getPlaybackUrl(track.fileUrl);
    audio.src = src;
    audio.load();
    audio.play().catch(() => {});

    // If we're streaming from network, download in background then seamlessly
    // switch to the local blob so the rest of playback is zero-network
    if (!audioCacheService.getBlobUrl(track.fileUrl)) {
      bgCache(track.fileUrl, (blobUrl) => {
        const a = audioRef.current;
        const ct = currentTrackRef.current;
        if (!a || ct?.id !== track.id) return;
        const savedTime = a.currentTime;
        const wasPaused = a.paused;
        a.src = blobUrl;
        a.load();
        a.addEventListener("loadedmetadata", function onMeta() {
          a.removeEventListener("loadedmetadata", onMeta);
          a.currentTime = savedTime;
          if (!wasPaused) a.play().catch(() => {});
        }, { once: true });
      });
    }

    // Pre-cache the next track so the transition is instant
    if (newQueue) {
      const idx = newQueue.findIndex(t => t.id === track.id);
      if (idx >= 0 && idx + 1 < newQueue.length) bgCache(newQueue[idx + 1].fileUrl);
    }
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    audioRef.current?.play().catch(() => {});
  }, []);

  const next = useCallback(() => {
    const audio = audioRef.current;
    const q = queueRef.current;
    const ct = currentTrackRef.current;
    const idx = q.findIndex(t => t.id === ct?.id);
    if (idx >= 0 && idx < q.length - 1 && audio) {
      const nextTrack = q[idx + 1];
      setCurrentTrack(nextTrack);
      setCurrentTime(0);
      audio.src = audioCacheService.getPlaybackUrl(nextTrack.fileUrl);
      audio.load();
      audio.play().catch(() => {});
      bgCache(nextTrack.fileUrl);
      if (idx + 2 < q.length) bgCache(q[idx + 2].fileUrl);
    }
  }, []);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    const q = queueRef.current;
    const ct = currentTrackRef.current;
    if (!audio) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const idx = q.findIndex(t => t.id === ct?.id);
    if (idx > 0) {
      const prevTrack = q[idx - 1];
      setCurrentTrack(prevTrack);
      setCurrentTime(0);
      audio.src = audioCacheService.getPlaybackUrl(prevTrack.fileUrl);
      audio.load();
      audio.play().catch(() => {});
      bgCache(prevTrack.fileUrl);
    }
  }, []);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(time);
    audio.currentTime = time;
  }, []);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    if (audioRef.current) audioRef.current.volume = vol;
  }, []);

  const setQueue = useCallback((tracks: PlayerTrack[]) => {
    setQueueState(tracks);
  }, []);

  const setPlayingSource = useCallback((info: { sequenceId: string | null; sequenceName: string | null }) => {
    setPlayingSequenceId(info.sequenceId);
    setPlayingSequenceName(info.sequenceName);
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack) return;

    const artworkUrl = absoluteArtworkUrl(currentTrack.coverImageUrl);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.sourceTitle || playingSequenceName || "Syncr",
      album: currentTrack.sourceSubtitle || currentTrack.sourceTitle || "Syncr",
      artwork: artworkUrl
        ? [
            { src: artworkUrl, sizes: "96x96", type: "image/jpeg" },
            { src: artworkUrl, sizes: "256x256", type: "image/jpeg" },
            { src: artworkUrl, sizes: "512x512", type: "image/jpeg" },
          ]
        : undefined,
    });

    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
      navigator.mediaSession.setActionHandler("play", resume);
      navigator.mediaSession.setActionHandler("pause", pause);
      navigator.mediaSession.setActionHandler("previoustrack", previous);
      navigator.mediaSession.setActionHandler("nexttrack", next);
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (typeof details.seekTime === "number") seek(details.seekTime);
      });
    } catch {
      // Media Session support differs across browsers and iOS versions.
    }
  }, [currentTrack, isPlaying, playingSequenceName, resume, pause, previous, next, seek]);

  return (
    <AudioPlayerContext.Provider value={{
      currentTrack, queue, isPlaying, currentTime, duration, volume,
      playingSequenceId, playingSequenceName,
      play, pause, resume, next, previous, seek, setVolume, setQueue, setPlayingSource,
    }}>
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error("useAudioPlayer must be used within AudioPlayerProvider");
  return ctx;
}
