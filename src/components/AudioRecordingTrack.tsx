import React, { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2 } from "lucide-react";

export interface AudioRecordingTrackProps {
  blob: Blob | null;
  label: string;
}

export function AudioRecordingTrack({ blob, label }: AudioRecordingTrackProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string>("");

  useEffect(() => {
    if (blob) {
      const u = URL.createObjectURL(blob);
      setUrl(u);
      return () => {
        URL.revokeObjectURL(u);
      };
    }
  }, [blob]);

  useEffect(() => {
    if (!url) return;
    const audio = new Audio(url);
    audioRef.current = audio;

    const onLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);

    const handleGlobalPlay = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.url !== url) {
        audio.pause();
        setIsPlaying(false);
      }
    };
    window.addEventListener("stopAllRecordingTracks", handleGlobalPlay);

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      window.removeEventListener("stopAllRecordingTracks", handleGlobalPlay);
      audioRef.current = null;
    };
  }, [url]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      window.dispatchEvent(
        new CustomEvent("stopAllRecordingTracks", { detail: { url } })
      );
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.error("Audio playback failed:", err);
      });
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const seekTime = parseFloat(e.target.value);
    audioRef.current.currentTime = seekTime;
    setCurrentTime(seekTime);
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  if (!blob) {
    return (
      <div className="flex items-center justify-between p-4 bg-stone-50 border border-stone-200/60 rounded-xl opacity-60">
        <div className="flex items-center gap-3">
          <Volume2 size={16} className="text-stone-400 animate-pulse" />
          <span className="text-xs font-semibold text-stone-500">{label}</span>
        </div>
        <span className="text-[10px] font-mono text-stone-400 uppercase tracking-wider">No Recording Captured</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-amber-50/40 border border-amber-200/50 rounded-2xl shadow-sm hover:shadow transition-all gap-4">
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-amber-500 text-white flex items-center justify-center hover:bg-amber-600 transition-all cursor-pointer shadow-md shadow-amber-500/10 active:scale-95 flex-shrink-0"
        >
          {isPlaying ? <Pause size={16} fill="white" /> : <Play size={16} className="ml-0.5" fill="white" />}
        </button>
        <div>
          <span className="text-xs font-bold text-stone-800 block leading-tight">{label}</span>
          <span className="text-[10px] font-mono text-stone-400 leading-tight">
            {formatTimer(currentTime)} / {formatTimer(duration || 0)}
          </span>
        </div>
      </div>

      <div className="flex-grow flex items-center gap-3">
        <input
          type="range"
          min="0"
          max={duration || 105}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
          style={{
            background: `linear-gradient(to right, #f59e0b 0%, #f59e0b ${(currentTime / (duration || 1)) * 100}%, #e5e7eb ${(currentTime / (duration || 1)) * 100}%, #e5e7eb 100%)`
          }}
        />
      </div>

      {isPlaying && (
        <div className="flex items-center gap-0.5 flex-shrink-0 pr-1">
          <span className="w-1 h-3 bg-amber-500 rounded-full animate-[bounce_1s_infinite_100ms]" />
          <span className="w-1 h-4 bg-amber-500 rounded-full animate-[bounce_1s_infinite_300ms]" />
          <span className="w-1 h-2 bg-amber-500 rounded-full animate-[bounce_1s_infinite_200ms]" />
        </div>
      )}
    </div>
  );
}
