import React from "react";
import { Target } from "lucide-react";
import { motion } from "motion/react";

// Warm, educational high-performance waveform visualizer
export interface WarmWaveformProps {
  barRefs: React.RefObject<HTMLDivElement | null>[];
}

export function WarmWaveform({ barRefs }: WarmWaveformProps) {
  return (
    <div className="relative w-48 h-48 mx-auto flex flex-col items-center justify-center bg-white rounded-[2.5rem] shadow-xl shadow-stone-200/50 border border-stone-100 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-50/50 to-orange-50/50 opacity-50" />
      <div className="relative z-10 flex items-center gap-2.5 h-16 justify-center">
        {barRefs.map((ref, i) => (
          <div
            key={i}
            ref={ref}
            className="w-2.5 bg-stone-300 rounded-full transition-all duration-75"
            style={{ height: "12px" }}
          />
        ))}
      </div>
    </div>
  );
}

// Clean transition card component with transparent surroundings to avoid grey blurred effects
export interface TransitionCardProps {
  title: string;
  subtitle?: string;
}

export function TransitionCard({ title, subtitle }: TransitionCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 15 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -15 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-transparent pointer-events-none"
    >
      <div className="w-80 h-48 bg-amber-600 text-white rounded-3xl shadow-2xl flex flex-col items-center justify-center p-6 border border-amber-500 text-center pointer-events-auto">
        <Target size={36} className="text-amber-200 mb-3" />
        <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
        {subtitle && <p className="text-amber-100 mt-2 font-medium text-sm">{subtitle}</p>}
      </div>
    </motion.div>
  );
}

// Beautiful interactive SVG countdown circular timer
export interface CircularTimerProps {
  value: number;
  maxValue: number;
  title: string;
  subtitle?: string;
  colorClass?: string;
  noCard?: boolean;
  children?: React.ReactNode;
}

export function CircularTimer({
  value,
  maxValue,
  title,
  subtitle,
  colorClass = "text-amber-600",
  noCard = false,
  children,
}: CircularTimerProps) {
  const size = 150;
  const strokeWidth = 8;
  const center = size / 2;
  const radius = center - strokeWidth;
  const circumference = radius * 2 * Math.PI;
  const percentage = Math.min(1, Math.max(0, value / maxValue));
  const strokeDashoffset = circumference - percentage * circumference;

  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  const containerClass = noCard
    ? "flex flex-col items-center justify-center text-center w-full max-w-sm mx-auto"
    : "flex flex-col items-center justify-center text-center p-6 bg-white rounded-[2rem] border border-stone-200 shadow-xl shadow-stone-200/40 w-full max-w-sm mx-auto";

  return (
    <div className={containerClass}>
      <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">{title}</h4>
      <div className="relative mb-3.5" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <circle
            className="text-stone-100"
            strokeWidth={strokeWidth}
            stroke="currentColor"
            fill="transparent"
            r={radius}
            cx={center}
            cy={center}
          />
          <motion.circle
            className={colorClass}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            initial={{ strokeDashoffset }}
            animate={{ strokeDashoffset }}
            transition={{ ease: "linear", duration: 0.5 }}
            strokeLinecap="round"
            stroke="currentColor"
            fill="transparent"
            r={radius}
            cx={center}
            cy={center}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-mono font-bold text-stone-800 tracking-tight leading-none">
            {timeStr}
          </span>
        </div>
      </div>
      {subtitle && (
        <span className="text-[11px] text-stone-500 uppercase font-bold tracking-widest animate-pulse">
          {subtitle}
        </span>
      )}
      {children}
    </div>
  );
}

// Utility to parse cue card text and fetch mock questions context
export function getPart2Bullets(part2: string, customBullets?: string[]): string[] {
  if (customBullets && customBullets.length > 0) {
    return customBullets;
  }

  const text = part2.toLowerCase();

  if (
    text.includes("friend") ||
    text.includes("person") ||
    text.includes("someone") ||
    text.includes("singer") ||
    text.includes("actor") ||
    text.includes("leader") ||
    text.includes("family")
  ) {
    return [
      "who this person is",
      "how you know or met them",
      "what kind of person they are",
      "explain why they are important to you or how you feel about them.",
    ];
  }

  if (
    text.includes("place") ||
    text.includes("country") ||
    text.includes("city") ||
    text.includes("building") ||
    text.includes("ocean") ||
    text.includes("forest") ||
    text.includes("oasis") ||
    text.includes("room") ||
    text.includes("house") ||
    text.includes("shop")
  ) {
    return [
      "what and where this place is",
      "how you know or found out about it",
      "what it looks like or what people do there",
      "explain why you want to visit this place or why it is special to you.",
    ];
  }

  if (
    text.includes("animal") ||
    text.includes("pet") ||
    text.includes("bird") ||
    text.includes("insect")
  ) {
    return [
      "what animal it is",
      "where it lives or where you saw it",
      "what you know about its habits or appearance",
      "explain why you are interested in this animal or want to learn more about it.",
    ];
  }

  if (
    text.includes("time") ||
    text.includes("experience") ||
    text.includes("activity") ||
    text.includes("trip") ||
    text.includes("journey") ||
    text.includes("event") ||
    text.includes("party") ||
    text.includes("game") ||
    text.includes("holiday") ||
    text.includes("sport") ||
    text.includes("competition")
  ) {
    return [
      "what the event or activity was",
      "when and where it happened",
      "who you were with or who was involved",
      "explain how you felt about it and what made it memorable.",
    ];
  }

  if (
    text.includes("book") ||
    text.includes("movie") ||
    text.includes("film") ||
    text.includes("song") ||
    text.includes("music") ||
    text.includes("gift") ||
    text.includes("object") ||
    text.includes("thing") ||
    text.includes("technology") ||
    text.includes("invention") ||
    text.includes("advertisement") ||
    text.includes("website") ||
    text.includes("app")
  ) {
    return [
      "what the object or item is",
      "when and how you first got or saw/heard it",
      "what it is used for or what it is about",
      "explain why you like or dislike it, and why it is significant.",
    ];
  }

  return [
    "what it is or who is involved",
    "how you first became aware of it",
    "what key details characterize it",
    "explain why it is important or memorable to you.",
  ];
}
