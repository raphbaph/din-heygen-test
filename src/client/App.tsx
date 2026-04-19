import {
  AgentEventsEnum,
  LiveAvatarSession,
  SessionEvent,
  SessionState
} from "@heygen/liveavatar-web-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { type TranscriptEntry } from "../shared/conversation";

type JoinState = "idle" | "joining" | "joined" | "error";
const AVATAR_BOOTSTRAP_KEY = "__dinAvatarBootstrapState";

type AvatarBootstrapState = "idle" | "bootstrapping" | "bootstrapped";

declare global {
  interface Window {
    __dinAvatarBootstrapState?: AvatarBootstrapState;
  }
}

export default function App() {
  const isOutputMode = useMemo(
    () => new URLSearchParams(window.location.search).get("output") === "1",
    []
  );

  if (isOutputMode) {
    return <BotOutputPage />;
  }

  return <OperatorPage />;
}

function OperatorPage() {
  const [meetUrl, setMeetUrl] = useState("");
  const [joinState, setJoinState] = useState<JoinState>("idle");
  const [statusMessage, setStatusMessage] = useState(
    "Ready. Paste a Google Meet URL and launch the bot."
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleJoinMeet() {
    try {
      setJoinState("joining");
      setErrorMessage(null);
      setStatusMessage("Launching Recall bot into Google Meet.");

      const response = await fetch("/api/join-meet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ meetingUrl: meetUrl })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setJoinState("joined");
      setStatusMessage(
        "Bot launch requested. Recall will open the output-only avatar page in the bot browser."
      );
    } catch (error) {
      console.error(error);
      setJoinState("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to launch Recall bot.");
      setStatusMessage("Bot launch failed.");
    }
  }

  const joinDisabled = !meetUrl.trim() || joinState === "joining";

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Recall x HeyGen x Google Meet</p>
          <h1>Minimal avatar join test</h1>
          <p className="lede">
            This control page is for you only. The Recall bot opens a separate output page that
            renders just the avatar video into the meeting.
          </p>
        </div>

        <div className="join-panel">
          <label className="field">
            <span>Google Meet URL</span>
            <input
              value={meetUrl}
              onChange={(event) => setMeetUrl(event.target.value)}
              placeholder="https://meet.google.com/..."
              type="url"
            />
          </label>

          <button disabled={joinDisabled} onClick={() => void handleJoinMeet()} type="button">
            {joinState === "joining" ? "Joining Meet..." : "Join Meet"}
          </button>

          <div className="status-stack">
            <p className="status-line">
              <strong>Status:</strong> {statusMessage}
            </p>
            <p className="status-line">
              <strong>Bot output page:</strong> <code>?output=1</code>
            </p>
            {errorMessage ? <p className="error-line">{errorMessage}</p> : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function BotOutputPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<LiveAvatarSession | null>(null);
  const transcriptEventSourceRef = useRef<EventSource | null>(null);
  const ignoreTranscriptsUntilRef = useRef(0);
  const isAvatarTalkingRef = useRef(false);
  const queuedAvatarRepliesRef = useRef<ChatReplyEvent["data"][]>([]);
  const launchId = useMemo(
    () => new URLSearchParams(window.location.search).get("launchId"),
    []
  );

  const [sessionState, setSessionState] = useState(SessionState.INACTIVE);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [isAvatarTalking, setIsAvatarTalking] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Waiting to initialize avatar session.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [lastTranscriptPreview, setLastTranscriptPreview] = useState("None yet.");
  const [lastChatRequestText, setLastChatRequestText] = useState("None yet.");
  const [lastChatReplyText, setLastChatReplyText] = useState("None yet.");
  const [lastDebugMessage, setLastDebugMessage] = useState("Booting.");

  useEffect(() => {
    const bootstrapState = window[AVATAR_BOOTSTRAP_KEY];
    if (bootstrapState === "bootstrapping" || bootstrapState === "bootstrapped") {
      setLastDebugMessage(`Skipped duplicate bootstrap: ${bootstrapState}.`);
      return;
    }

    window[AVATAR_BOOTSTRAP_KEY] = "bootstrapping";
    let cancelled = false;

    async function bootstrap() {
      try {
        setLastDebugMessage("Requesting HeyGen session token.");
        setStatusMessage("Creating HeyGen session.");
        const response = await fetch("/api/session", { method: "POST" });
        if (!response.ok) {
          throw new Error(await response.text());
        }

        const sessionData = (await response.json()) as {
          session_id: string;
          session_token: string;
        };

        if (cancelled) {
          return;
        }

        const session = new LiveAvatarSession(sessionData.session_token, {
          voiceChat: false,
          apiUrl: "https://api.liveavatar.com"
        });

        sessionRef.current = session;
        setLastDebugMessage("HeyGen session token received.");

        session.on(SessionEvent.SESSION_STATE_CHANGED, (nextState) => {
          setSessionState(nextState);
          setLastDebugMessage(`HeyGen session state changed to ${String(nextState)}.`);
        });
        session.on(SessionEvent.SESSION_STREAM_READY, () => {
          setIsStreamReady(true);
          setStatusMessage("Avatar stream ready.");
          setLastDebugMessage("HeyGen avatar stream ready.");
        });
        session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
          isAvatarTalkingRef.current = true;
          ignoreTranscriptsUntilRef.current = Date.now() + 1500;
          setIsAvatarTalking(true);
        });
        session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
          isAvatarTalkingRef.current = false;
          ignoreTranscriptsUntilRef.current = Date.now() + 1500;
          setIsAvatarTalking(false);
        });

        setStatusMessage("Starting avatar stream.");
        setLastDebugMessage("Starting HeyGen avatar session.");
        await session.start();
        if (videoRef.current) {
          session.attach(videoRef.current);
          setLastDebugMessage("HeyGen avatar attached to video element.");
        }

        window[AVATAR_BOOTSTRAP_KEY] = "bootstrapped";
        setStatusMessage("Avatar ready. Launch a Meet when you want.");
      } catch (error) {
        console.error(error);
        window[AVATAR_BOOTSTRAP_KEY] = "idle";
        setErrorMessage(error instanceof Error ? error.message : "Failed to initialize avatar.");
        setStatusMessage("Avatar setup failed.");
        setLastDebugMessage("HeyGen bootstrap failed.");
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
      transcriptEventSourceRef.current?.close();
      sessionRef.current?.removeAllListeners();
      if (sessionRef.current?.state === SessionState.CONNECTED) {
        void sessionRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (!isStreamReady || !videoRef.current || !sessionRef.current) {
      return;
    }

    sessionRef.current.attach(videoRef.current);
  }, [isStreamReady]);

  useEffect(() => {
    if (!launchId) {
      setErrorMessage("Missing Recall launchId in bot output URL.");
      setStatusMessage("Transcript setup failed.");
      setLastDebugMessage("Cannot subscribe to Recall transcript events without launchId.");
      return;
    }

    const eventSource = new EventSource(
      `/api/transcript-events?launchId=${encodeURIComponent(launchId)}`
    );
    transcriptEventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setStatusMessage("Waiting for finalized speech from the meeting.");
      setLastDebugMessage("Recall transcript event stream connected.");
    };

    eventSource.onmessage = (event) => {
      void handleTranscriptEvent(event.data);
    };

    eventSource.onerror = () => {
      setErrorMessage("Recall transcript stream failed.");
      setStatusMessage("Recall transcript stream failed.");
      setLastDebugMessage("Recall transcript event stream error.");
    };

    return () => {
      if (transcriptEventSourceRef.current === eventSource) {
        transcriptEventSourceRef.current = null;
      }
      eventSource.close();
    };
  }, [launchId]);

  async function handleTranscriptEvent(rawMessage: string) {
    let payload: StreamEvent;

    try {
      payload = JSON.parse(rawMessage) as StreamEvent;
    } catch (error) {
      console.error("Recall transcript payload parse failed", error);
      return;
    }

    if (payload.event === "ready") {
      setLastDebugMessage("Recall transcript event stream ready.");
      return;
    }

    if (payload.event === "chat.reply") {
      await handleChatReplyEvent(payload);
      return;
    }

    const transcriptEvent = getTranscriptEvent(payload);
    if (!transcriptEvent) {
      return;
    }

    setLastTranscriptPreview(
      `${transcriptEvent.participantName ?? "unknown"}: ${transcriptEvent.text || "[empty]"}`
    );
    setLastDebugMessage(
      transcriptEvent.event === "transcript.partial_data"
        ? `Observed partial transcript update ${transcriptEvent.id ?? "unknown"}.`
        : `Observed finalized transcript ${transcriptEvent.id ?? "unknown"}.`
    );
  }

  async function speakAsAvatar(text: string) {
    const session = sessionRef.current;
    if (!session) {
      setLastDebugMessage("Avatar session was missing before speak.");
      return;
    }

    setStatusMessage("Avatar speaking.");

    try {
      ignoreTranscriptsUntilRef.current = Date.now() + 1500;
      setLastDebugMessage("Sending text to HeyGen avatar.");
      session.repeat(text);
    } catch (error) {
      console.error("Avatar speak failed", error);
      setErrorMessage(error instanceof Error ? error.message : "Avatar failed to speak.");
      setLastDebugMessage("HeyGen avatar speak failed.");
    } finally {
      setStatusMessage("Waiting for finalized speech from the meeting.");
      void flushQueuedAvatarReplies();
    }
  }

  async function handleChatReplyEvent(payload: ChatReplyEvent) {
    appendTranscript("user", payload.data.userText);
    setLastChatRequestText(payload.data.userText);
    setLastChatReplyText(payload.data.reply);

    if (isAvatarTalkingRef.current || Date.now() < ignoreTranscriptsUntilRef.current) {
      queuedAvatarRepliesRef.current.push(payload.data);
      setLastDebugMessage(
        `Queued avatar reply for transcript ${payload.data.transcriptId} while avatar was busy.`
      );
      return;
    }

    setLastDebugMessage(
      `Speaking server reply for transcript ${payload.data.transcriptId}.`
    );
    appendTranscript("avatar", payload.data.reply);
    await speakAsAvatar(payload.data.reply);
  }

  async function flushQueuedAvatarReplies() {
    if (isAvatarTalkingRef.current || Date.now() < ignoreTranscriptsUntilRef.current) {
      return;
    }

    const nextReply = queuedAvatarRepliesRef.current.shift();
    if (!nextReply) {
      return;
    }

    setLastDebugMessage(
      `Flushing queued avatar reply for transcript ${nextReply.transcriptId}.`
    );
    appendTranscript("avatar", nextReply.reply);
    setLastChatReplyText(nextReply.reply);
    await speakAsAvatar(nextReply.reply);
  }

  function appendTranscript(speaker: TranscriptEntry["speaker"], text: string) {
    setTranscript((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        speaker,
        text
      }
    ]);
  }

  return (
    <main className="output-shell">
      <video className="output-video" ref={videoRef} autoPlay playsInline muted={false} />
      <div className={`output-overlay ${isStreamReady ? "output-overlay-live" : ""}`}>
        <p className="output-status">{statusMessage}</p>
        <p className="output-meta">Session: {String(sessionState)}</p>
        <p className="output-meta">Transcript stream: Recall webhook via SSE</p>
        <p className="output-meta">Avatar speaking: {isAvatarTalking ? "yes" : "no"}</p>
        <p className="output-meta">Last event: {lastDebugMessage}</p>
        <p className="output-meta">Last heard: {lastTranscriptPreview}</p>
        <p className="output-meta">Last /api/chat input: {lastChatRequestText}</p>
        <p className="output-meta">Last avatar reply: {lastChatReplyText}</p>
        <p className="output-meta">Transcript entries: {transcript.length}</p>
        {errorMessage ? <p className="error-line">{errorMessage}</p> : null}
      </div>
    </main>
  );
}

type RecallTranscriptSocketMessage = {
  event?: string;
  data?: {
    data?: {
      words?: Array<{
        text?: string;
        start_timestamp?: {
          relative?: number;
        } | null;
      }>;
      participant?: {
        id?: number | string;
        name?: string | null;
      };
    };
    transcript?: {
      id?: string;
    };
  };
  transcript?: {
    words?: Array<{ text?: string }>;
    participant?: {
      id?: number | string;
      name?: string | null;
    };
    id?: string;
  };
};

type ChatReplyEvent = {
  event: "chat.reply";
  data: {
    userText: string;
    reply: string;
    transcriptId: string;
    participantName: string;
  };
};

type StreamEvent = RecallTranscriptSocketMessage | ChatReplyEvent | { event: "ready" };

function getTranscriptEvent(payload: RecallTranscriptSocketMessage) {
  const data = payload.data?.data;
  const transcript = payload.transcript;
  const words = data?.words ?? transcript?.words ?? [];
  const text = words
    .map((word) => word.text?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  const participantId = data?.participant?.id ?? transcript?.participant?.id ?? null;
  const participantName = data?.participant?.name ?? transcript?.participant?.name ?? null;
  const transcriptId = payload.data?.transcript?.id ?? transcript?.id ?? null;
  const firstWordStart = words[0]?.start_timestamp?.relative ?? null;
  const normalizedEvent = payload.event ?? "unknown";
  const fallbackKeyParts = [
    participantId ?? participantName ?? "unknown",
    firstWordStart ?? "na",
    text
  ];
  const key = transcriptId ?? fallbackKeyParts.join(":");

  return {
    event: normalizedEvent,
    id: transcriptId,
    key,
    participantName,
    text
  };
}

type FinalTranscriptEvent = ReturnType<typeof getTranscriptEvent>;
