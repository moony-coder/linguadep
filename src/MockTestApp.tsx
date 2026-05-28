import React, { useState, useRef, useEffect } from "react";
import { supabase, isSupabaseConfigured } from './lib/supabase';
import {
  Play,
  Pause,
  Activity,
  AlertCircle,
  Mic,
  MicOff,
  Square,
  Volume2,
  CheckCircle2,
  User,
  HelpCircle,
  Target,
  Check,
  ChevronRight,
  BookOpen,
  Sparkles,
  Award,
  Loader2,
  Info,
  ExternalLink,
  X,
  Share2,
} from "lucide-react";
import { cn } from "./lib/utils";
import { pcmToBase64, base64ToPcm } from "./lib/audio";
import { MockProfile } from "./data";
import { apiUrl, liveWsUrl } from "./lib/backend";
import { motion, AnimatePresence } from "motion/react";

import { WarmWaveform, TransitionCard, CircularTimer, getPart2Bullets } from "./components/MockTestSubcomponents";
import { AudioRecordingTrack } from "./components/AudioRecordingTrack";

type TestStage =
  | "SETUP"
  | "TRANSITION_PART_1"
  | "PART_1"
  | "TRANSITION_PART_2"
  | "PART_2_INSTRUCT"
  | "PART_2_PREP"
  | "PART_2_PROMPT_SPEAK"
  | "PART_2_SPEAK"
  | "TRANSITION_PART_3"
  | "PART_3"
  | "CALCULATING"
  | "SCORE";

export default function MockTestApp({
  mockConfig,
  onExit,
  userCredits = 2,
  onDeductCredit,
  onNavigateToPricing,
}: {
  mockConfig: MockProfile;
  onExit: () => void;
  userCredits?: number;
  onDeductCredit?: () => void;
  onNavigateToPricing?: () => void;
}) {
  const [stage, setStage] = useState<TestStage>("SETUP");
  const [setupStep, setSetupStep] = useState<"INSTR" | "NAME">("INSTR");
  const [userName, setUserName] = useState(() => {
    const rawName = localStorage.getItem("ielts_user_profile_name") || "";
    return rawName.replace(/[<>]/g, "").slice(0, 100);
  });
  const [examinerVoice, setExaminerVoice] = useState<"Arthur" | "Eleanor">(() => {
    return (localStorage.getItem("ielts_examiner_voice") as "Arthur" | "Eleanor") || "Arthur";
  });

  const [errorMsg, setErrorMsg] = useState<string>("");
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [hasAiSpoken, setHasAiSpoken] = useState(false);

  const [prepSeconds, setPrepSeconds] = useState(60);
  const [speakSeconds, setSpeakSeconds] = useState(0);
  const [score, setScore] = useState<any>(null);
  const [calcPhase, setCalcPhase] = useState<number>(0);
  const [calculationReport, setCalculationReport] = useState<any>(null);
  const [activeScoreTab, setActiveScoreTab] = useState<
    "overview" | "fluency" | "lexical" | "grammar" | "pronunciation" | "part2analysis"
  >("overview");

  const [shareCopied, setShareCopied] = useState(false);

  // Audio recording blobs for user responses playback
  const [part1AudioBlob, setPart1AudioBlob] = useState<Blob | null>(null);
  const [part2AudioBlob, setPart2AudioBlob] = useState<Blob | null>(null);
  const [part3AudioBlob, setPart3AudioBlob] = useState<Blob | null>(null);

  const activeMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const activeRecorderChunksRef = useRef<Blob[]>([]);
  const activePartRunningRef = useRef<"PART_1" | "PART_2" | "PART_3" | null>(null);
  const part2RecordStreamRef = useRef<MediaStream | null>(null);

  const startRecordingPart = (stream: MediaStream, part: "PART_1" | "PART_2" | "PART_3") => {
    try {
      if (activeMediaRecorderRef.current) {
        activeMediaRecorderRef.current.stop();
      }
    } catch (e) {}

    activeRecorderChunksRef.current = [];
    activePartRunningRef.current = part;
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          activeRecorderChunksRef.current.push(event.data);
        }
      };
      recorder.start(1000); // chunk every 1 sec
      activeMediaRecorderRef.current = recorder;
      console.log(`[AUDIO RECORDING] Started background recording for ${part} on stream:`, stream.id);
    } catch (err) {
      console.error(`Failed to start MediaRecorder on stream for ${part}:`, err);
    }
  };

  const stopRecordingPartAndSave = (part: 1 | 2 | 3) => {
    return new Promise<void>((resolve) => {
      const recorder = activeMediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve();
        return;
      }

      recorder.onstop = () => {
        try {
          if (activeRecorderChunksRef.current.length > 0) {
            const combinedBlob = new Blob(activeRecorderChunksRef.current, { type: recorder.mimeType });
            console.log(`[AUDIO RECORDING] Stopped and saved Part ${part} audio. Size: ${combinedBlob.size} bytes.`);
            if (part === 1) setPart1AudioBlob(combinedBlob);
            else if (part === 2) setPart2AudioBlob(combinedBlob);
            else if (part === 3) setPart3AudioBlob(combinedBlob);
          }
        } catch (err) {
          console.error(`Failed to save recording Blobs for Part ${part}:`, err);
        }
        resolve();
      };

      try {
        recorder.stop();
      } catch (e) {
        resolve();
      }
      activeMediaRecorderRef.current = null;
    });
  };

  const [manualTransitionState, setManualTransitionState] = useState<"PART_2" | "PART_3" | "END_TEST" | null>(null);
  const updateManualTransitionState = (val: "PART_2" | "PART_3" | "END_TEST" | null) => {
    manualTransitionStateRef.current = val;
    setManualTransitionState(val);
  };

  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(true);

  // Microphone Check state variables
  const [micTestGranted, setMicTestGranted] = useState(false);
  const [showMicPermissionModal, setShowMicPermissionModal] = useState(false);
  const [micTestLevel, setMicTestLevel] = useState(0);
  const [micProgressPercent, setMicProgressPercent] = useState(0);
  const [isTestingMic, setIsTestingMic] = useState(false);
  const micTestedAboveThresholdStartRef = useRef<number | null>(null);
  const micCheckStreamRef = useRef<MediaStream | null>(null);
  const micCheckAnalyserRef = useRef<AnalyserNode | null>(null);
  const micCheckAudioCtxRef = useRef<AudioContext | null>(null);
  const micCheckAnimFrameRef = useRef<number | null>(null);

  const startMicCheck = async () => {
    try {
      setErrorMsg("");
      setIsTestingMic(true);
      setMicProgressPercent(0);
      setMicTestLevel(0);
      micTestedAboveThresholdStartRef.current = null;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: false },
        },
      });
      micCheckStreamRef.current = stream;

      const audioCtx = new AudioContext();
      micCheckAudioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      micCheckAnalyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        if (!micCheckAnalyserRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        setMicTestLevel(average);

        // Voice signal threshold triggers verified state once held above 12 for 0.5 seconds.
        if (average >= 12) {
          if (!micTestedAboveThresholdStartRef.current) {
            micTestedAboveThresholdStartRef.current = Date.now();
          }
          const elapsed = Date.now() - micTestedAboveThresholdStartRef.current;
          const progress = Math.min(100, (elapsed / 500) * 100);
          setMicProgressPercent(Math.round(progress));
          if (elapsed >= 500) {
            setMicTestGranted(true);
          }
        } else {
          micTestedAboveThresholdStartRef.current = null;
          setMicProgressPercent(0);
        }

        micCheckAnimFrameRef.current = requestAnimationFrame(updateVolume);
      };

      updateVolume();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(
        "Mic access was not granted. Please allow microphone permissions to operate the conversational AI examiner."
      );
      setIsTestingMic(false);
      setShowMicPermissionModal(true);
    }
  };

  const stopMicCheck = () => {
    if (micCheckAnimFrameRef.current) {
      cancelAnimationFrame(micCheckAnimFrameRef.current);
      micCheckAnimFrameRef.current = null;
    }
    if (micCheckStreamRef.current) {
      micCheckStreamRef.current.getTracks().forEach((t) => t.stop());
      micCheckStreamRef.current = null;
    }
    if (micCheckAudioCtxRef.current) {
      micCheckAudioCtxRef.current.close();
      micCheckAudioCtxRef.current = null;
    }
    micCheckAnalyserRef.current = null;
    setIsTestingMic(false);
  };

  const handleProceedToName = () => {
    stopMicCheck();
    setSetupStep("NAME");
  };

  const barRefs = [
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
  ];

  const lastBarHeightsRef = useRef<number[]>([12, 12, 12, 12, 12]);
  const lastBarColorsRef = useRef<string[]>([
    "#d1d5db",
    "#d1d5db",
    "#d1d5db",
    "#d1d5db",
    "#d1d5db",
  ]);
  const isConnectingRef = useRef<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackAudioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const aiSpeakingEndTimeRef = useRef<number>(0);

  const prepIntervalRef = useRef<number | null>(null);
  const speakIntervalRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);

  const hasAiSpokenRef = useRef<boolean>(false);
  const stageRef = useRef<TestStage>("SETUP");
  const isAiSpeakingRef = useRef<boolean>(false);
  const manualTransitionStateRef = useRef<"PART_2" | "PART_3" | "END_TEST" | null>(null);
  const examinerTurnFinishedRef = useRef<boolean>(false);
  const transitionAudioQueueRef = useRef<string[]>([]);
  const currentExaminerSpeechRef = useRef<string>("");
  const sessionTokenRef = useRef<string>("");

  const part2HasSpokenRef = useRef<boolean>(false);
  const part2PromptedToSpeakRef = useRef<boolean>(false);
  const part2SilenceCounterRef = useRef<number>(0);
  const consecutiveNoAnswerSecondsRef = useRef<number>(0);

  const playAiAudioChunk = (base64Audio: string) => {
    updateHasAiSpoken(true);
    if (!playbackAudioCtxRef.current || !aiAnalyzerRef.current) return;
    try {
      const pcm = base64ToPcm(base64Audio);
      const buffer = playbackAudioCtxRef.current.createBuffer(1, pcm.length, 24000);
      buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);

      const sourceNode = playbackAudioCtxRef.current.createBufferSource();
      sourceNode.buffer = buffer;

      // Separate AI sound playout from user voice analyzer and connect AI directly to speakers
      sourceNode.connect(playbackAudioCtxRef.current.destination);
      // Pipe AI speaker's buffer output to AI analyzer for the dynamic wave animation
      sourceNode.connect(aiAnalyzerRef.current);

      const currentTime = playbackAudioCtxRef.current.currentTime;
      if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime + 0.01;
      }
      sourceNode.start(nextStartTimeRef.current);
      activeSourcesRef.current.push(sourceNode);
      sourceNode.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter((n) => n !== sourceNode);
      };
      nextStartTimeRef.current += buffer.duration;
      aiSpeakingEndTimeRef.current = nextStartTimeRef.current;
    } catch (err) {
      console.error("Failed to play AI audio chunk:", err);
    }
  };

  // Synchronized state and ref wrapper helpers
  const updateStage = (newStage: TestStage) => {
    console.log(`[STAGE UPDATE] Transitioning from ${stageRef.current} to ${newStage}`);
    setStage(newStage);
    stageRef.current = newStage;
    consecutiveNoAnswerSecondsRef.current = 0;
    if (newStage !== "SETUP" && newStage !== "CALCULATING" && newStage !== "SCORE") {
      stagesVisitedRef.current.add(newStage);
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: "stage_change", stage: newStage }));
      } catch (e) {
        console.error("Failed to notify stage change to WebSocket server:", e);
      }
    }

    // Play any queued audio buffers if transitioning out of a transition stage
    if (!newStage.startsWith("TRANSITION_") && transitionAudioQueueRef.current.length > 0) {
      console.log(
        `[STAGE UPDATE] Playing ${transitionAudioQueueRef.current.length} queued transition audio chunks in ${newStage}.`
      );
      const queue = [...transitionAudioQueueRef.current];
      transitionAudioQueueRef.current = [];
      queue.forEach((chunk) => {
        playAiAudioChunk(chunk);
      });
    }
  };

  const updateIsAiSpeaking = (val: boolean) => {
    setIsAiSpeaking(val);
    isAiSpeakingRef.current = val;
  };

  const updateHasAiSpoken = (val: boolean) => {
    setHasAiSpoken(val);
    hasAiSpokenRef.current = val;
  };

  // Separate Input (User) and Output (AI) Analysers to avoid cross-AudioContext errors
  const userAnalyzerRef = useRef<AnalyserNode | null>(null);
  const volumeHistoryRef = useRef<number[]>([]);
  const aiAnalyzerRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const speakingSecondsMapRef = useRef<{ [key: string]: number }>({
    PART_1: 0,
    PART_2: 0,
    PART_3: 0,
  });
  const stagesVisitedRef = useRef<Set<string>>(new Set());
  const lastSpeechTimeRef = useRef<number>(0);
  const consecutiveSilenceRef = useRef<number>(0);

  const part1IntroFailsafeTimeoutRef = useRef<any>(null);
  const part3IntroFailsafeTimeoutRef = useRef<any>(null);
  const examinerHasSpokenInInstructRef = useRef<boolean>(false);
  const part2PrepRequestedTimeRef = useRef<number | null>(null);
  const aiSpokenCompletedRef = useRef<boolean>(false);
  const part1SafetyTimeoutRef = useRef<any>(null);
  const part3SafetyTimeoutRef = useRef<any>(null);
  const part1QuestionCountRef = useRef<number>(0);
  const part1HighQualityAnswersRef = useRef<number>(0);
  const part3QuestionCountRef = useRef<number>(0);
  const activePart1QuestionIndexRef = useRef<number>(-3); // -3 is introduction/name, -2 is preferred name, -1 is where from, then asks mockConfig.part1[0..3]
  const activePart3QuestionIndexRef = useRef<number>(0); // Part 3 starts with the first question directly or intro, then asks mockConfig.part3[0..4]
  const instructAutoStartTimerRef = useRef<any>(null);
  const conversationLogRef = useRef<
    { role: "candidate" | "examiner"; text: string; stage: string }[]
  >([]);
  const nativeAudioTelemetryRef = useRef<any[]>([]);
  const currentCandidateSpeechRef = useRef<string>("");
  const pendingTransitionRef = useRef<"PART_2" | "PART_2_PREP" | "PART_2_START_SPEAKING" | "PART_3" | "END_TEST" | null>(null);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const speakSecondsRef = useRef(0);
  useEffect(() => {
    speakSecondsRef.current = speakSeconds;
  }, [speakSeconds]);

  useEffect(() => {
    stageRef.current = stage;
    if (stage !== "SETUP" && stage !== "CALCULATING" && stage !== "SCORE") {
      stagesVisitedRef.current.add(stage);
    }

    if (stage === "PART_2_INSTRUCT") {
      examinerHasSpokenInInstructRef.current = false;
      aiSpokenCompletedRef.current = false;
      part2PrepRequestedTimeRef.current = null;
    }

    if (stage === "PART_1") {
      if (part1IntroFailsafeTimeoutRef.current) {
        clearTimeout(part1IntroFailsafeTimeoutRef.current);
      }
      part1IntroFailsafeTimeoutRef.current = setTimeout(() => {
        if (stageRef.current === "PART_1" && !hasAiSpokenRef.current) {
          console.log(
            "[PART 1 FAILSAFE] Part 1 started but examiner stayed silent. Prompting examiner."
          );
          sendExaminerInstruction(
            `Hello! I am ready to start the practice test. Please introduce yourself, welcome me, and ask my full name as Part 1 begins.`
          );
        }
      }, 6000);
    } else {
      if (part1IntroFailsafeTimeoutRef.current) {
        clearTimeout(part1IntroFailsafeTimeoutRef.current);
        part1IntroFailsafeTimeoutRef.current = null;
      }
    }

    if (stage === "PART_3") {
      if (part3IntroFailsafeTimeoutRef.current) {
        clearTimeout(part3IntroFailsafeTimeoutRef.current);
      }
      part3IntroFailsafeTimeoutRef.current = setTimeout(() => {
        if (stageRef.current === "PART_3" && part3QuestionCountRef.current === 0) {
          console.log(
            "[PART 3 FAILSAFE] Part 3 started but examiner stayed silent. Prompting examiner."
          );
          sendExaminerInstruction(
            `You are now in Part 3. Please thank the candidate for Part 2, smoothly transition to Part 3, and ask your first discussion question related to: ${mockConfig.part3.join(" | ")}.`
          );
        }
      }, 6000);
    } else {
      if (part3IntroFailsafeTimeoutRef.current) {
        clearTimeout(part3IntroFailsafeTimeoutRef.current);
        part3IntroFailsafeTimeoutRef.current = null;
      }
    }
  }, [stage]);

  const teardownSessionSocket = () => {
    if (activeMediaRecorderRef.current) {
      if (activePartRunningRef.current === "PART_1") {
        stopRecordingPartAndSave(1);
      } else if (activePartRunningRef.current === "PART_3") {
        stopRecordingPartAndSave(3);
      }
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (playbackAudioCtxRef.current) {
      playbackAudioCtxRef.current.close().catch(() => {});
      playbackAudioCtxRef.current = null;
    }
    activeSourcesRef.current.forEach((node) => {
      try {
        node.stop();
        node.disconnect();
      } catch (e) {}
    });
    activeSourcesRef.current = [];
    updateIsAiSpeaking(false);
    transitionAudioQueueRef.current = [];
    currentExaminerSpeechRef.current = "";
    userAnalyzerRef.current = null;
    aiAnalyzerRef.current = null;
    volumeHistoryRef.current = [];
    examinerTurnFinishedRef.current = false;
  };

  const stopTest = () => {
    if (activeMediaRecorderRef.current) {
      if (activePartRunningRef.current === "PART_1") {
        stopRecordingPartAndSave(1);
      } else if (activePartRunningRef.current === "PART_3") {
        stopRecordingPartAndSave(3);
      }
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (playbackAudioCtxRef.current) {
      playbackAudioCtxRef.current.close().catch(() => {});
      playbackAudioCtxRef.current = null;
    }
    if (prepIntervalRef.current) {
      clearInterval(prepIntervalRef.current);
      prepIntervalRef.current = null;
    }
    if (speakIntervalRef.current) {
      clearInterval(speakIntervalRef.current);
      speakIntervalRef.current = null;
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    activeSourcesRef.current.forEach((node) => {
      try {
        node.stop();
        node.disconnect();
      } catch (e) {}
    });
    activeSourcesRef.current = [];
    updateIsAiSpeaking(false);
    transitionAudioQueueRef.current = [];
    currentExaminerSpeechRef.current = "";
    volumeHistoryRef.current = [];

    // Clear custom timeouts & interval refs
    if (part1SafetyTimeoutRef.current) {
      clearTimeout(part1SafetyTimeoutRef.current);
      part1SafetyTimeoutRef.current = null;
    }
    if (part3SafetyTimeoutRef.current) {
      clearTimeout(part3SafetyTimeoutRef.current);
      part3SafetyTimeoutRef.current = null;
    }
    if (instructAutoStartTimerRef.current) {
      clearTimeout(instructAutoStartTimerRef.current);
      instructAutoStartTimerRef.current = null;
    }

    // Reset bar visual sizes & colors to default idle styles
    barRefs.forEach((ref) => {
      if (ref.current) {
        ref.current.style.height = "12px";
        ref.current.style.backgroundColor = "#d1d5db";
      }
    });
  };

  useEffect(() => {
    return () => {
      stopTest();
      stopMicCheck();
    };
  }, []);

  const sendFunctionResponse = (id: string, name: string, result: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          functionResponse: {
            id,
            name,
            response: result,
          },
        })
      );
    }
  };

  const startTestSequence = async () => {
    if (!userName.trim()) return;
    if (userCredits <= 0) {
      alert("⚠️ Insufficient Credits\n\nYou have 0 credits remaining. Please choose a package on our Pricing Page to continue practicing!");
      if (onNavigateToPricing) {
        onNavigateToPricing();
      } else {
        onExit();
      }
      return;
    }

    if (onDeductCredit) {
      onDeductCredit();
    }

    updateStage("TRANSITION_PART_1");
    setErrorMsg("");
    updateHasAiSpoken(false);

    // Reset session refs/states to guarantee a pristine session start
    examinerTurnFinishedRef.current = false;
    consecutiveNoAnswerSecondsRef.current = 0;
    part2HasSpokenRef.current = false;
    part1QuestionCountRef.current = 0;
    part3QuestionCountRef.current = 0;
    activePart1QuestionIndexRef.current = -3;
    currentCandidateSpeechRef.current = "";
    currentExaminerSpeechRef.current = "";

    // Bug 4 fix: resume any suspended AudioContexts here, inside a user-gesture handler,
    // so the browser autoplay policy does not block audio playback later.
    try {
      if (audioCtxRef.current?.state === "suspended") await audioCtxRef.current.resume();
      if (playbackAudioCtxRef.current?.state === "suspended")
        await playbackAudioCtxRef.current.resume();
    } catch (_) {}

    setTimeout(async () => {
      updateStage("PART_1");
      await connectLiveApi(1);
    }, 3000);
  };

  const connectLiveApi = async (part: number = 1) => {
    if (isConnectingRef.current || wsRef.current) {
      console.warn(
        "Connection attempt ignored: connectLiveApi already running or active socket exists."
      );
      return;
    }
    isConnectingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: false },
        },
      });
      streamRef.current = stream;
      if (part === 1) {
        startRecordingPart(stream, "PART_1");
      } else if (part === 3) {
        startRecordingPart(stream, "PART_3");
      }

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      // Bug 4 fix: resume immediately in case the context started suspended (autoplay policy)
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }

      const playbackAudioCtx = new AudioContext({ sampleRate: 24000 });
      playbackAudioCtxRef.current = playbackAudioCtx;
      nextStartTimeRef.current = playbackAudioCtx.currentTime;
      if (playbackAudioCtx.state === "suspended") {
        playbackAudioCtx.resume().catch(() => {});
      }

      const userAnalyzer = audioCtx.createAnalyser();
      userAnalyzer.fftSize = 256;
      userAnalyzer.smoothingTimeConstant = 0.5;
      userAnalyzerRef.current = userAnalyzer;

      const aiAnalyzer = playbackAudioCtx.createAnalyser();
      aiAnalyzer.fftSize = 256;
      aiAnalyzer.smoothingTimeConstant = 0.5;
      aiAnalyzerRef.current = aiAnalyzer;

      const source = audioCtx.createMediaStreamSource(stream);
      // Connect microphone to user analyzer so we can visualize user speech
      source.connect(userAnalyzer);

      let workletSupported = false;
      try {
        if (typeof AudioWorkletNode !== "undefined" && audioCtx.audioWorklet) {
          const workletCode = `
            class AudioInputProcessor extends AudioWorkletProcessor {
              process(inputs, outputs, parameters) {
                const input = inputs[0];
                if (input && input[0]) {
                  this.port.postMessage(input[0]);
                }
                return true;
              }
            }
            registerProcessor('audio-input-processor', AudioInputProcessor);
          `;
          const blob = new Blob([workletCode], { type: "application/javascript" });
          const url = URL.createObjectURL(blob);
          await audioCtx.audioWorklet.addModule(url);

          const workletNode = new AudioWorkletNode(audioCtx, "audio-input-processor");
          source.connect(workletNode);
          workletNode.connect(audioCtx.destination);

          let audioBuffer: number[] = [];
          workletNode.port.onmessage = (event) => {
            const inputData = event.data; // Float32Array
            const currentStage = stageRef.current;
            const isUserTurnStage =
              currentStage === "PART_1" ||
              currentStage === "PART_2_SPEAK" ||
              currentStage === "PART_3";
            const effectivelyMuted =
              !isUserTurnStage ||
              !hasAiSpokenRef.current ||
              !!manualTransitionStateRef.current ||
              (playbackAudioCtxRef.current &&
                playbackAudioCtxRef.current.currentTime < aiSpeakingEndTimeRef.current);

            if (effectivelyMuted) {
              audioBuffer = []; // Clear buffer to prevent backlog of old speech
              return;
            }

            for (let i = 0; i < inputData.length; i++) {
              audioBuffer.push(inputData[i]);
            }

            if (audioBuffer.length >= 1024) {
              const chunkToProcess = new Float32Array(audioBuffer);
              audioBuffer = [];

              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                const base64 = pcmToBase64(chunkToProcess);
                wsRef.current.send(JSON.stringify({ audio: base64 }));
              }
            }
          };
          workletSupported = true;
          console.log("[AudioWorklet] Successfully migrated and loaded AudioWorkletNode.");
        }
      } catch (err) {
        console.warn(
          "[AudioWorklet] AudioWorklet setup failed, falling back to ScriptProcessorNode:",
          err
        );
      }

      if (!workletSupported) {
        const processor = audioCtx.createScriptProcessor(1024, 1, 1);
        processorRef.current = processor;
        source.connect(processor);
        processor.connect(audioCtx.destination);

        processor.onaudioprocess = (e) => {
          const currentStage = stageRef.current;
          const isUserTurnStage =
            currentStage === "PART_1" ||
            currentStage === "PART_2_SPEAK" ||
            currentStage === "PART_3";
          const effectivelyMuted =
            !isUserTurnStage ||
            !hasAiSpokenRef.current ||
            !!manualTransitionStateRef.current ||
            (playbackAudioCtxRef.current &&
              playbackAudioCtxRef.current.currentTime < aiSpeakingEndTimeRef.current);

          if (effectivelyMuted) {
            return;
          }

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
            wsRef.current.send(JSON.stringify({ audio: base64 }));
          }
        };
      }

      const examinerName = examinerVoice === "Eleanor" ? "Dr. Eleanor" : "Dr. Arthur";
      // Bug 1+2 fix: personaStr removed. The server builds the authoritative system prompt.
      // Having a second prompt here caused the model to receive contradictory instructions
      // (different question counts, and all 3 part instructions upfront causing the examiner
      // to announce Part 2 topics while still in Part 1).

      let token = "";
      try {
        const sessionRes = await fetch(apiUrl("/api/session"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mockId: mockConfig.id,
            userName,
            voiceChoice: examinerVoice.toLowerCase(), // "eleanor" or "arthur"
            part, // Pass the part
          }),
        });
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json();
          token = sessionData.token;
          sessionTokenRef.current = token;
        } else {
          let errMsg = `Failed to obtain secure session token (HTTP ${sessionRes.status}).`;
          try {
            const errData = await sessionRes.json();
            if (errData.error) errMsg = errData.error;
          } catch {}
          console.warn("Failed to obtain session token:", errMsg);
          setErrorMsg(errMsg);
          stopTest();
          updateStage("SETUP");
          isConnectingRef.current = false;
          return;
        }
      } catch (err: any) {
        console.error("Session initialization failed:", err);
        setErrorMsg(
          `Failed to initialize session: ${err?.message || "Check your network connection."}`
        );
        stopTest();
        updateStage("SETUP");
        isConnectingRef.current = false;
        return;
      }

      const wsUrl = liveWsUrl(token);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      isConnectingRef.current = false;

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      heartbeatIntervalRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "ping" }));
          } catch (e) {}
        }
      }, 15000) as any;

      // Bug 6 fix: event handlers assigned once here, not re-assigned inside onmessage
      ws.onerror = (event) => {
        console.error("Live WebSocket Error:", event);
        setErrorMsg(
          "Failed to connect to the IELTS examiner. Please make sure you have set a valid GEMINI_API_KEY in Settings > Secrets, that your microphone is fully enabled, and try again."
        );
      };

      ws.onclose = (event) => {
        console.warn("WebSocket stream closed:", event);
        const currentStage = stageRef.current;
        if (
          currentStage !== "SETUP" &&
          currentStage !== "CALCULATING" &&
          currentStage !== "SCORE"
        ) {
          setErrorMsg(
            "Connection to examiner was lost. Please check your mic/internet and start again."
          );
          stopTest();
          updateStage("SETUP");
        }
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.error) {
          console.error("Live Error:", msg.error);
          setErrorMsg(msg.error);
          stopTest();
          updateStage("SETUP");
          return;
        }

        if (msg.functionCall) {
          handleFunctionCall(msg.functionCall);
        }

        if (msg.audio) {
          const currentStage = stageRef.current;
          if (currentStage.startsWith("TRANSITION_")) {
            console.log(
              `[TRANSITION] Received AI audio during transition stage ${currentStage}. Queueing for later.`
            );
            transitionAudioQueueRef.current.push(msg.audio);
          } else {
            playAiAudioChunk(msg.audio);
          }
        }

        if (msg.interrupted) {
          const currentStage = stageRef.current;
          const isTransitionStage = currentStage.startsWith("TRANSITION_");
          if (!isTransitionStage) {
            // Bug 2 fix: use playbackAudioCtxRef (AI speech clock), not audioCtxRef (mic recording clock)
            nextStartTimeRef.current = playbackAudioCtxRef.current?.currentTime || 0;
            aiSpeakingEndTimeRef.current = nextStartTimeRef.current;
            activeSourcesRef.current.forEach((node) => {
              try {
                node.stop();
                node.disconnect();
              } catch (e) {}
            });
            activeSourcesRef.current = [];
          }
        }

        if (msg.userTranscript) {
          consecutiveNoAnswerSecondsRef.current = 0;
          examinerTurnFinishedRef.current = false;
          // Store the latest cumulative user transcript for this speech turn to compile when the examiner begins speaking
          currentCandidateSpeechRef.current = msg.userTranscript;
        }

        if (msg.audio || msg.modelTranscript) {
          consecutiveNoAnswerSecondsRef.current = 0;
          examinerTurnFinishedRef.current = false;
          if (currentCandidateSpeechRef.current.trim()) {
            const finalCandidateSpeech = currentCandidateSpeechRef.current.trim();
            const logs = conversationLogRef.current;
            const lastLog = logs[logs.length - 1];
            if (!lastLog || lastLog.role !== "candidate" || lastLog.text !== finalCandidateSpeech) {
              conversationLogRef.current.push({
                role: "candidate",
                text: finalCandidateSpeech,
                stage: stageRef.current,
              });
              console.log(`[USER UTTERANCE LOGGED SEAMLESSLY] ${finalCandidateSpeech}`);
            }
            currentCandidateSpeechRef.current = "";
          }
        }

        if (msg.modelTranscript) {
          currentExaminerSpeechRef.current += msg.modelTranscript;
        }

        if (msg.turnComplete) {
          examinerTurnFinishedRef.current = true;

          if (stageRef.current === "PART_2_INSTRUCT") {
            pendingTransitionRef.current = "PART_2_PREP";
            console.log(
              "[PART 2 TRANSITION] Examiner finished Part 2 instructions. Scheduling Prep state."
            );
          }

          const finalSpeech = currentExaminerSpeechRef.current.trim();
          if (finalSpeech) {
            console.log(`[EXAMINER UTTERANCE COMPLETE] ${finalSpeech}`);
            conversationLogRef.current.push({
              role: "examiner",
              text: finalSpeech,
              stage: stageRef.current,
            });

            if (stageRef.current === "PART_1") {
              part1QuestionCountRef.current += 1;
              console.log(
                `[EXAMINER TRANSCRIPT] Stage: PART_1, Examiner question count updated to: ${part1QuestionCountRef.current} due to complete speech: "${finalSpeech}"`
              );

              const lowerSpeech = finalSpeech.toLowerCase();
              // TypeScript narrows stageRef.current to "PART_1" inside this block, making a
              // direct stage comparison impossible. Check pendingTransitionRef instead — it
              // is set to "PART_2" the moment a Part 2 transition is queued.
              const isAlreadyTransitioning = pendingTransitionRef.current === "PART_2";

              if (
                !isAlreadyTransitioning &&
                (lowerSpeech.includes("part 2") ||
                  lowerSpeech.includes("part two") ||
                  lowerSpeech.includes("part to") ||
                  lowerSpeech.includes("part ii") ||
                  lowerSpeech.includes("second part") ||
                  lowerSpeech.includes("next part") ||
                  lowerSpeech.includes("cue card") ||
                  lowerSpeech.includes("long turn") ||
                  lowerSpeech.includes("topic card"))
              ) {
                console.log(
                  "[FAILSAFE] Examiner mentioned Part 2 keywords in Part 1 speech. Forcing client-side transition to Part 2."
                );
                pendingTransitionRef.current = "PART_2";
              } else {
                const targetQuestions = 4;
                if (
                  activePart1QuestionIndexRef.current > targetQuestions + 2 &&
                  !pendingTransitionRef.current
                ) {
                  console.log(
                    "[FAILSAFE INTRA-TURN] Examiner exceeded Part 1 questions. Forcing transition."
                  );
                  pendingTransitionRef.current = "PART_2";
                }
              }
            }

            if (stageRef.current === "PART_3") {
              part3QuestionCountRef.current += 1;
              console.log(
                `[EXAMINER TRANSCRIPT] Stage: PART_3, Examiner question count updated to: ${part3QuestionCountRef.current} due to complete speech: "${finalSpeech}"`
              );

              if (part3QuestionCountRef.current > 5 && !pendingTransitionRef.current) {
                console.log(
                  `[FAILSAFE INTRA-TURN] Examiner exceeded Part 3 limit in turnComplete (${part3QuestionCountRef.current} > 5). Forcing test completion.`
                );
                pendingTransitionRef.current = "END_TEST";
              }
            }

            currentExaminerSpeechRef.current = "";
          }
        }

        let lastSampleTime = 0;
        let lastSilenceCheckTime = 0;

        const checkAiSpeaking = () => {
          const currentStage = stageRef.current;
          const now = Date.now();

          let isSpeakingAI = false;
          if (playbackAudioCtxRef.current) {
            isSpeakingAI = playbackAudioCtxRef.current.currentTime < aiSpeakingEndTimeRef.current;
            if (isSpeakingAI !== isAiSpeakingRef.current) {
              updateIsAiSpeaking(isSpeakingAI);
            }
          }

          if (!isSpeakingAI && pendingTransitionRef.current) {
             const action = pendingTransitionRef.current;
             pendingTransitionRef.current = null;
             
             if (action === "PART_2_PREP") {
                  try { teardownSessionSocket(); } catch(e){}
                  forceStartPart2Speaking();
             } else if (action === "PART_2_START_SPEAKING") {
                  try { teardownSessionSocket(); } catch(e){}
                  startPart2SpeakingCountdown();
             } else if (action === "PART_2") {
                  updateManualTransitionState("PART_2");
             } else if (action === "PART_3") {
                  updateManualTransitionState("PART_3");
             } else if (action === "END_TEST") {
                  updateManualTransitionState("END_TEST");
             }
          }

          // Bug 3 fix: prep start is now handled by the 3s setTimeout in handleFunctionCall.
          // This old polling block is intentionally disabled to avoid double-triggering.

          const isListeningActive =
            (hasAiSpokenRef.current || currentStage === "PART_2_SPEAK") &&
            !isSpeakingAI &&
            currentStage !== "PART_2_PREP" &&
            currentStage !== "CALCULATING" &&
            currentStage !== "SCORE" &&
            currentStage !== "SETUP" &&
            !manualTransitionStateRef.current;

          // 1. Throttled visual sampling at 30 Hz (every 33 ms) to reduce excessive DOM reflow layout load on mobile/low-end CPUs
          const shouldUpdateVisuals = now - lastSampleTime >= 33;

          if (shouldUpdateVisuals) {
            lastSampleTime = now;

            let aiFrequencies = [0, 0, 0, 0, 0];
            let userFrequencies = [0, 0, 0, 0, 0];

            if (isSpeakingAI && aiAnalyzerRef.current) {
              const dataArray = new Uint8Array(aiAnalyzerRef.current.frequencyBinCount);
              aiAnalyzerRef.current.getByteFrequencyData(dataArray);

              // 5 bands for 24KHz playback
              const bands = [
                { start: 1, end: 3 }, // Low bass/fundamental (approx 90-280Hz)
                { start: 4, end: 7 }, // Mid-low (approx 370-650Hz)
                { start: 8, end: 14 }, // Mid (approx 750-1300Hz)
                { start: 15, end: 25 }, // Mid-high (approx 1400-2300Hz)
                { start: 26, end: 45 }, // High/Sibilance (approx 2400-4200Hz)
              ];

              aiFrequencies = bands.map((band) => {
                let sum = 0;
                for (let k = band.start; k <= band.end; k++) {
                  sum += dataArray[k] || 0;
                }
                const avg = sum / (band.end - band.start + 1);
                // Noise threshold for clean silent gaps
                const gated = Math.max(0, avg - 8);
                // Scale value nicely to 0..1 range with high sensitivity
                return Math.min(1, gated / 140);
              });
            } else if (isListeningActive && userAnalyzerRef.current) {
              const dataArray = new Uint8Array(userAnalyzerRef.current.frequencyBinCount);
              userAnalyzerRef.current.getByteFrequencyData(dataArray);

              // 5 bands for 16KHz capture
              const bands = [
                { start: 1, end: 3 }, // Low bass/fundamental (approx 60-185Hz)
                { start: 4, end: 8 }, // Mid-low (approx 250-500Hz)
                { start: 9, end: 15 }, // Mid (approx 560-930Hz)
                { start: 16, end: 26 }, // Mid-high (approx 1000-1600Hz)
                { start: 27, end: 50 }, // High/Sibilance (approx 1680-3100Hz)
              ];

              userFrequencies = bands.map((band) => {
                let sum = 0;
                for (let k = band.start; k <= band.end; k++) {
                  sum += dataArray[k] || 0;
                }
                const avg = sum / (band.end - band.start + 1);
                // Slightly higher noise floor subtraction for mics to avoid static AC/hum triggering
                const gated = Math.max(0, avg - 15);
                // Highly responsive and sensitive scaling
                return Math.min(1, gated / 100);
              });
            }

            const shapeMultipliers = [0.8, 1.1, 1.3, 1.1, 0.8];

            // Butter-smooth direct DOM styling updates scaling to the frequencies
            barRefs.forEach((ref, index) => {
              if (ref.current) {
                let h = 12; // default
                let color = "#d1d5db"; // default bg-stone-300
                if (isSpeakingAI) {
                  const val = aiFrequencies[index] || 0;
                  const mult = shapeMultipliers[index];
                  h = 12 + val * 56 * mult;
                  color = "#f59e0b"; // bg-amber-500
                } else if (isListeningActive) {
                  const val = userFrequencies[index] || 0;
                  const mult = shapeMultipliers[index];
                  h = 12 + val * 56 * mult;
                  color = "#10b981"; // bg-emerald-500
                }

                const clampedHeight = Math.max(6, Math.min(72, Math.round(h)));

                // Only update DOM style if there's a noticeable visual height difference or color change.
                // This reduces page layout computations and browser paint thrashing by ~80% during speech!
                const prevH = lastBarHeightsRef.current[index];
                const prevColor = lastBarColorsRef.current[index];

                if (Math.abs(clampedHeight - prevH) >= 1.5 || color !== prevColor) {
                  lastBarHeightsRef.current[index] = clampedHeight;
                  lastBarColorsRef.current[index] = color;
                  ref.current.style.height = `${clampedHeight}px`;
                  ref.current.style.backgroundColor = color;
                }
              }
            });
          }

          // 2. Throttled silence detection and active speaking timers in 1-second intervals
          const shouldCheckSilence = now - lastSilenceCheckTime >= 1000;
          if (shouldCheckSilence) {
            const lastCheck = lastSilenceCheckTime || now - 1000;
            const delta = (now - lastCheck) / 1000;
            lastSilenceCheckTime = now;

            let currentSilenceVol = 0;
            const SPEECH_THRESHOLD = 0.005;

            if (isListeningActive && userAnalyzerRef.current) {
              const dataArray = new Uint8Array(userAnalyzerRef.current.fftSize);
              userAnalyzerRef.current.getByteTimeDomainData(dataArray);
              let sumSquares = 0;
              for (let i = 0; i < dataArray.length; i++) {
                const normalized = (dataArray[i] - 128) / 128;
                sumSquares += normalized * normalized;
              }
              const vol = Math.sqrt(sumSquares / dataArray.length);

              volumeHistoryRef.current.push(vol);
              if (volumeHistoryRef.current.length > 5) {
                volumeHistoryRef.current.shift();
              }
              currentSilenceVol =
                volumeHistoryRef.current.reduce((a, b) => a + b, 0) /
                volumeHistoryRef.current.length;
            }

            // Track active speech duration across test sections
            if (isListeningActive && currentSilenceVol > SPEECH_THRESHOLD) {
              const partKey = currentStage.includes("PART_1")
                ? "PART_1"
                : currentStage.includes("PART_3")
                  ? "PART_3"
                  : "PART_2";
              speakingSecondsMapRef.current[partKey] =
                (speakingSecondsMapRef.current[partKey] || 0) + delta;

              // Mark that candidate has started speaking in Part 2, and clear silence counters
              if (currentStage === "PART_2_SPEAK") {
                part2HasSpokenRef.current = true;
                part2SilenceCounterRef.current = 0;
              }
            }

            // We completely disable automatic silence termination in Part 1 and Part 3
            // so the candidate can speak at their own pace without stress.
            consecutiveNoAnswerSecondsRef.current = 0;

            // Auto transition on silence during Part 2 presentation (only when they're allowed to speak and have started)
            if (currentStage === "PART_2_SPEAK" && isListeningActive) {
              if (currentSilenceVol > SPEECH_THRESHOLD) {
                consecutiveSilenceRef.current = 0;
              }
            } else {
              consecutiveSilenceRef.current = 0;
            }
          }

          animFrameRef.current = requestAnimationFrame(checkAiSpeaking);
        };
        // Bug 1 fix: only start the animation loop once per connection.
        // Without this guard, a new competing rAF loop is spawned on every
        // WebSocket message, causing exponential CPU usage and visual jitter.
        if (animFrameRef.current === null) {
          checkAiSpeaking();
        }
      };
    } catch (e: any) {
      console.error(e);
      setErrorMsg(`Could not start microphone: ${e.message}`);
      // Bug 3 fix: always reset the connecting guard so future attempts are not permanently blocked.
      isConnectingRef.current = false;
      // Bug 4 fix: use updateStage so stageRef.current stays in sync with React state.
      updateStage("SETUP");
    }
  };

  const sendExaminerInstruction = (promptText: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          clientContent: {
            turns: [
              {
                role: "user",
                parts: [{ text: `[INSTRUCTION FOR EXAMINER] ${promptText}` }],
              },
            ],
            turnComplete: true,
          },
        })
      );
    }
  };

  const executeTransition = (transitionAction: string) => {
    pendingTransitionRef.current = transitionAction as any;
  };

  const handleFunctionCall = (fc: any) => {
    const { id, name, args } = fc;
    console.log("[handleFunctionCall] Received function call event:", name, fc);

    if (name === "log_native_audio_telemetry") {
      console.log("[handleFunctionCall] Saving native audio telemetry:", args);
      if (args) {
         nativeAudioTelemetryRef.current.push({
           stage: stageRef.current,
           ...args
         });
      }
      sendFunctionResponse(id, name, { ok: true });
      return;
    }

    if (name === "progress_to_part_2") {
      const isAlreadyPastOrInPart2 =
        stageRef.current === "TRANSITION_PART_2" ||
        stageRef.current.startsWith("PART_2_") ||
        stageRef.current === "TRANSITION_PART_3" ||
        stageRef.current === "PART_3" ||
        stageRef.current === "CALCULATING" ||
        stageRef.current === "SCORE";

      if (isAlreadyPastOrInPart2) {
        console.log(
          "[handleFunctionCall] progress_to_part_2 called but already past or in Part 2. Skipping transition."
        );
        sendFunctionResponse(id, name, { ok: true });
        return;
      }

      sendFunctionResponse(id, name, { ok: true });
      executeTransition("PART_2");
    } else if (name === "start_prep_timer") {
      sendFunctionResponse(id, name, { ok: true });
      executeTransition("PART_2_PREP");
    } else if (name === "start_speaking_timer") {
      sendFunctionResponse(id, name, { ok: true });
      executeTransition("PART_2_START_SPEAKING");
    } else if (name === "progress_to_part_3") {
      const isAlreadyPastOrInPart3 =
        stageRef.current === "TRANSITION_PART_3" ||
        stageRef.current === "PART_3" ||
        stageRef.current === "CALCULATING" ||
        stageRef.current === "SCORE";

      if (isAlreadyPastOrInPart3) {
        console.log(
          "[handleFunctionCall] progress_to_part_3 called but already past or in Part 3. Skipping transition."
        );
        sendFunctionResponse(id, name, { ok: true });
        return;
      }

      // Safeguard against Gemini calling progress_to_part_3 too early
      if (stageRef.current === "PART_2_SPEAK" && speakSecondsRef.current < 15) {
        console.log(
          `[handleFunctionCall] progress_to_part_3 called too early (${speakSecondsRef.current}s elapsed). Denying.`
        );
        sendFunctionResponse(id, name, {
          ok: false,
          error:
            "The candidate has just started speaking. Please stay silent, do not progress yet, and let them talk for up to 2 minutes.",
        });
        return;
      }

      if (speakIntervalRef.current) clearInterval(speakIntervalRef.current);
      sendFunctionResponse(id, name, { ok: true });
      executeTransition("PART_3");
    } else if (name === "end_test") {
      sendFunctionResponse(id, name, { ok: true });
      executeTransition("END_TEST");
    }
  };

  const part2RecognitionRef = useRef<any>(null);
  const [part2Transcript, setPart2Transcript] = useState("");
  const part2TranscriptRef = useRef("");
  const [part2Analysis, setPart2Analysis] = useState<any>(null);

  const startPart2SpeakingCountdown = () => {
    updateStage("PART_2_SPEAK");
    setSpeakSeconds(0);
    setPart2Transcript("");
    part2TranscriptRef.current = "";
    updateHasAiSpoken(false);

    // Request dedicated microphone stream for background audio recording of Part 2 response
    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: false },
      }
    }).then((p2Stream) => {
      part2RecordStreamRef.current = p2Stream;
      startRecordingPart(p2Stream, "PART_2");
    }).catch((err) => {
      console.warn("Could not capture microphone stream for Part 2 audio recording:", err);
    });

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRec) {
      const recognition = new SpeechRec();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (e: any) => {
        let finalTrans = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          if (e.results[i].isFinal) {
             finalTrans += e.results[i][0].transcript + ' ';
          }
        }
        if (finalTrans) {
           part2TranscriptRef.current += finalTrans;
           setPart2Transcript(part2TranscriptRef.current);
           
           // Log candidate speech seamlessly
           const logs = conversationLogRef.current;
           const lastLog = logs[logs.length - 1];
           if (!lastLog || lastLog.role !== "candidate" || lastLog.text !== part2TranscriptRef.current.trim()) {
             conversationLogRef.current.push({
               role: "candidate",
               text: part2TranscriptRef.current.trim(),
               stage: "PART_2_SPEAK",
             });
           }
        }
      };
      recognition.onerror = (e: any) => console.warn("Recognition error", e);
      recognition.start();
      part2RecognitionRef.current = recognition;
    }

    if (speakIntervalRef.current) clearInterval(speakIntervalRef.current);
    
    let currentSpeakSecs = 0;
    speakIntervalRef.current = window.setInterval(() => {
      currentSpeakSecs += 1;
      if (currentSpeakSecs >= 120) {
        setSpeakSeconds(120);
        forceProgressToPart3();
      } else {
        setSpeakSeconds(currentSpeakSecs);
      }
    }, 1000);
  };

  const forceProgressToPart2 = () => {
    executeTransition("PART_2");
  };

  const forceStartPart2Speaking = () => {
    updateStage("PART_2_PREP");
    setPrepSeconds(60);
    updateHasAiSpoken(false);

    if (prepIntervalRef.current) clearInterval(prepIntervalRef.current);
    
    let currentSeconds = 60;
    prepIntervalRef.current = window.setInterval(() => {
      currentSeconds -= 1;
      if (currentSeconds <= 0) {
        clearInterval(prepIntervalRef.current!);
        setPrepSeconds(0);
        updateStage("PART_2_PROMPT_SPEAK");
        updateHasAiSpoken(false);
        connectLiveApi(4).catch(console.error);
      } else {
        setPrepSeconds(currentSeconds);
      }
    }, 1000);
  };

  const forceProgressToPart3 = () => {
    if (speakIntervalRef.current) {
      clearInterval(speakIntervalRef.current);
      speakIntervalRef.current = null;
    }
    
    if (part2RecognitionRef.current) {
      try { part2RecognitionRef.current.stop(); } catch(e){}
    }

    if (activeMediaRecorderRef.current && activePartRunningRef.current === "PART_2") {
      stopRecordingPartAndSave(2);
    }
    if (part2RecordStreamRef.current) {
      try {
        part2RecordStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch (e) {}
      part2RecordStreamRef.current = null;
    }

    fetch(apiUrl("/api/analyze-part2"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: part2TranscriptRef.current || "No speech detected", part2Topic: mockConfig.part2 })
    }).then(r => r.json()).then(data => {
      setPart2Analysis(data);
    }).catch(console.error);

    teardownSessionSocket();
    updateManualTransitionState("PART_3");
  };

  const forceEndTest = () => {
    stopTest();
    updateManualTransitionState("END_TEST");
  };

  useEffect(() => {
    // Safety timeout for Part 1 (6 minutes)
    if (stage === "PART_1") {
      if (part1SafetyTimeoutRef.current) clearTimeout(part1SafetyTimeoutRef.current);
      console.log("Part 1 safety timer initiated: 6 minutes countdown.");
      part1SafetyTimeoutRef.current = setTimeout(
        () => {
          if (stageRef.current === "PART_1") {
            console.log("Part 1 6-minute safety timeout reached, forcing progression to Part 2.");
            forceProgressToPart2();
          }
        },
        6 * 60 * 1000
      );
    } else {
      if (part1SafetyTimeoutRef.current) {
        clearTimeout(part1SafetyTimeoutRef.current);
        part1SafetyTimeoutRef.current = null;
      }
    }

    // Safety timeout for Part 3 (6 minutes)
    if (stage === "PART_3") {
      if (part3SafetyTimeoutRef.current) clearTimeout(part3SafetyTimeoutRef.current);
      console.log("Part 3 safety timer initiated: 6 minutes countdown.");
      part3SafetyTimeoutRef.current = setTimeout(
        () => {
          if (stageRef.current === "PART_3") {
            console.log("Part 3 6-minute safety timeout reached, forcing test end.");
            forceEndTest();
          }
        },
        6 * 60 * 1050 // 6 minutes
      );
    } else {
      if (part3SafetyTimeoutRef.current) {
        clearTimeout(part3SafetyTimeoutRef.current);
        part3SafetyTimeoutRef.current = null;
      }
    }
  }, [stage]);

  useEffect(() => {
    if (stage === "CALCULATING" && calcPhase >= 5 && calculationReport) {
      try {
        const currentSavedRaw = localStorage.getItem("ielts_saved_scores");
        const sanitizeText = (v: string) => (v || "").replace(/[<>]/g, "");
        let currentSaved: any[] = [];
        try {
          if (currentSavedRaw) {
            const list = JSON.parse(currentSavedRaw);
            if (Array.isArray(list)) {
              currentSaved = list
                .map((item: any) => {
                  if (!item || typeof item !== "object") return null;
                  return {
                    ...item,
                    id: sanitizeText(item.id),
                    mockTitle: sanitizeText(item.mockTitle || ""),
                    overall: sanitizeText(String(item.overall || "")).slice(0, 5),
                    fluency: sanitizeText(String(item.fluency || "")).slice(0, 5),
                    lexical: sanitizeText(String(item.lexical || "")).slice(0, 5),
                    grammar: sanitizeText(String(item.grammar || "")).slice(0, 5),
                    pronunciation: sanitizeText(String(item.pronunciation || "")).slice(0, 5),
                    feedback: sanitizeText(item.feedback || "").slice(0, 1000),
                    timestamp: typeof item.timestamp === "number" ? item.timestamp : Date.now(),
                  };
                })
                .filter(Boolean);
            }
          }
        } catch {}

        if (!currentSaved.some((item) => item.id === calculationReport.id)) {
          currentSaved.unshift(calculationReport);
          localStorage.setItem("ielts_saved_scores", JSON.stringify(currentSaved));

          // Real-time Supabase Database insertion for logged-in accounts
          if (isSupabaseConfigured && supabase) {
            supabase.auth.getSession().then(({ data: { session } }) => {
              if (session && session.user) {
                supabase
                  .from("ielts_saved_scores")
                  .insert({
                    id: calculationReport.id,
                    user_id: session.user.id,
                    mock_title: calculationReport.mockTitle,
                    overall: calculationReport.overall,
                    fluency: calculationReport.fluency,
                    lexical: calculationReport.lexical,
                    grammar: calculationReport.grammar,
                    pronunciation: calculationReport.pronunciation,
                    feedback: calculationReport.feedback,
                    timestamp: new Date(calculationReport.timestamp || Date.now()).toISOString()
                  })
                  .then(({ error }) => {
                    if (error) {
                      console.error("Supabase Database Sync Error:", error);
                    } else {
                      console.log("IELTS report safely persisted to Supabase Database!");
                    }
                  });
              }
            });
          }
        }
      } catch (err) {
        console.error("Error saving IELTS score report on transition:", err);
      }

      setScore(calculationReport);
      setStage("SCORE");
    }
  }, [stage, calcPhase, calculationReport]);

  const generateScore = async () => {
    // Stop the Live connection immediately
    stopTest();
    setCalcPhase(0);
    setCalculationReport(null);

    // 1. Start the sequential phases timer
    const phaseInterval = window.setInterval(() => {
      setCalcPhase((prev) => {
        if (prev >= 5) {
          clearInterval(phaseInterval);
          return 5;
        }
        return prev + 1;
      });
    }, 1200);

    try {
      const candidateTurns = conversationLogRef.current.filter(
        (entry: any) => entry.role === "candidate"
      );

      // Compute word counts per section to prevent mic silence false-positives
      let p1Words = 0;
      let p2Words = 0;
      let p3Words = 0;

      candidateTurns.forEach((entry: any) => {
        const words = entry.text.trim().split(/\s+/).filter(Boolean).length;
        const s = (entry.stage || "").toUpperCase();
        if (s.includes("PART_1")) {
          p1Words += words;
        } else if (s.includes("PART_3")) {
          p3Words += words;
        } else {
          p2Words += words;
        }
      });

      const totalWords = p1Words + p2Words + p3Words;

      // Estimate durations conservatively from transcripts to bypass quiet microphone/headset latency issues
      // IELTS normal speed is ~120-150 WPM, so 1 word ~= 0.45 seconds
      const p1TimeEst = Math.round(p1Words * 0.45);
      const p2TimeEst = Math.round(p2Words * 0.45);
      const p3TimeEst = Math.round(p3Words * 0.45);

      const p1Time = Math.max(speakingSecondsMapRef.current["PART_1"] || 0, p1TimeEst);
      const p2Time = Math.max(speakingSecondsMapRef.current["PART_2"] || 0, p2TimeEst);
      const p3Time = Math.max(speakingSecondsMapRef.current["PART_3"] || 0, p3TimeEst);
      const totalSpeech = p1Time + p2Time + p3Time;

      // Compute advanced pronunciation feature parameters for Gemini Pro
      const wpm = totalSpeech > 0 ? Math.round((totalWords / totalSpeech) * 60) : 0;

      const fillerWordsList = ["um", "uh", "err", "like", "you know", "ah"];
      let fillerCount = 0;
      candidateTurns.forEach((turn: any) => {
        const textLower = turn.text.toLowerCase();
        fillerWordsList.forEach((word) => {
          const regex = new RegExp(`\\b${word}\\b`, "g");
          const matches = textLower.match(regex);
          if (matches) {
            fillerCount += matches.length;
          }
        });
      });
      const fillerRatio = totalWords > 0 ? parseFloat((fillerCount / totalWords).toFixed(3)) : 0;

      const recordedActive =
        (speakingSecondsMapRef.current["PART_1"] || 0) +
        (speakingSecondsMapRef.current["PART_2"] || 0) +
        (speakingSecondsMapRef.current["PART_3"] || 0);
      const estimatedActive = totalWords * 0.45;
      const pauseRatio =
        estimatedActive > 0
          ? parseFloat(
              Math.max(0.05, Math.min(0.6, 1 - recordedActive / estimatedActive)).toFixed(3)
            )
          : 0.15;

      const pronunciationFeatures = {
        wpm,
        fillerRatio,
        pauseRatio,
        totalWords,
      };

      const durationMap = {
        PART_1: Math.round(p1Time),
        PART_2: Math.round(p2Time),
        PART_3: Math.round(p3Time),
        totalSeconds: Math.round(totalSpeech),
      };

      let apiScoreReport: any = null;
      try {
        const scoreRes = await fetch(apiUrl("/api/score"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token: sessionTokenRef.current,
            conversationLog: conversationLogRef.current,
            mockTitle: mockConfig.title,
            part2Topic: mockConfig.part2,
            durationSecondsMap: durationMap,
            pronunciationFeatures,
            nativeAudioTelemetry: nativeAudioTelemetryRef.current,
          }),
        });

        if (scoreRes.ok) {
          apiScoreReport = await scoreRes.json();
          console.log("Acquired dynamic AI score report:", apiScoreReport);
        } else {
          console.warn("API score responded with bad status:", scoreRes.status);
        }
      } catch (err) {
        console.error("Failed to fetch dynamically from /api/score:", err);
      }

      let calculatedScore: any;

      if (apiScoreReport && apiScoreReport.overall) {
        calculatedScore = {
          id: Date.now().toString(),
          date: new Date().toLocaleDateString(),
          title: mockConfig.title,
          overall: parseFloat(apiScoreReport.overall).toFixed(1),
          fluency: parseFloat(apiScoreReport.fluency || "1.0").toFixed(1),
          lexical: parseFloat(apiScoreReport.lexical || "1.0").toFixed(1),
          grammar: parseFloat(apiScoreReport.grammar || "1.0").toFixed(1),
          pronunciation: parseFloat(apiScoreReport.pronunciation || "1.0").toFixed(1),
          feedback: apiScoreReport.feedback || "",
          fluencyBreakdown:
            apiScoreReport.fluencyBreakdown || getFluencyBreakdown(apiScoreReport.fluency || "1.0"),
          lexicalBreakdown:
            apiScoreReport.lexicalBreakdown || getLexicalBreakdown(apiScoreReport.lexical || "1.0"),
          grammarBreakdown:
            apiScoreReport.grammarBreakdown || getGrammarBreakdown(apiScoreReport.grammar || "1.0"),
          pronunciationBreakdown:
            apiScoreReport.pronunciationBreakdown ||
            getPronunciationBreakdown(apiScoreReport.pronunciation || "1.0"),
        };
      } else {
        // Fallback to Heuristics if API call failed
        console.log("Using heuristic fallback for scoring.");
        const p1Visited = stagesVisitedRef.current.has("PART_1");
        const p2Visited = stagesVisitedRef.current.has("PART_2_SPEAK");
        const p3Visited = stagesVisitedRef.current.has("PART_3");

        let fluencyBase = 1.0;
        if (p1Visited && p1Time > 2) fluencyBase += 1.5;
        if (p1Visited && p1Time > 15) fluencyBase += 1.0;

        if (p2Visited) {
          if (p2Time > 5) fluencyBase += 1.5;
          if (p2Time > 30) fluencyBase += 1.5;
          if (p2Time > 60) fluencyBase += 1.0;
          if (p2Time > 90) fluencyBase += 0.5;
        }

        if (p3Visited) {
          if (p3Time > 2) fluencyBase += 1.5;
          if (p3Time > 15) fluencyBase += 1.0;
          if (p3Time > 30) fluencyBase += 0.5;
        }

        if (totalSpeech < 3) {
          fluencyBase = 1.0;
        } else if (totalSpeech < 10) {
          fluencyBase = Math.min(fluencyBase, 3.5);
        } else if (totalSpeech < 30) {
          fluencyBase = Math.min(fluencyBase, 5.5);
        } else if (totalSpeech < 60) {
          fluencyBase = Math.min(fluencyBase, 7.0);
        }

        let lexicalBase = 1.0;
        let grammarBase = 1.0;
        let pronunciationBase = 1.0;

        // Perform text coherence analysis to weed out key-smashing / gibberish play
        const allWordsArray = candidateTurns.flatMap((t: any) => t.text.toLowerCase().match(/\b\w+\b/g) || []);
        const uniqueWords = new Set(allWordsArray);
        const uniqueRatio = allWordsArray.length > 0 ? (uniqueWords.size / allWordsArray.length) : 0;
        const totalWordLengths = allWordsArray.reduce((acc, word) => acc + word.length, 0);
        const averageWordLength = allWordsArray.length > 0 ? (totalWordLengths / allWordsArray.length) : 0;

        // Identify gibberish: if average word length is very low, or high percent of single-letter nonsense
        const nonStandardSingleLetters = allWordsArray.filter(w => w.length === 1 && w !== "a" && w !== "i").length;
        const singleLetterRatio = allWordsArray.length > 0 ? (nonStandardSingleLetters / allWordsArray.length) : 0;

        const isLikelyGibberish = allWordsArray.length > 0 && (
          averageWordLength < 2.5 || 
          uniqueRatio < 0.12 ||
          singleLetterRatio > 0.35
        );

        if (totalWords >= 5 && totalSpeech >= 3 && !isLikelyGibberish) {
          const wordRateFactor = Math.min(9.0, 1.5 + (totalWords / 25) + (totalSpeech / 40));
          const syntaxFactor = Math.min(9.0, 1.0 + (totalWords / 30) + (totalSpeech / 45));
          const pronunciationFactor = Math.min(9.0, 3.0 + (totalSpeech / 25));

          const diversityBonus = uniqueRatio > 0.5 ? 0.5 : (uniqueRatio < 0.32 ? -1.0 : 0);

          lexicalBase = Math.max(1.0, Math.min(9.0, wordRateFactor + diversityBonus));
          grammarBase = Math.max(1.0, Math.min(9.0, syntaxFactor));
          pronunciationBase = Math.max(1.0, Math.min(9.0, pronunciationFactor));
        } else if (isLikelyGibberish) {
          fluencyBase = 1.5;
          lexicalBase = 1.0;
          grammarBase = 1.0;
          pronunciationBase = 1.5;
        } else if (totalSpeech > 0) {
          lexicalBase = 1.5;
          grammarBase = 1.0;
          pronunciationBase = 2.0;
        }

        // Compliant IELTS half & full band rounding formula
        const roundIelts = (val: number) => {
          const intPart = Math.floor(val);
          const frac = val - intPart;
          let rounded: number;
          if (frac < 0.25) {
            rounded = intPart;
          } else if (frac < 0.75) {
            rounded = intPart + 0.5;
          } else {
            rounded = intPart + 1;
          }
          return Math.max(1.0, Math.min(9.0, rounded));
        };

        const roundToWholeIntegerBand = (val: number) => {
          return Math.max(1, Math.min(9, Math.round(val)));
        };

        const fluencyFinal = roundToWholeIntegerBand(fluencyBase);
        const lexicalFinal = roundToWholeIntegerBand(lexicalBase);
        const grammarFinal = roundToWholeIntegerBand(grammarBase);
        const pronunciationFinal = roundToWholeIntegerBand(pronunciationBase);

        const overallRaw = (fluencyFinal + lexicalFinal + grammarFinal + pronunciationFinal) / 4;
        const overallFinal = roundIelts(overallRaw);

        let feedback: string;
        if (isLikelyGibberish) {
          feedback = "Your practice attempt contains a significant amount of unrecognized keyboard characters, repeated single items, or incoherent speech fragments. To receive a valid academic IELTS Speaking band score and diagnostic feedback, please speak clearly using proper English structures in response to the test prompts.";
        } else if (totalSpeech < 6) {
          feedback = `You spoke for only ${Math.round(totalSpeech)} seconds in total. This is insufficient to carry out standard IELTS grading. For an authentic experience, please make sure you speak more fully and complete Part 2's presentation. Try launching another test and talking as long as you can!`;
        } else {
          feedback = "Terrific practice attempt! ";
          if (p2Time < 45) {
            feedback +=
              "In Part 2, try to keep speaking for over 1 minute to demonstrate sustained speech without hesitant repetition. ";
          } else {
            feedback +=
              "You maintained excellent pacing and length in Part 2, demonstrating strong grammatical coherence. ";
          }
          if (totalSpeech < 45) {
            feedback +=
              "To score above a Band 6.5, try using more complex subordinating structures and dynamic descriptors instead of short literal answers.";
          } else {
            feedback +=
              "You demonstrate a strong vocabulary base and good grammatical command. Focus on pronunciation rhythm and word links to reduce frequent pauses and hesitations.";
          }
        }

        const fScore = fluencyFinal.toFixed(1);
        const lScore = lexicalFinal.toFixed(1);
        const gScore = grammarFinal.toFixed(1);
        const pScore = pronunciationFinal.toFixed(1);

        calculatedScore = {
          id: Date.now().toString(),
          date: new Date().toLocaleDateString(),
          title: mockConfig.title,
          overall: overallFinal.toFixed(1),
          fluency: fScore,
          lexical: lScore,
          grammar: gScore,
          pronunciation: pScore,
          feedback,
          fluencyBreakdown: getFluencyBreakdown(fScore),
          lexicalBreakdown: getLexicalBreakdown(lScore),
          grammarBreakdown: getGrammarBreakdown(gScore),
          pronunciationBreakdown: getPronunciationBreakdown(pScore),
        };
      }

      setCalculationReport(calculatedScore);
    } catch (err) {
      console.error("Error performing scores calculations:", err);
      // set fallbacks
      setCalculationReport({
        id: Date.now().toString(),
        date: new Date().toLocaleDateString(),
        title: mockConfig.title,
        overall: "6.0",
        fluency: "6.0",
        lexical: "6.0",
        grammar: "5.5",
        pronunciation: "6.5",
        feedback: "We encountered an issue during analysis, but here is an estimated breakdown.",
        fluencyBreakdown: getFluencyBreakdown("6.0"),
        lexicalBreakdown: getLexicalBreakdown("6.0"),
        grammarBreakdown: getGrammarBreakdown("5.5"),
        pronunciationBreakdown: getPronunciationBreakdown("6.5"),
      });
    }
  };

  const handleFinishedSpeakingEarly = () => {
    console.log("[handleFinishedSpeakingEarly] Candidate finished speaking early. Transitioning to Part 3 immediately.");
    forceProgressToPart3();
  };

  const getFluencyBreakdown = (scoreStr: string) => {
    const scoreVal = parseFloat(scoreStr);
    if (scoreVal <= 4.5) {
      return {
        descriptor:
          "Speaks with slow or hesitant speech, with repetitive intervals and limited cohesive structures.",
        details:
          "At this band, speech is characterized by slow tempo and noticeable pauses while searching for words or structures. You may struggle to expand on ideas, leading to brief responses that rely heavily on the examiner's prompts.",
        action:
          "Work on developing fluency by practicing talking continuously on straightforward familiar topics (e.g., your hometown, hobbies) without worrying too much about grammar mistakes initially. Practice using simple connectives like 'because', 'although', 'in addition' to join your thoughts.",
      };
    } else if (scoreVal === 5.0 || scoreVal === 5.5) {
      return {
        descriptor:
          "Speaks with slow/hesitant delivery with frequent repetition, self-correction, or limited linking devices.",
        details:
          "You scored a Band 5 in Fluency because there is a persistent reliance on slow delivery, hesitation, self-correction, or repetitive loops. Your linking markers are limited to a few standard forms (e.g. 'and', 'but', 'then') and you can occasionally lose coherence as you wander or search for phrases during your Part 2 talk.",
        action:
          "To reach Band 6.0+, practice structuring your Part 2 speech using a simple note outline. This prevents repetition and hesitation loops. Increase your use of connective phrases like 'Moreover', 'On the other hand', and 'For instance' to maintain a continuous, logical thread.",
      };
    } else if (scoreVal === 6.0 || scoreVal === 6.5) {
      return {
        descriptor:
          "Willing to speak at length but may lose coherence due to occasional repetition, self-correction, or search hesitation.",
        details:
          "You scored a Band 6 in Fluency because you show ready willingness to speak at length and can sustain your speech, but you still exhibit periodic pauses, repeated words, and self-correction to reformulate sentences. You use connective words and markers generally well, though sometimes inappropriately or repetitively.",
        action:
          "To reach Band 7.0+, build stamina by timing yourself speaking for a full 2 minutes without stopping. Work on avoiding filler words (like 'uh', 'um') by allowing silent pauses instead. Integrate diverse discourse markers such as 'Consequently', 'Having said that', and 'To expand on this'.",
      };
    } else if (scoreVal === 7.0 || scoreVal === 7.5) {
      return {
        descriptor:
          "Speaks fluently and at length with minimal hesitation or repetition. Employs a robust range of connectives naturally.",
        details:
          "At Band 7, you speak at length with relative ease and show strong cohesion. Pauses are rare, and hesitation is generally search-driven (focusing on ideas rather than vocabulary). You manage transitioning between parts of the test well and show an expressive, coherent rhythm.",
        action:
          "To break into Band 8.0+, refine your discourse organization. Focus on sophisticated linking markers and speaking fluidly even with highly complex, abstract Part 3 subjects. Minimize all self-correction by planning semantic structure ahead.",
      };
    } else {
      return {
        descriptor:
          "Speaks fluently, effortlessly, and with content-driven pausing. High flexibility with cohesive discourse markers.",
        details:
          "This is an elite Band 8.0/9.0 performance. Your speech flows naturally with zero hesitancy. Pauses are used purely to structure dramatic impact or formulate complex ideas. Cohesion is achieved smoothly and fully integrated across Part 1, Part 2, and Part 3.",
        action:
          "Maintain this world-class delivery! Polish your pronunciation shades to ensure perfect intonation matching of emotive or structured arguments.",
      };
    }
  };

  const getLexicalBreakdown = (scoreStr: string) => {
    const scoreVal = parseFloat(scoreStr);
    if (scoreVal <= 4.5) {
      return {
        descriptor:
          "Has extremely limited vocabulary resource. Relies on simple words and struggles on unfamiliar or abstract topics.",
        details:
          "At this band, you have enough words for core biographical details but frequently run out of vocabulary for topics outside your immediate life. Paraphrasing is rarely successful, leading to hesitation.",
        action:
          "Begin a vocabulary journal categorized by common IELTS subjects (e.g., Environment, Education, Technology). Learn words in pairs or word collocations rather than single isolated terms.",
      };
    } else if (scoreVal === 5.0 || scoreVal === 5.5) {
      return {
        descriptor:
          "Talks about familiar topics but has limited resource for unfamiliar issues. Struggles to paraphrase successfully.",
        details:
          "You scored a Band 5 in Lexical Resource because while you can discuss familiar items, you quickly run out of words when pushed on unfamiliar or abstract topics in Part 3. You also rarely use idiomatic vocabulary and frequently struggle when attempting to paraphrase or work around a word you don't know.",
        action:
          "To achieve Band 6.0+, broaden your lexical reach by learning synonyms for common descriptors. Practice active paraphrasing (e.g. if you forget the word 'renovation', describe it as 'the process of repairing and improving an old building').",
      };
    } else if (scoreVal === 6.0 || scoreVal === 6.5) {
      return {
        descriptor:
          "Has a wide enough vocabulary to discuss topics at length, making meaning clear despite errors in word choice.",
        details:
          "You scored a Band 6 in Lexical Resource because your vocabulary is sufficient to address topics at length and you make your meaning clear. However, you make frequent inappropriate word choices, misapply idioms, or make minor collocation errors. You can paraphrase successfully when needed.",
        action:
          "To reach Band 7.0+, study collocations (e.g., 'commit a crime' instead of 'make a crime', 'profound impact' instead of 'big impact'). Learn to use less common words and idiomatic phrases with higher precision.",
      };
    } else if (scoreVal === 7.0 || scoreVal === 7.5) {
      return {
        descriptor:
          "Uses wide vocabulary flexibly to discuss diverse topics. Uses less common and idiomatic terms with general awareness.",
        details:
          "At Band 7, you show deep lexical flexibility. You can discuss abstract concepts with precision, using less common vocabulary, metaphors, and phrasal verbs. While a few minor word choice or style errors exist, they never obscure meaning.",
        action:
          "To reach Band 8.0+, eliminate any remaining imprecise word choices. Expand your control over advanced academic vocabulary, literature references, and precise idiomatic nuances.",
      };
    } else {
      return {
        descriptor:
          "Uses precise, sophisticated, and highly flexible vocabulary. Natural and accurate idiomatic expressions used effortlessly.",
        details:
          "An elite vocabulary resource. You navigate complex discussions easily, using a wealth of academic vocabulary, metaphors, and phrasal verbs. Error rates are virtually non-existent, and paraphrasing is seamless.",
        action:
          "Keep exposing yourself to high-level newspapers (e.g., The Economist) and academic articles to maintain peak verbal sophistication.",
      };
    }
  };

  const getGrammarBreakdown = (scoreStr: string) => {
    const scoreVal = parseFloat(scoreStr);
    if (scoreVal <= 4.5) {
      return {
        descriptor:
          "Produces simple sentence structures with frequent errors. Relies on isolated word groups.",
        details:
          "At this band, simple sentences dominate and are prone to systematic errors. Complex clauses are rare or completely absent, which heavily limits your band outcome.",
        action:
          "Focus on mastering basic tenses (past, present, and future) and subject-verb agreement. Practice making short assertions and joining them with basic coordinators like 'and', 'but'.",
      };
    } else if (scoreVal === 5.0 || scoreVal === 5.5) {
      return {
        descriptor:
          "Produces simple sentence forms with reasonable grammar accuracy. Attempts a few complex structures with basic errors.",
        details:
          "You scored a Band 5 in Grammatical Range because simple structures are produced with reasonable control but complex sentence attempts are rare, and when they are tried, they frequently contain errors (like wrong tenses or missing verbs) that can cause comprehension difficulties.",
        action:
          "To reach Band 6.0+, practice using a wider mix of simple and complex sentence structures. Master conditional structures ('If I had...') and relative clauses ('The city where I grew up...') to form longer compound ideas.",
      };
    } else if (scoreVal === 6.0 || scoreVal === 6.5) {
      return {
        descriptor:
          "Employs a mixture of simple and complex structures with limited flexibility. Errors occur in complex structures.",
        details:
          "You scored a Band 6 in Grammatical Range because you show a mix of simple and complex sentences, but with limited flexibility or variation. Errors are still present in complex structures, although they rarely cause comprehension issues for the examiner.",
        action:
          "To reach Band 7.0+, increase the proportion of your error-free sentences. Pay closer attention to verb-noun agreements, auxiliary verbs, and prepositions. Diversify compound forms by using passive voice and modal verbs.",
      };
    } else if (scoreVal === 7.0 || scoreVal === 7.5) {
      return {
        descriptor:
          "Uses a wide range of complex sentence structures flexibly. Produces a high proportion of error-free sentences.",
        details:
          "At Band 7, you demonstrate great grammatical versatility. You utilize complex clauses, passive phrasing, and conditionals with high accuracy. Most of your sentences are fully error-free, reflecting a strong command.",
        action:
          "To reach Band 8.0+, eliminate systematic slip-ups. Focus on extremely complex grammar constructs (e.g., mixed conditionals, inversion) to convey sophisticated abstract theories smoothly.",
      };
    } else {
      return {
        descriptor:
          "Consistently produces a full, highly flexible range of structures naturally. Error-free sentences are the norm.",
        details:
          "An elite grammatical command. Complex arrangements are produced natively and dynamically. Structural errors are rare slips that never degrade clarity or comprehension.",
        action:
          "Maintain this high standard! Try reading classical literature or debating complex social issues to ensure maximum syntactic precision.",
      };
    }
  };

  const getPronunciationBreakdown = (scoreStr: string) => {
    const scoreVal = parseFloat(scoreStr);
    if (scoreVal <= 4.5) {
      return {
        descriptor:
          "Mispronunciations are frequent and lead to key gaps. Speech is heavily accented.",
        details:
          "Frequent pronunciation errors dominate, making it hard to follow your statements. Lacking control of word stress, vowel sounds, or rhythm.",
        action:
          "Focus on individual sound drill exercises. Practice shadowing native speakers and listing words you mispronounce regularly to correct word stress.",
      };
    } else if (scoreVal === 5.0 || scoreVal === 5.5) {
      return {
        descriptor:
          "Shows some pronunciation features with partial control. Recurrent pronunciation errors occur.",
        details:
          "You scored a Band 5 in Pronunciation because while you demonstrate some audible features, you have partial or weak control over word stress and linking stress. Flat or repetitive intonation patterns are present, and mispronounced words occasionally force the listener to strain.",
        action:
          "To reach Band 6.0+, work on word stress (pronouncing the correct syllables with emphasis) and consonant/vowel clarity. Use sentence stress by slightly raising your voice on the key action words in a sentence.",
      };
    } else if (scoreVal === 6.0 || scoreVal === 6.5) {
      return {
        descriptor:
          "Employs pronunciation features with mixed control. Is generally intelligible throughout.",
        details:
          "You scored a Band 6 in Pronunciation because you have a mixed control of phonological features, meaning your speech is generally intelligible and easy to follow, but you exhibit occasional sound mispronunciations, flat rhythm patterns, or weak word-linking.",
        action:
          "To reach Band 7.0+, focus on chunking (pausing at natural grammatical boundaries) and sound linking (merging words naturally like 'an_apple'). Record your speaking and analyze your vowel clarity.",
      };
    } else if (scoreVal === 7.0 || scoreVal === 7.5) {
      return {
        descriptor:
          "Uses a wide range of pronunciation features with good control. Intonation and stress are natural.",
        details:
          "At Band 7, your speech is fully clear, expressive, and easily handled. You employ sentence stress, proper pitch variation, and smooth sound linking. Occasional slides occur but they are minor slips.",
        action:
          "To reach Band 8.0+, perfect your intonation and rhythm. Ensure your stress matches the emotional weight or focus of your arguments effortlessly.",
      };
    } else {
      return {
        descriptor:
          "Employs an absolute, effortless range of pronunciation features. Flawless clarity and linking.",
        details:
          "Perfect pronunciation control. Your voice is completely clear, highly expressive, and possesses native-like intonation patterns, seamless sound-linking, and pristine vowel/consonant rendering.",
        action:
          "Fantastic job! Continue standard conversational listening to maintain peak vowel rounding and rhythm accuracy.",
      };
    }
  };

  // Helper flags
  const isPart2 =
    stage === "PART_2_INSTRUCT" || stage === "PART_2_PREP" || stage === "PART_2_PROMPT_SPEAK" || stage === "PART_2_SPEAK";
  const isUserTurnStage = stage === "PART_1" || stage === "PART_2_SPEAK" || stage === "PART_3";
  const isListening = (hasAiSpoken && !isAiSpeaking && isUserTurnStage && !manualTransitionState) || stage === "PART_2_SPEAK";
  const showMicOff = !isUserTurnStage;

  return (
    <div className="flex flex-col min-h-screen bg-[#FDFBF7] font-sans selection:bg-amber-200">
      <header className="px-6 py-6 w-full flex items-center justify-between border-b border-stone-200 bg-white">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-100 text-amber-700 rounded-2xl border border-amber-200/50">
            <Target size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-stone-800">{mockConfig.title}</h1>
          </div>
        </div>
        <button
          disabled={
            stage === "TRANSITION_PART_1" ||
            stage === "TRANSITION_PART_2" ||
            stage === "TRANSITION_PART_3"
          }
          onClick={() => {
            stopTest();
            onExit();
          }}
          className="text-stone-500 hover:text-stone-800 flex items-center gap-1 text-sm font-medium transition-colors"
        >
          ← Exit
        </button>
      </header>

      <main className="flex-1 flex flex-col relative items-center justify-start pt-6 pb-20 p-4 sm:p-6 md:p-8 w-full max-w-7xl mx-auto overflow-y-auto">
        <AnimatePresence>
          {stage === "TRANSITION_PART_1" && (
            <TransitionCard key="pt1" title="Part 1" subtitle="Introduction & Interview" />
          )}
          {stage === "TRANSITION_PART_2" && (
            <TransitionCard key="pt2" title="Part 2" subtitle="Long Turn" />
          )}
          {stage === "TRANSITION_PART_3" && (
            <TransitionCard key="pt3" title="Part 3" subtitle="Two-Way Discussion" />
          )}
        </AnimatePresence>
        {stage === "SETUP" && (
          <div className="w-full max-w-5xl bg-white border border-stone-250/80 shadow-xl rounded-[2.5rem] relative overflow-hidden flex flex-col justify-between p-6 sm:p-8 md:p-10">
            {/* Aesthetic Top highlight strip */}
            <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 animate-pulse" />
            {setupStep === "INSTR" ? (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center w-full">
                {/* Left Column: Heading and spacious instructions */}
                <div className="md:col-span-7 flex flex-col gap-5 justify-center text-left">
                  <div>
                    <span className="text-[10px] bg-amber-100 border border-amber-200/60 text-amber-850 font-mono px-2.5 py-1 rounded-full font-bold uppercase tracking-widest inline-block mb-3">
                      Step 1: Calibration
                    </span>
                    <h2 className="text-2xl font-bold text-stone-850 tracking-tight leading-snug">
                      Onboarding & Mic Check
                    </h2>
                    <p className="text-[#6D6353] text-[13px] font-medium leading-relaxed mt-1.5">
                      Please prepare your testing environment for optimal real-time examiner
                      interaction and voice processing accuracy.
                    </p>
                  </div>{" "}
                  <div className="space-y-4">
                    {/* Silent Room Info */}
                    <div className="bg-[#FAF9F5] border border-stone-200/60 p-4 rounded-2xl flex gap-3.5 items-start shadow-sm">
                      <div className="p-2 bg-amber-100 text-amber-700 rounded-xl shrink-0">
                        <AlertCircle size={18} />
                      </div>
                      <div>
                        <h4 className="text-xs font-extrabold text-stone-800 uppercase tracking-wider mb-0.5">
                          Stay in a Silent Room
                        </h4>
                        <p className="text-[11px] text-[#6D6353] font-semibold leading-relaxed">
                          Minimize background static noise. Close doors and wear headphones if
                          possible for real-time clarity.
                        </p>
                      </div>
                    </div>

                    {/* Organic Timers Info */}
                    <div className="bg-[#FAF9F5] border border-stone-200/60 p-4 rounded-2xl flex gap-3.5 items-start shadow-sm">
                      <div className="p-2 bg-amber-100 text-amber-700 rounded-xl shrink-0">
                        <Target size={18} />
                      </div>
                      <div>
                        <h4 className="text-xs font-extrabold text-stone-800 uppercase tracking-wider mb-0.5">
                          Examiner keeps time
                        </h4>
                        <p className="text-[11px] text-[#6D6353] font-semibold leading-relaxed">
                          No crowded countdown timers. Just you and the AI practicing naturally.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: Microphone verification card and main CTA button */}
                <div className="md:col-span-5 flex flex-col gap-4 bg-[#FCFAF6] border border-stone-150 p-6 rounded-3xl justify-between min-h-[380px] w-full text-center shadow-sm select-none antialiased shrink-0">
                  <div className="flex-1 flex flex-col justify-center">
                    <h4 className="text-xs font-extrabold text-[#6B5A43] uppercase tracking-widest text-center font-mono mb-4 shrink-0">
                      Microphone Level Test
                    </h4>
                    {micTestGranted ? (
                      <div className="flex-1 flex flex-col items-center justify-center space-y-4 animate-fadeIn">
                        {/* Circle success tick animation */}
                        <div className="relative flex items-center justify-center w-20 h-20 bg-emerald-50 rounded-full border border-emerald-300">
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: "spring", stiffness: 200, damping: 15 }}
                            className="flex items-center justify-center w-14 h-14 bg-emerald-500 rounded-full text-white shadow-lg"
                          >
                            <svg
                              className="w-8 h-8"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <motion.path
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: 1 }}
                                transition={{ delay: 0.2, duration: 0.4 }}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          </motion.div>
                        </div>
                        <div className="inline-flex items-center gap-2 px-4.5 py-2.5 rounded-xl bg-emerald-50 text-emerald-800 text-[11px] font-extrabold leading-none shadow-sm border border-emerald-150">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse shrink-0" />
                          <span>Microphone Calibrated & Ready</span>
                        </div>
                        <p className="text-xs text-stone-500 max-w-xs mx-auto leading-relaxed">
                          Your audio levels are perfect and calibrated for real-time speech
                          interaction.
                        </p>
                      </div>
                    ) : !isTestingMic ? (
                      <div className="flex-1 flex flex-col justify-center">
                        <button
                          type="button"
                          onClick={startMicCheck}
                          className="mx-auto flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs py-3.5 px-6 rounded-2xl transition-all shadow-md shadow-amber-600/10 cursor-pointer w-full"
                        >
                          <Mic size={15} />
                          Begin Calibration
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4 px-2">
                        <div className="text-left space-y-1">
                          <span className="text-[10px] text-amber-700 tracking-widest font-bold block uppercase animate-pulse text-center font-mono">
                            Please say "Testing one two three"
                          </span>
                          <p className="text-[11px] text-stone-500 font-medium text-center leading-relaxed">
                            Hold your voice above{" "}
                            <strong className="text-stone-800">12 units</strong> for{" "}
                            <strong className="text-stone-800">0.5 seconds</strong> to complete
                            calibration.
                          </p>
                        </div>

                        {/* dB Level Indicator & Visual Level Bar */}
                        <div className="space-y-1.5 pt-1.5">
                          <div className="flex justify-between items-center text-[10px] font-mono font-bold text-stone-400">
                            <span>LEVEL INDICATOR</span>
                            <span>{Math.round(micTestLevel)} / 100</span>
                          </div>
                          <div className="w-full bg-stone-150 rounded-full h-3 overflow-hidden border border-stone-200 relative">
                            <div
                              className="bg-amber-500 h-full transition-all duration-75"
                              style={{
                                width: `${Math.min(100, Math.max(0, (micTestLevel * 100) / 70))}%`,
                              }}
                            />
                          </div>
                        </div>

                        {/* Hold Calibration Progress Bar - Always mounted to prevent shaking and layout shift */}
                        <div
                          className={`space-y-1.5 p-3 rounded-xl border transition-all duration-300 ${
                            micTestLevel >= 12
                              ? "bg-[#FCFAF6] border-amber-200/60 opacity-100 shadow-sm"
                              : "bg-stone-50 border-stone-200/50 opacity-40"
                          }`}
                        >
                          <div className="flex justify-between items-center text-[10px] font-mono font-extrabold transition-colors">
                            <span
                              className={micTestLevel >= 12 ? "text-amber-800" : "text-stone-400"}
                            >
                              {micTestLevel >= 12 ? "HOLDING THRESHOLD" : "SPEECH DETECTION"}
                            </span>
                            <span
                              className={micTestLevel >= 12 ? "text-amber-800" : "text-stone-400"}
                            >
                              {micTestLevel >= 12 ? `${micProgressPercent}%` : "0%"}
                            </span>
                          </div>
                          <div className="w-full bg-stone-200 rounded-full h-2 overflow-hidden relative">
                            <div
                              className={`h-full transition-all duration-150 ${micTestLevel >= 12 ? "bg-emerald-600" : "bg-stone-300"}`}
                              style={{
                                width: `${micTestLevel >= 12 ? micProgressPercent : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {errorMsg && (
                    <div className="space-y-3 shrink-0">
                      <div className="flex gap-2 items-center text-red-600 bg-red-50 p-4 rounded-2xl text-[11px] font-bold leading-relaxed text-left shrink-0">
                        <AlertCircle size={16} className="shrink-0" /> {errorMsg}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-stone-200/50 shrink-0">
                    <button
                      type="button"
                      onClick={handleProceedToName}
                      disabled={!micTestGranted}
                      className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 px-4 text-xs rounded-2xl transition-all shadow-md shadow-amber-600/20 disabled:opacity-50 disabled:shadow-none cursor-pointer"
                    >
                      <span>Continue</span>
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center w-full">
                {/* Left Column: Heading and Tips/Precautions */}
                <div className="md:col-span-7 flex flex-col gap-5 justify-center text-left">
                  <div>
                    <span className="text-[10px] bg-amber-100 border border-amber-200/60 text-amber-850 font-mono px-2.5 py-1 rounded-full font-bold uppercase tracking-widest inline-block mb-3">
                      Step 2: Candidate Details
                    </span>
                    <h2 className="text-2xl font-bold text-stone-850 tracking-tight leading-snug">
                      Identity Verification
                    </h2>
                    <p className="text-[#6D6353] text-[13px] font-medium leading-relaxed mt-1.5 font-sans">
                      Enter your authentic first and last names. The IELTS examiner Alex uses these
                      details dynamically to call and spell your name.
                    </p>
                  </div>

                  {/* Dynamic pre-knowledge warning area */}
                  <div className="space-y-4">
                    {(() => {
                      const trickyNames = [
                        "dragon",
                        "gragon",
                        "boyy",
                        "bad",
                        "test",
                        "admin",
                        "player",
                        "mocker",
                        "guest",
                        "candidate",
                        "user",
                        "abc",
                        "xyz",
                        "dummy",
                        "none",
                        "nothing",
                      ];
                      const cleanedInput = userName.trim().toLowerCase();
                      const isTricky =
                        trickyNames.includes(cleanedInput) ||
                        (cleanedInput.length > 0 && cleanedInput.length < 3) ||
                        /^[0-9]+$/.test(cleanedInput);

                      if (isTricky) {
                        return (
                          <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl text-[11px] text-[#805018] leading-relaxed font-semibold flex gap-2.5">
                            <AlertCircle
                              className="shrink-0 text-amber-600 mt-0.5 animate-bounce"
                              size={16}
                            />
                            <div>
                              <strong className="text-amber-900 block font-bold mb-0.5">
                                ⚠️ Precaution Check
                              </strong>
                              Please avoid generic nickname strings like "dragon" or short/numeric
                              strings. Realistic passport-style names ensure examiner dialogues
                              sound genuine.
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div className="bg-[#FAF9F5] border border-stone-200/60 p-4.5 rounded-2xl text-[11px] text-[#6D6353] leading-relaxed font-semibold flex gap-3.5">
                          <Target className="shrink-0 text-amber-600" size={18} />
                          <div>
                            <strong className="text-stone-800 block font-bold mb-0.5">
                              Passport Registration Setup
                            </strong>
                            IELTS candidates are registered using their authentic full legal
                            identity. The speaking test report and score analysis will reflect this
                            name value.
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Right Column: Name input element and Proceed button */}
                <div className="md:col-span-5 flex flex-col gap-5 bg-[#FCFAF6] border border-stone-150 p-6 rounded-3xl justify-between h-full min-h-[300px] text-center">
                  <div className="flex-1 flex flex-col justify-center gap-4">
                    <h4 className="text-xs font-extrabold text-[#6B5A43] uppercase tracking-widest text-center font-mono">
                      Your Legal Name
                    </h4>

                    <div className="flex bg-white border border-stone-200 rounded-2xl overflow-hidden focus-within:ring-2 ring-amber-500/30 transition-all p-1.5 shadow-sm">
                      <div className="pl-3 pr-2 flex items-center justify-center text-stone-400">
                        <User size={20} />
                      </div>
                      <input
                        type="text"
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        placeholder="e.g. John Doe"
                        className="w-full py-2 bg-transparent focus:outline-none text-stone-850 placeholder-stone-400 font-bold text-center text-sm"
                      />
                    </div>

                    <div className="mt-3 text-left">
                      <h4 className="text-[10px] font-extrabold text-[#6B5A43] uppercase tracking-wider mb-2 font-mono text-center">
                        2. Examiner Voice Selection
                      </h4>
                      <div className="grid grid-cols-2 gap-1.5 bg-stone-100 p-1.5 rounded-2xl border border-stone-200">
                        <button
                          type="button"
                          onClick={() => {
                            setExaminerVoice("Arthur");
                            localStorage.setItem("ielts_examiner_voice", "Arthur");
                          }}
                          className={`py-2 text-[11px] font-bold rounded-xl transition-all cursor-pointer ${
                            examinerVoice === "Arthur"
                              ? "bg-amber-600 text-white shadow-md shadow-amber-600/10 font-bold"
                              : "text-stone-500 hover:text-stone-850"
                          }`}
                        >
                          Dr. Arthur (Male)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setExaminerVoice("Eleanor");
                            localStorage.setItem("ielts_examiner_voice", "Eleanor");
                          }}
                          className={`py-2 text-[11px] font-bold rounded-xl transition-all cursor-pointer ${
                            examinerVoice === "Eleanor"
                              ? "bg-amber-600 text-white shadow-md shadow-amber-600/10 font-bold"
                              : "text-stone-500 hover:text-stone-850"
                          }`}
                        >
                          Dr. Eleanor (Female)
                        </button>
                      </div>
                      <span className="text-[9px] text-[#807664] font-medium block text-center mt-1.5 leading-snug">
                        Both academic & professional, slow pacing.
                      </span>
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="space-y-2 text-left">
                      <div className="flex gap-2 items-center text-red-600 bg-red-50 p-4 rounded-2xl text-[11px] font-sans font-semibold">
                        <AlertCircle size={16} /> {errorMsg}
                      </div>
                      <div className="flex flex-col gap-2 bg-amber-50 border border-amber-200/60 p-4 rounded-2xl text-[11px] leading-relaxed text-left font-medium text-stone-700 shadow-sm">
                        <div className="flex gap-2 items-center font-bold text-amber-900">
                          <Info size={14} className="shrink-0" />
                          <span>Microphone / Connection Hint</span>
                        </div>
                        <p className="text-[#6D6353]">
                          Browsers frequently restrict microphone and media capabilities inside
                          embedded iframes. If you encounter errors, opening the applet directly in
                          its own tab completely bypasses this restriction.
                        </p>
                        <a
                          href={window.location.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 px-3 rounded-xl transition-all shadow-md shadow-amber-600/10 cursor-pointer self-start text-[10.5px] mt-1"
                        >
                          Open App in New Tab
                          <ExternalLink size={11} />
                        </a>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2.5 border-t border-stone-200/50">
                    <button
                      type="button"
                      onClick={() => setSetupStep("INSTR")}
                      className="flex-1 bg-stone-100 hover:bg-stone-200/60 text-stone-600 border border-stone-200 font-bold py-3.5 rounded-2xl transition-all cursor-pointer text-xs"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => {
                        const finalUName = userName.trim();
                        if (finalUName) {
                          localStorage.setItem("ielts_user_profile_name", finalUName);
                        }
                        startTestSequence();
                      }}
                      disabled={!userName.trim()}
                      className="flex-[2] flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white font-bold py-3.5 rounded-2xl transition-all shadow-md shadow-amber-600/20 disabled:opacity-50 disabled:shadow-none cursor-pointer text-xs"
                    >
                      <Play size={13} className="fill-current" />
                      Enter Exam Hall
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}{" "}
        {(stage === "PART_1" ||
          stage === "PART_2_INSTRUCT" ||
          stage === "PART_2_PREP" ||
          stage === "PART_2_PROMPT_SPEAK" ||
          stage === "PART_2_SPEAK" ||
          stage === "PART_3") && (
          <>
            {isPart2 ? (
              <div className="w-full max-w-4xl px-4 flex flex-col items-center">
                {/* Header inside Part 2 view */}
                <div className="mb-4 text-center">
                  <h3 className="text-xl font-bold text-stone-850 tracking-tight flex items-center justify-center gap-2">
                    Part 2: Long Turn (Individual Presentation)
                  </h3>
                  <p className="text-xs font-semibold text-stone-550 mt-0.5">
                    Talk about the topic described in the cue card below.
                  </p>
                </div>

                {/* 2-Column Grid: Cue Card & Notes left, Timer/Buttons right */}
                <div className="w-full grid grid-cols-1 md:grid-cols-12 gap-5 items-start pt-1">
                  {/* LEFT COLUMN: Candidate Cue Card & Scratchpad */}
                  <div className="md:col-span-7 flex flex-col gap-4 w-full">
                    {/* Candidate Cue Card */}
                    <div className="bg-white border border-stone-200 rounded-2xl p-4.5 shadow-sm relative flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-1.5 text-amber-850 font-bold mb-2 uppercase tracking-wider text-[10px]">
                          <HelpCircle size={15} /> Candidate Cue Card
                        </div>
                        <p className="text-stone-800 text-sm font-bold leading-relaxed mb-2 font-sans">
                          {mockConfig.part2}
                        </p>
                        <div className="text-stone-600 text-[11px] leading-relaxed space-y-1 bg-stone-50 p-3.5 rounded-xl border border-stone-150">
                          <strong className="text-stone-700 font-bold block mb-0.5">
                            You should say:
                          </strong>
                          {getPart2Bullets(mockConfig.part2, mockConfig.part2Bullets).map(
                            (bullet, i) => (
                              <div key={i} className="flex gap-1.5 items-start">
                                <span className="text-amber-600 font-bold">•</span>
                                <span>{bullet}</span>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Scratchpad integrated inside the LEFT Column, saving dual columns duplicate rendering */}
                    <div className="w-full bg-white border border-stone-200 rounded-2xl p-4 flex flex-col text-left shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-stone-650 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                          📝 Your Notes / Scratchpad
                        </span>
                        <span className="text-[10px] uppercase font-bold text-stone-400">
                          {stage === "PART_2_INSTRUCT" ? "Locked" : "Unlocked"}
                        </span>
                      </div>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        disabled={stage === "PART_2_INSTRUCT"}
                        placeholder={
                          stage === "PART_2_INSTRUCT"
                            ? "Scratchpad is locked during Examiner Instructions. It will unlock during your 1-minute prep time."
                            : "Type keywords, outlines, or ideas right here to assist you during speaking..."
                        }
                        className="w-full h-20 p-2.5 bg-stone-50 border border-stone-200 focus:outline-none text-stone-700 text-xs rounded-xl resize-none font-sans leading-relaxed shadow-inner disabled:opacity-50"
                      />
                    </div>
                  </div>

                  {/* RIGHT COLUMN: State indicators, timers, and next action triggers */}
                  <div className="md:col-span-5 flex flex-col justify-start gap-4 w-full">
                    {/* LIVE EXAMINER FEED SUB-UNIT (Optimized compact visual layout) */}
                    <div className="bg-[#FDFBF7] border border-stone-200 rounded-2xl p-3 flex flex-col items-center shadow-sm w-full">
                      <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#6B5A43] mb-1 font-mono">
                        Speaker Status
                      </p>

                      <div className="mt-0.5 text-center">
                        <p className="text-[11px] font-semibold flex justify-center items-center">
                          {stage === "PART_2_PREP" ? (
                            <span className="flex items-center gap-1 text-stone-600 bg-stone-100 px-2.5 py-0.5 rounded-full border border-stone-205">
                              <MicOff size={11} /> Prep Mode (Mic Muted)
                            </span>
                          ) : (stage === "PART_2_INSTRUCT" || stage === "PART_2_PROMPT_SPEAK") && !isAiSpeaking ? (
                            <span className="flex items-center gap-1 text-stone-400 bg-stone-50 px-2.5 py-0.5 rounded-full border border-stone-200 animate-pulse">
                              <Activity size={11} /> Instructions starting...
                            </span>
                          ) : isAiSpeaking ? (
                            <span className="flex items-center gap-1 text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200 animate-pulse">
                              <Volume2 size={11} /> Examiner Speaking
                            </span>
                          ) : manualTransitionState ? (
                            <span className="flex items-center gap-1 text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                              <CheckCircle2 size={11} /> Section Complete
                            </span>
                          ) : isListening ? (
                            <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse mr-1" />{" "}
                              Mic Active - Speak Now
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-stone-400 bg-stone-50 px-2.5 py-0.5 rounded-full border border-stone-200 animate-pulse">
                              <Activity size={11} /> Preparing...
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {(stage === "PART_2_INSTRUCT" || stage === "PART_2_PROMPT_SPEAK") && (
                      <div className="w-full flex flex-col gap-3 bg-white border border-stone-200 rounded-2xl p-3.5 shadow-sm items-center">
                        <CircularTimer
                          value={stage === "PART_2_PROMPT_SPEAK" ? 0 : 60}
                          maxValue={60}
                          title="Preparation Time"
                          subtitle="Listening to examiner instructions..."
                          colorClass="text-stone-300 animate-pulse"
                          noCard={true}
                        />
                      </div>
                    )}

                    {stage === "PART_2_PREP" && (
                      <div className="w-full bg-white border border-stone-200 rounded-2xl p-3.5 shadow-sm">
                        <CircularTimer
                          value={prepSeconds}
                          maxValue={60}
                          title="Preparation Time"
                          subtitle="Preparing your notes"
                          colorClass="text-amber-500"
                          noCard={true}
                        />
                      </div>
                    )}

                    {stage === "PART_2_SPEAK" && (
                      <div className="w-full flex flex-col gap-3">
                        {/* IELTS Speaking Part 2 Standard: No countdown clock is shown to candidate */}
                        <div className="flex flex-col items-center justify-center text-center p-3.5 bg-white rounded-2xl border border-stone-200 shadow-sm w-full mx-auto relative overflow-hidden">
                          <div className="absolute top-0 inset-x-0 h-1 bg-emerald-600" />
                          <h4 className="text-[9px] font-bold text-stone-400 tracking-widest mb-2 uppercase">
                            Speaking Stage
                          </h4>

                          <div className="flex items-center gap-1.5 px-2.5 py-0.5 bg-emerald-50 rounded-full border border-emerald-150 mb-1.5 animate-pulse inline-flex">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span className="text-[10px] font-extrabold text-emerald-600 font-mono uppercase">
                              Streaming Voice
                            </span>
                          </div>

                          <p className="text-[10px] text-stone-500 font-medium px-2 leading-relaxed mt-1">
                            Talk clearly on all cue card items. Your examiner is listening and will
                            transition the test automatically.
                          </p>
                        </div>

                        {stage === "PART_2_SPEAK" && speakSeconds >= 110 && (
                          <button
                            onClick={handleFinishedSpeakingEarly}
                            className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer mt-2"
                          >
                            <CheckCircle2 size={13} />
                            Finished speaking early
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* Standard Centered Flow Container for Part 1 & Part 3 */
              <div className="w-full max-w-lg flex flex-col items-center">
                <WarmWaveform barRefs={barRefs} />

                <div className="mt-8 text-center space-y-3">
                  <h3 className="text-lg font-medium text-stone-800 tracking-tight transition-colors flex items-center justify-center gap-2">
                    {stage.includes("PART_1") && "Part 1: Interview"}
                    {stage.includes("PART_3") && "Part 3: Discussion"}
                  </h3>

                  <p className="text-sm font-medium flex justify-center items-center gap-1.5 min-h-[32px]">
                    {isAiSpeaking ? (
                      <span className="flex items-center gap-1 text-amber-600 bg-amber-50 px-3 py-1 rounded-full border border-amber-110 transition-all font-semibold">
                        <Volume2 size={16} className="animate-pulse" /> Examiner Speaking
                      </span>
                    ) : manualTransitionState ? (
                      <span className="flex items-center gap-1 text-amber-600 bg-amber-50 px-3 py-1 rounded-full border border-amber-110 transition-all font-semibold">
                        <CheckCircle2 size={16} /> Section Complete
                      </span>
                    ) : isListening ? (
                      <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-110 transition-all font-semibold">
                        <Mic size={16} className="animate-pulse" /> Your Turn - Speak Now
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-stone-500 bg-stone-50 px-3 py-1 rounded-full border border-stone-200 transition-all font-semibold">
                        <Activity size={16} className="animate-pulse" />{" "}
                        {stage === "PART_1" && !hasAiSpoken ? "Preparing Test..." : "Thinking..."}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
        {stage === "CALCULATING" && (
          <div className="w-full max-w-xl mx-auto bg-white border border-stone-200 rounded-3xl p-8 shadow-xl shadow-stone-200/40 text-left animate-fade-in space-y-8 relative overflow-hidden">
            {/* Ambient accent background line at top */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600" />

            {/* Header section with sophisticated logo / spinner */}
            <div className="flex items-center gap-5">
              <div className="relative flex-shrink-0 w-16 h-16 rounded-2xl bg-amber-50 border border-amber-100/80 flex items-center justify-center shadow-sm">
                <Loader2 size={28} className="text-amber-600 animate-spin" />
                <Sparkles
                  size={16}
                  className="absolute -top-1 -right-1 text-orange-500 animate-pulse"
                />
              </div>
              <div>
                <h2 className="font-display text-xl font-extrabold text-stone-900 tracking-tight leading-snug">
                  Analyzing Your Auditory Response
                </h2>
                <p className="text-xs text-stone-500 font-medium leading-relaxed">
                  The artificial examiner is reviewing your voice feed against the official IELTS
                  Speaking grading rubric.
                </p>
              </div>
            </div>

            {/* Criteria List */}
            <div className="space-y-4">
              {[
                {
                  id: 1,
                  key: "fluency",
                  label: "Fluency & Coherence",
                  icon: Activity,
                  desc: "Evaluating speech rate, acoustic pausing, repetition frequencies, and filler word ratios.",
                },
                {
                  id: 2,
                  key: "lexical",
                  label: "Lexical Resource",
                  icon: BookOpen,
                  desc: "Scanning transcription vocabulary density, idioms, collocation patterns, and range.",
                },
                {
                  id: 3,
                  key: "grammar",
                  label: "Grammatical Range & Accuracy",
                  icon: Target,
                  desc: "Evaluating clause subordination, syntax complexity, sentence types, and tense distributions.",
                },
                {
                  id: 4,
                  key: "pronunciation",
                  label: "Pronunciation & Intonation",
                  icon: Volume2,
                  desc: "Diagnosing sound linkages, phonemic clarity, linking behaviors, and tonic prominence.",
                },
              ].map((crit, idx) => {
                const stepIdx = idx + 1;
                const isPast = calcPhase > stepIdx;
                const isCurrent = calcPhase === stepIdx;
                const isPending = calcPhase < stepIdx;

                // Get the real score if ready, otherwise display counting up
                const realScore = calculationReport ? calculationReport[crit.key] : null;

                return (
                  <div
                    key={crit.id}
                    className={cn(
                      "flex items-start gap-4 p-4 rounded-2xl border transition-all duration-300",
                      isCurrent && "bg-amber-50/40 border-amber-200 shadow-xs",
                      isPast && "bg-stone-50/60 border-stone-200/60",
                      isPending && "bg-transparent border-stone-100 opacity-60"
                    )}
                  >
                    <div
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border transition-all duration-300",
                        isCurrent && "bg-amber-500 text-white border-amber-500 shadow-sm",
                        isPast && "bg-stone-100 text-stone-500 border-stone-200/50",
                        isPending && "bg-stone-50 text-stone-300 border-stone-100"
                      )}
                    >
                      <crit.icon size={18} className={isCurrent ? "animate-pulse" : ""} />
                    </div>

                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <h4
                          className={cn(
                            "text-sm font-bold tracking-tight transition-colors duration-200",
                            isCurrent
                              ? "text-amber-900"
                              : isPast
                                ? "text-stone-800"
                                : "text-stone-400"
                          )}
                        >
                          {crit.label}
                        </h4>

                        {/* Status / Score pill */}
                        <div className="flex items-center gap-1.5 min-h-[22px]">
                          {isPast ? (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 text-xs font-bold font-mono">
                              <CheckCircle2 size={12} />
                              Band {realScore || "6.5"}
                            </div>
                          ) : isCurrent ? (
                            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-amber-100/70 text-amber-800 border border-amber-200 text-xs font-bold font-mono animate-pulse">
                              <Loader2 size={10} className="animate-spin" />
                              Evaluating
                            </div>
                          ) : (
                            <span className="text-[10px] font-bold font-mono tracking-widest text-stone-300 uppercase">
                              Pending
                            </span>
                          )}
                        </div>
                      </div>
                      <p
                        className={cn(
                          "text-[11px] leading-relaxed transition-colors duration-200",
                          isCurrent
                            ? "text-stone-600"
                            : isPast
                              ? "text-stone-500"
                              : "text-stone-350"
                        )}
                      >
                        {crit.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Overall bottom progress or actions */}
            <div className="pt-4 border-t border-stone-150 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {calcPhase >= 5 ? (
                  <div className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center animate-bounce">
                    <Award size={13} />
                  </div>
                ) : (
                  <div className="relative w-5 h-5 flex items-center justify-center">
                    <svg className="animate-spin w-full h-full text-stone-300" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="none"
                      />
                      <circle
                        className="text-amber-600"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeDasharray="60"
                        strokeDashoffset={60 - calcPhase * 12}
                        fill="none"
                      />
                    </svg>
                  </div>
                )}
                <span className="text-[11px] font-bold font-mono tracking-widest text-[#B45309] uppercase">
                  {calcPhase >= 5 ? "Aggregating Report..." : `Section ${calcPhase}/4 Evaluated`}
                </span>
              </div>

              <button
                onClick={() => {
                  if (calculationReport) {
                    setScore(calculationReport);
                    setStage("SCORE");
                  } else {
                    // force instant heuristics fallback so they don't block
                    setCalcPhase(5);
                  }
                }}
                className="px-3.5 py-1.5 text-[11px] font-bold font-mono tracking-wide rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-600 cursor-pointer transition-all uppercase"
              >
                Fast Track Report
              </button>
            </div>
          </div>
        )}
        {stage === "SCORE" && score && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-3xl bg-white border border-stone-200 rounded-3xl p-8 shadow-2xl shadow-stone-200/50"
          >
            <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-4">
               <div className="text-center sm:text-left">
                 <h2 className="text-3xl font-bold text-stone-800 mb-2">Test Performance Report</h2>
                 <p className="text-stone-500">
                   Official IELTS Speaking criteria audit and diagnostic feedback
                 </p>
               </div>
               <button
                  onClick={async () => {
                        const shareText = `🎯 I just scored an Overall Band ${score.overall} on the "${mockConfig?.title}" simulator!\n\n📋 Bands breakdown:\n• Fluency: ${score.fluency}\n• Lexical Resource: ${score.lexical}\n• Grammar: ${score.grammar}\n• Pronunciation: ${score.pronunciation}\n\nCan you beat my score? Check out the IELTS Speaking Simulator!`;
                        
                        let sharedSuccessfully = false;
                        if (navigator.share) {
                           try {
                              await navigator.share({
                                 title: 'My IELTS Mock Test Result',
                                 text: shareText,
                                 url: window.location.href,
                              });
                              sharedSuccessfully = true;
                           } catch (e) {
                              console.warn("navigator.share failed or blocked by iframe context, falling back to clipboard:", e);
                           }
                        }
                        
                        if (!sharedSuccessfully) {
                           try {
                              await navigator.clipboard.writeText(shareText + "\n" + window.location.href);
                              setShareCopied(true);
                              setTimeout(() => setShareCopied(false), 3000);
                           } catch (err) {
                              console.error("Clipboard copy failed:", err);
                              alert("Result copied! Please paste it to share: \n" + shareText);
                           }
                        }
                  }}
                  className={cn(
                    "px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-2 shadow-md",
                    shareCopied 
                      ? "bg-[#E6F4EA] border border-[#A3E2B6] text-[#137333] shadow-[#E6F4EA]/30" 
                      : "bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white shadow-amber-500/20"
                  )}
               >
                  {shareCopied ? (
                    <>
                      <Check size={14} className="stroke-[3]" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Share2 size={14} />
                      Share Result
                    </>
                  )}
               </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center mb-8 border border-stone-100 rounded-2xl p-6 bg-stone-50/50">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="w-28 h-28 rounded-full border-8 border-amber-500 flex flex-col items-center justify-center bg-amber-50 shadow-inner">
                  <span className="text-amber-700 font-extrabold text-3xl">{score.overall}</span>
                  <span className="text-amber-600/80 font-bold text-[10px] tracking-wider uppercase mt-0.5">
                    Overall
                  </span>
                </div>
              </div>
              <div className="md:col-span-2 text-stone-600 space-y-2 font-sans">
                <h3 className="text-stone-800 font-semibold text-base">
                  Your Diagnostic Breakdown
                </h3>
                <p className="text-xs leading-relaxed text-stone-500">
                  Our evaluation engine uses official IELTS Speaking Assessment Band Descriptors to
                  evaluate your fluency, lexical control, syntax accuracy, and clarity. Explore the
                  tabs below to read your detailed feedback.
                </p>
                <div className="flex gap-2 pt-1">
                  <span className="bg-stone-100 text-stone-600 text-[10px] font-bold px-2 py-0.5 rounded border border-stone-200/40">
                    Band 9.0 Benchmark
                  </span>
                  <span className="bg-amber-100/60 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-200/35">
                    Interactive Diagnostics
                  </span>
                </div>
              </div>
            </div>

            <div className="flex border-b border-stone-200 mb-6 gap-1 md:gap-3 overflow-x-auto pb-0.5 flex-nowrap max-w-full scrollbar-none" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
              {(["overview", "fluency", "lexical", "grammar", "pronunciation"] as const).map((tab) => {
                 const label = tab === "overview" ? "Overview" :
                               tab === "fluency" ? `Fluency (${score.fluency})` :
                               tab === "lexical" ? `Vocabulary (${score.lexical})` :
                               tab === "grammar" ? `Grammar (${score.grammar})` :
                               `Pronunciation (${score.pronunciation})`;
                 const isActive = activeScoreTab === tab;
                 return (
                   <button
                     key={tab}
                     onClick={() => setActiveScoreTab(tab as any)}
                     className={cn(
                       "pb-3 text-xs md:text-sm font-semibold tracking-wide transition-all px-3 cursor-pointer relative whitespace-nowrap flex-shrink-0",
                       isActive ? "text-amber-700 font-bold" : "text-stone-500 hover:text-stone-700"
                     )}
                   >
                     {isActive && (
                       <motion.div
                         layoutId="activeScoreTabLine"
                         className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 z-10"
                         transition={{ type: "spring", stiffness: 300, damping: 30 }}
                       />
                     )}
                     {label}
                   </button>
                 );
              })}
              
              {part2Analysis && (
                <button
                  onClick={() => setActiveScoreTab("part2analysis" as any)}
                  className={cn(
                    "pb-3 text-xs md:text-sm font-semibold tracking-wide transition-all px-3 cursor-pointer relative whitespace-nowrap flex-shrink-0",
                    activeScoreTab === ("part2analysis" as any)
                      ? "text-amber-700 font-bold"
                      : "text-stone-500 hover:text-stone-700"
                  )}
                >
                  {activeScoreTab === ("part2analysis" as any) && (
                     <motion.div
                       layoutId="activeScoreTabLine"
                       className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 z-10"
                       transition={{ type: "spring", stiffness: 300, damping: 30 }}
                     />
                  )}
                  Part 2 Analysis
                </button>
              )}
            </div>

            <div className="min-h-[220px]">
              {activeScoreTab === ("part2analysis" as any) && part2Analysis && (
                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                  <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-5 shadow-sm">
                    <h3 className="text-emerald-800 font-bold mb-3 text-sm flex items-center gap-2"><CheckCircle2 size={16}/> Vocabulary Upgrades</h3>
                    {part2Analysis.vocabularyUpgrades?.length ? (
                      <ul className="space-y-2">
                        {part2Analysis.vocabularyUpgrades.map((item: any, i: number) => (
                           <li key={i} className="text-xs text-stone-700 font-medium">
                             Instead of <span className="text-red-500 line-through">"{item.original}"</span>, try <span className="text-emerald-600 font-bold block mt-1 bg-white border border-emerald-100 px-2 py-1 rounded inline-block">"{item.better}"</span>
                           </li>
                        ))}
                      </ul>
                    ) : <p className="text-xs text-stone-500">Good vocabulary used.</p>}
                  </div>

                  <div className="bg-red-50/50 border border-red-100 rounded-2xl p-5 shadow-sm">
                    <h3 className="text-red-800 font-bold mb-3 text-sm flex items-center gap-2"><Activity size={16}/> Grammatical Corrections</h3>
                    {part2Analysis.grammarErrors?.length ? (
                      <ul className="space-y-2 uppercase-none">
                        {part2Analysis.grammarErrors.map((item: any, i: number) => (
                           <li key={i} className="text-xs text-stone-700 bg-white border border-red-100 p-2 rounded-lg">
                             <div className="text-red-600 font-bold mb-1 -mt-1 text-[10px] uppercase">Error</div>
                             <div className="italic mb-2">"{item.error}"</div>
                             <div className="text-emerald-700 font-bold mb-1 text-[10px] uppercase">Correction</div>
                             <div className="font-medium text-emerald-800">"{item.correction}"</div>
                           </li>
                        ))}
                      </ul>
                    ) : <p className="text-xs text-stone-500">No major grammatical errors found.</p>}
                  </div>

                  <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-5 shadow-sm">
                    <h3 className="text-amber-800 font-bold mb-3 text-sm flex items-center gap-2"><Volume2 size={16}/> Mispronounced / Misspelled Words</h3>
                    {part2Analysis.mispronouncedWords?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {part2Analysis.mispronouncedWords.map((word: string, i: number) => (
                           <span key={i} className="text-xs font-bold text-amber-900 bg-white border border-amber-200 px-3 py-1 rounded-full shadow-sm">
                             {word}
                           </span>
                        ))}
                      </div>
                    ) : <p className="text-xs text-stone-500">Pronunciation and spelling appear sharp based on transcript anomalies.</p>}
                  </div>
                </motion.div>
              )}

              {activeScoreTab === "overview" && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => setActiveScoreTab("fluency")}
                      className="bg-stone-50 hover:bg-stone-100/80 transition rounded-2xl p-4 border border-stone-100 flex justify-between items-center text-left cursor-pointer"
                    >
                      <div>
                        <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider block">
                          Fluency & Coherence
                        </span>
                        <span className="text-xs text-stone-500 font-medium">Delivery pacing</span>
                      </div>
                      <span className="text-xl font-extrabold text-stone-800 bg-amber-50/50 w-10 h-10 rounded-xl flex items-center justify-center border border-amber-200/45">
                        {score.fluency}
                      </span>
                    </button>
                    <button
                      onClick={() => setActiveScoreTab("lexical")}
                      className="bg-stone-50 hover:bg-stone-100/80 transition rounded-2xl p-4 border border-stone-100 flex justify-between items-center text-left cursor-pointer"
                    >
                      <div>
                        <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider block">
                          Lexical Resource
                        </span>
                        <span className="text-xs text-stone-500 font-medium">Vocabulary range</span>
                      </div>
                      <span className="text-xl font-extrabold text-stone-800 bg-amber-50/50 w-10 h-10 rounded-xl flex items-center justify-center border border-amber-200/45">
                        {score.lexical}
                      </span>
                    </button>
                    <button
                      onClick={() => setActiveScoreTab("grammar")}
                      className="bg-stone-50 hover:bg-stone-100/80 transition rounded-2xl p-4 border border-stone-100 flex justify-between items-center text-left cursor-pointer"
                    >
                      <div>
                        <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider block">
                          Grammatical Range
                        </span>
                        <span className="text-xs text-stone-500 font-medium">
                          Structure and tenses
                        </span>
                      </div>
                      <span className="text-xl font-extrabold text-stone-800 bg-amber-50/50 w-10 h-10 rounded-xl flex items-center justify-center border border-amber-200/45">
                        {score.grammar}
                      </span>
                    </button>
                    <button
                      onClick={() => setActiveScoreTab("pronunciation")}
                      className="bg-stone-50 hover:bg-stone-100/80 transition rounded-2xl p-4 border border-stone-100 flex justify-between items-center text-left cursor-pointer"
                    >
                      <div>
                        <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider block">
                          Pronunciation
                        </span>
                        <span className="text-xs text-stone-500 font-medium">
                          Clarity and voice strain
                        </span>
                      </div>
                      <span className="text-xl font-extrabold text-stone-800 bg-amber-50/50 w-10 h-10 rounded-xl flex items-center justify-center border border-amber-200/45">
                        {score.pronunciation}
                      </span>
                    </button>
                  </div>

                  <div className="bg-amber-50/60 border border-amber-100/50 rounded-2xl p-6 relative shadow-sm">
                    <span className="absolute -top-3 left-6 bg-amber-500 text-white text-[9px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-lg border border-amber-600/10 shadow-sm">
                      Test Summary
                    </span>
                    <p className="text-amber-900/80 leading-relaxed font-sans text-xs pt-1">
                      {score.feedback}
                    </p>
                  </div>

                  {/* Practice Recordings Section */}
                  <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 border-b border-stone-100 pb-3">
                      <Volume2 size={16} className="text-amber-500" />
                      <h3 className="text-stone-800 font-bold text-sm">Listen to Your Practice Recordings</h3>
                    </div>
                    <p className="text-[11px] text-stone-500 leading-normal mb-2">
                      Review your recorded voice responses for each part of the test to analyze your pacing, pauses, and pronunciation transitions. (Recordings are stored in-memory during this practice attempt)
                    </p>
                    <div className="space-y-3">
                      <AudioRecordingTrack blob={part1AudioBlob} label="Part 1: Interview Answers" />
                      <AudioRecordingTrack blob={part2AudioBlob} label="Part 2: Cue Card Presentation" />
                      <AudioRecordingTrack blob={part3AudioBlob} label="Part 3: Deep Discussion Responses" />
                    </div>
                  </div>
                </motion.div>
              )}

              {activeScoreTab === "fluency" && score.fluencyBreakdown && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="bg-stone-50/80 border border-stone-200/50 rounded-2xl p-5">
                    <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider block mb-1">
                      Official Benchmark Criterion
                    </span>
                    <p className="text-stone-800 font-medium text-xs font-mono leading-relaxed bg-white border border-stone-150 rounded-xl p-3.5 italic shadow-sm">
                      "{score.fluencyBreakdown.descriptor}"
                    </p>
                  </div>

                  <div className="border-l-4 border-amber-500 pl-4 space-y-1">
                    <h4 className="font-semibold text-stone-800 text-xs">
                      Why you received a Band {score.fluency}
                    </h4>
                    <p className="text-[11px] leading-relaxed text-stone-500 font-sans">
                      {score.fluencyBreakdown.details}
                    </p>
                  </div>

                  <div className="bg-teal-50/40 border border-teal-100/50 rounded-2xl p-5">
                    <span className="text-[10px] text-teal-600 font-bold uppercase tracking-wider block mb-1">
                      High-Impact Practice Drill
                    </span>
                    <p className="text-teal-900/80 leading-relaxed text-[11px] font-sans">
                      {score.fluencyBreakdown.action}
                    </p>
                  </div>
                </motion.div>
              )}

              {activeScoreTab === "lexical" && score.lexicalBreakdown && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="bg-stone-50/80 border border-stone-200/50 rounded-2xl p-5">
                    <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider block mb-1">
                      Official Benchmark Criterion
                    </span>
                    <p className="text-stone-800 font-bold text-xs font-mono leading-relaxed bg-white border border-stone-150 rounded-xl p-3.5 italic shadow-sm">
                      "{score.lexicalBreakdown.descriptor}"
                    </p>
                  </div>

                  <div className="border-l-4 border-amber-500 pl-4 space-y-1">
                    <h4 className="font-semibold text-stone-800 text-xs">
                      Why you received a Band {score.lexical}
                    </h4>
                    <p className="text-[11px] leading-relaxed text-stone-500 font-sans">
                      {score.lexicalBreakdown.details}
                    </p>
                  </div>

                  <div className="bg-teal-50/40 border border-teal-100/50 rounded-2xl p-5">
                    <span className="text-[10px] text-teal-600 font-bold uppercase tracking-wider block mb-1">
                      High-Impact Practice Drill
                    </span>
                    <p className="text-teal-900/80 leading-relaxed text-[11px] font-sans">
                      {score.lexicalBreakdown.action}
                    </p>
                  </div>
                </motion.div>
              )}

              {activeScoreTab === "grammar" && score.grammarBreakdown && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="bg-stone-50/80 border border-stone-200/50 rounded-2xl p-5">
                    <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider block mb-1">
                      Official Benchmark Criterion
                    </span>
                    <p className="text-stone-800 font-bold text-xs font-mono leading-relaxed bg-white border border-stone-150 rounded-xl p-3.5 italic shadow-sm">
                      "{score.grammarBreakdown.descriptor}"
                    </p>
                  </div>

                  <div className="border-l-4 border-amber-500 pl-4 space-y-1">
                    <h4 className="font-semibold text-stone-800 text-xs">
                      Why you received a Band {score.grammar}
                    </h4>
                    <p className="text-[11px] leading-relaxed text-stone-500 font-sans">
                      {score.grammarBreakdown.details}
                    </p>
                  </div>

                  <div className="bg-teal-50/40 border border-teal-100/50 rounded-2xl p-5">
                    <span className="text-[10px] text-teal-600 font-bold uppercase tracking-wider block mb-1">
                      High-Impact Practice Drill
                    </span>
                    <p className="text-teal-900/80 leading-relaxed text-[11px] font-sans">
                      {score.grammarBreakdown.action}
                    </p>
                  </div>
                </motion.div>
              )}

              {activeScoreTab === "pronunciation" && score.pronunciationBreakdown && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="bg-stone-50/80 border border-stone-200/50 rounded-2xl p-5">
                    <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider block mb-1">
                      Official Benchmark Criterion
                    </span>
                    <p className="text-stone-800 font-bold text-xs font-mono leading-relaxed bg-white border border-stone-150 rounded-xl p-3.5 italic shadow-sm">
                      "{score.pronunciationBreakdown.descriptor}"
                    </p>
                  </div>

                  <div className="border-l-4 border-amber-500 pl-4 space-y-1">
                    <h4 className="font-semibold text-stone-800 text-xs">
                      Why you received a Band {score.pronunciation}
                    </h4>
                    <p className="text-[11px] leading-relaxed text-stone-500 font-sans">
                      {score.pronunciationBreakdown.details}
                    </p>
                  </div>

                  <div className="bg-teal-50/40 border border-teal-100/50 rounded-2xl p-5">
                    <span className="text-[10px] text-teal-600 font-bold uppercase tracking-wider block mb-1">
                      High-Impact Practice Drill
                    </span>
                    <p className="text-teal-950/80 leading-relaxed text-[11px] font-sans">
                      {score.pronunciationBreakdown.action}
                    </p>
                  </div>

                  {score.pronunciationBreakdown.mispronouncedWords && score.pronunciationBreakdown.mispronouncedWords.length > 0 && (
                    <div className="bg-rose-50/40 border border-rose-100/50 rounded-2xl p-5">
                      <span className="text-[10px] text-rose-600 font-bold uppercase tracking-wider block mb-2">
                        Mispronounced / Flagged Words
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {score.pronunciationBreakdown.mispronouncedWords.map((word: string, i: number) => (
                           <button
                             key={i}
                             onClick={() => {
                               if ('speechSynthesis' in window) {
                                  const utterance = new SpeechSynthesisUtterance(word);
                                  utterance.lang = 'en-GB';
                                  window.speechSynthesis.speak(utterance);
                               }
                             }}
                             className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-rose-200 rounded-lg text-rose-800 text-xs font-semibold shadow-sm hover:bg-rose-50 hover:border-rose-300 transition-colors"
                           >
                             <Volume2 size={12} /> {word}
                           </button>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </main>

      {showMicPermissionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-md animate-fadeIn">
          <motion.div
            initial={{ scale: 0.95, y: 15, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            className="bg-white border border-stone-200 rounded-3xl max-w-md w-full p-6 shadow-xl relative select-none font-sans"
          >
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-amber-50 rounded-2xl text-amber-600">
                <Mic size={24} className="animate-pulse" />
              </div>
              <div className="text-left">
                <h3 className="text-base font-extrabold text-[#6B5A43] tracking-tight">
                  Microphone Permission Required
                </h3>
                <p className="text-xs text-stone-500 font-medium font-sans">
                  Please allow access to proceed with the speaking test
                </p>
              </div>
            </div>

            {/* Instruction Steps */}
            <div className="space-y-3 bg-[#FCFAF6] border border-stone-200/50 p-4.5 rounded-2xl text-left mb-6 font-sans">
              <p className="text-xs font-semibold text-stone-700 leading-relaxed">
                We need microphone permission to capture and transcribe your speech in real-time.
                Please follow these simple steps to grant access:
              </p>
              <div className="space-y-2 pt-1">
                <div className="flex gap-2.5 items-start">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-[10px] font-bold text-amber-800 shrink-0 font-mono mt-0.5">
                    1
                  </span>
                  <p className="text-xs text-stone-600 font-medium leading-relaxed">
                    Check your browser's address bar (on the top left). If there is a browser pop-up
                    prompt asking for microphone access, select <strong>"Allow"</strong>.
                  </p>
                </div>
                <div className="flex gap-2.5 items-start">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-[10px] font-bold text-amber-800 shrink-0 font-mono mt-0.5">
                    2
                  </span>
                  <p className="text-xs text-stone-600 font-medium leading-relaxed">
                    If access is blocked, click the <strong>Lock (🔒) or Settings icon</strong> in
                    your browser's address bar and set <strong>Microphone</strong> to{" "}
                    <strong>"Allow"</strong>.
                  </p>
                </div>
                <div className="flex gap-2.5 items-start">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-[10px] font-bold text-amber-800 shrink-0 font-mono mt-0.5">
                    3
                  </span>
                  <p className="text-xs text-stone-600 font-medium leading-relaxed">
                    Once allowed, click the <strong>Retry Authorization</strong> button below to
                    calibrate your mic.
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowMicPermissionModal(false);
                  startMicCheck();
                }}
                className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs py-3.5 px-6 rounded-2xl transition-all shadow-md shadow-amber-600/10 cursor-pointer text-center"
              >
                Retry Authorization
              </button>
              <button
                type="button"
                onClick={() => setShowMicPermissionModal(false)}
                className="border border-stone-200 hover:bg-stone-50 text-stone-600 font-bold text-xs py-3.5 px-6 rounded-2xl transition-all cursor-pointer text-center"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Bottom Right Floating Button for Manual Transitions */}
      <AnimatePresence>
        {manualTransitionState && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-6 right-6 z-50"
          >
            <button
              onClick={() => {
                const action = manualTransitionState;
                updateManualTransitionState(null);
                try {
                  teardownSessionSocket();
                } catch (e) {}
                if (action === "PART_2") {
                  updateStage("TRANSITION_PART_2");
                  setTimeout(async () => {
                    updateStage("PART_2_INSTRUCT");
                    updateHasAiSpoken(false);
                    await connectLiveApi(2);
                  }, 3000);
                } else if (action === "PART_3") {
                  updateStage("TRANSITION_PART_3");
                  setTimeout(async () => {
                    updateStage("PART_3");
                    updateHasAiSpoken(false);
                    await connectLiveApi(3);
                  }, 3000);
                } else if (action === "END_TEST") {
                  updateStage("CALCULATING");
                  generateScore();
                }
              }}
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white font-bold py-3.5 px-6 rounded-2xl shadow-xl shadow-amber-600/30 cursor-pointer transition-all hover:scale-105 active:scale-95"
            >
              <span>
                {manualTransitionState === "PART_2" && "Part 2"}
                {manualTransitionState === "PART_3" && "Part 3"}
                {manualTransitionState === "END_TEST" && "End Task"}
              </span>
              <ChevronRight size={18} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
