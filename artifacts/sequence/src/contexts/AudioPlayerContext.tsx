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
const CROSSFADE_SECONDS = 8;

function equalPowerCrossfade(pct: number) {
  const clamped = Math.min(1, Math.max(0, pct));
  return {
    outgoing: Math.cos(clamped * Math.PI / 2),
    incoming: Math.sin(clamped * Math.PI / 2),
  };
}

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
  const crossfadeRef = useRef<{
    incoming: HTMLAudioElement;
    outgoing: HTMLAudioElement;
    raf: number;
  } | null>(null);
  const queueRef = useRef<PlayerTrack[]>([]);
  const currentTrackRef = useRef<PlayerTrack | null>(null);
  const rafRef = useRef<number>(0);
  const isSeekingRef = useRef(false);
  const volumeRef = useRef(0.8);
  const transitionKeyRef = useRef<string | null>(null);
  const startQueueTransitionRef = useRef<(direction: 1 | -1, crossfade?: boolean) => void>(() => {});

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
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  const stopCrossfade = useCallback(() => {
    const crossfade = crossfadeRef.current;
    if (!crossfade) return;
    cancelAnimationFrame(crossfade.raf);
    crossfade.outgoing.pause();
    crossfade.outgoing.src = "";
    crossfade.incoming.volume = volumeRef.current;
    crossfadeRef.current = null;
  }, []);

  const startRaf = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !isSeekingRef.current) {
        setCurrentTime(audio.currentTime);
        if (
          !crossfadeRef.current &&
          !audio.paused &&
          Number.isFinite(audio.duration) &&
          audio.duration > 0
        ) {
          const q = queueRef.current;
          const ct = currentTrackRef.current;
          const idx = q.findIndex(t => t.id === ct?.id);
          const next = idx >= 0 ? q[idx + 1] : null;
          const key = next ? `${ct?.id}:${next.id}` : null;
          const remaining = audio.duration - audio.currentTime;
          if (next && key && transitionKeyRef.current !== key && remaining <= CROSSFADE_SECONDS) {
            transitionKeyRef.current = key;
            startQueueTransitionRef.current(1, true);
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopRaf = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
  }, []);

  const prepareAudioElement = useCallback((audio: HTMLAudioElement) => {
    audio.preload = "auto";
    audio.volume = volumeRef.current;

    const onDuration = () => {
      if (audio === audioRef.current) setDuration(audio.duration || 0);
    };
    const onEnded = () => {
      if (audio !== audioRef.current) return;
      stopRaf();
      setIsPlaying(false);
      startQueueTransitionRef.current(1, false);
    };
    const onSeeking = () => {
      if (audio === audioRef.current) isSeekingRef.current = true;
    };
    const onSeeked = () => {
      if (audio !== audioRef.current) return;
      isSeekingRef.current = false;
      setCurrentTime(audio.currentTime);
    };
    const onPlay = () => {
      if (audio !== audioRef.current) return;
      setIsPlaying(true);
      startRaf();
    };
    const onPause = () => {
      if (audio !== audioRef.current || crossfadeRef.current) return;
      setIsPlaying(false);
      stopRaf();
    };

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
    };
  }, [startRaf, stopRaf]);

  useEffect(() => {
    const audio = new Audio();
    const cleanup = prepareAudioElement(audio);
    audioRef.current = audio;

    return () => {
      stopCrossfade();
      cleanup();
      stopRaf();
    };
  }, [prepareAudioElement, stopCrossfade, stopRaf]);

  const playTrackOnAudio = useCallback((audio: HTMLAudioElement, track: PlayerTrack) => {
    audio.src = audioCacheService.getPlaybackUrl(track.fileUrl);
    audio.load();
    return audio.play();
  }, []);

  const directSwitchToTrack = useCallback((track: PlayerTrack, queueIndex: number) => {
    stopCrossfade();
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTrack(track);
    setCurrentTime(0);
    setDuration(0);
    audio.volume = volumeRef.current;
    playTrackOnAudio(audio, track).catch(() => {});
    bgCache(track.fileUrl);
    const q = queueRef.current;
    if (queueIndex + 1 < q.length) bgCache(q[queueIndex + 1].fileUrl);
  }, [playTrackOnAudio, stopCrossfade]);

  const crossfadeToTrack = useCallback((track: PlayerTrack, queueIndex: number) => {
    const outgoing = audioRef.current;
    if (!outgoing || outgoing.paused) {
      directSwitchToTrack(track, queueIndex);
      return;
    }

    stopCrossfade();

    const incoming = new Audio();
    prepareAudioElement(incoming);
    incoming.volume = 0;
    incoming.src = audioCacheService.getPlaybackUrl(track.fileUrl);
    incoming.load();

    incoming.play().then(() => {
      const totalMs = Math.max(
        500,
        Math.min(
          CROSSFADE_SECONDS * 1000,
          Number.isFinite(outgoing.duration)
            ? Math.max(500, (outgoing.duration - outgoing.currentTime) * 1000)
            : CROSSFADE_SECONDS * 1000,
        ),
      );
      const startedAt = performance.now();

      audioRef.current = incoming;
      setCurrentTrack(track);
      setCurrentTime(0);
      setDuration(incoming.duration || track.durationSeconds || 0);
      setIsPlaying(true);
      startRaf();

      const step = (now: number) => {
        const pct = Math.min(1, (now - startedAt) / totalMs);
        const gain = equalPowerCrossfade(pct);
        const targetVolume = volumeRef.current;
        outgoing.volume = Math.max(0, targetVolume * gain.outgoing);
        incoming.volume = Math.min(targetVolume, targetVolume * gain.incoming);

        if (pct < 1) {
          const raf = requestAnimationFrame(step);
          if (crossfadeRef.current) crossfadeRef.current.raf = raf;
          return;
        }

        outgoing.pause();
        outgoing.src = "";
        incoming.volume = volumeRef.current;
        crossfadeRef.current = null;
      };

      const raf = requestAnimationFrame(step);
      crossfadeRef.current = { incoming, outgoing, raf };
      bgCache(track.fileUrl);
      const q = queueRef.current;
      if (queueIndex + 1 < q.length) bgCache(q[queueIndex + 1].fileUrl);
    }).catch(() => {
      directSwitchToTrack(track, queueIndex);
    });
  }, [directSwitchToTrack, prepareAudioElement, startRaf, stopCrossfade]);

  const startQueueTransition = useCallback((direction: 1 | -1, crossfade = true) => {
    const q = queueRef.current;
    const ct = currentTrackRef.current;
    const idx = q.findIndex(t => t.id === ct?.id);
    const nextIndex = idx + direction;
    if (nextIndex < 0 || nextIndex >= q.length) return;
    const nextTrack = q[nextIndex];
    if (crossfade && direction === 1) {
      crossfadeToTrack(nextTrack, nextIndex);
    } else {
      directSwitchToTrack(nextTrack, nextIndex);
    }
  }, [crossfadeToTrack, directSwitchToTrack]);

  useEffect(() => {
    startQueueTransitionRef.current = startQueueTransition;
  }, [startQueueTransition]);

  const play = useCallback((track: PlayerTrack, newQueue?: PlayerTrack[]) => {
    const audio = audioRef.current;
    if (!audio) return;
    stopCrossfade();
    transitionKeyRef.current = null;
    if (newQueue) setQueueState(newQueue);
    setCurrentTrack(track);
    setCurrentTime(0);
    setDuration(0);

    // Always stream immediately — use blob URL if already in memory, else network
    audio.volume = volumeRef.current;
    playTrackOnAudio(audio, track).catch(() => {});

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
  }, [playTrackOnAudio, stopCrossfade]);

  const pause = useCallback(() => {
    const crossfade = crossfadeRef.current;
    if (crossfade) {
      crossfade.incoming.pause();
      crossfade.outgoing.pause();
    }
    audioRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    const crossfade = crossfadeRef.current;
    if (crossfade) {
      crossfade.outgoing.play().catch(() => {});
      crossfade.incoming.play().catch(() => {});
      setIsPlaying(true);
      startRaf();
      return;
    }
    audioRef.current?.play().catch(() => {});
  }, [startRaf]);

  const next = useCallback(() => {
    startQueueTransition(1, true);
  }, [startQueueTransition]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    const q = queueRef.current;
    const ct = currentTrackRef.current;
    if (!audio) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    startQueueTransition(-1, false);
  }, [startQueueTransition]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(time);
    audio.currentTime = time;
  }, []);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    volumeRef.current = vol;
    if (audioRef.current) audioRef.current.volume = vol;
    if (crossfadeRef.current) {
      crossfadeRef.current.incoming.volume = Math.min(crossfadeRef.current.incoming.volume, vol);
      crossfadeRef.current.outgoing.volume = Math.min(crossfadeRef.current.outgoing.volume, vol);
    }
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
