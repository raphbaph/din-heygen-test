import {
  AgentEventsEnum,
  LiveAvatarSession,
  SessionEvent,
  SessionState
} from "@heygen/liveavatar-web-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getIntroLine,
  getNextReply,
  initialConversationState,
  type ConversationState,
  type TranscriptEntry
} from "../shared/conversation";

const SPEECH_RECOGNITION_GAP_MS = 800;

type JoinState = "idle" | "joining" | "joined" | "error";

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
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalizedTextTimerRef = useRef<number | null>(null);
  const introDeliveredRef = useRef(false);
  const shouldRestartRecognitionRef = useRef(true);

  const [sessionState, setSessionState] = useState(SessionState.INACTIVE);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [isAvatarTalking, setIsAvatarTalking] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Waiting to initialize avatar session.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [conversationState, setConversationState] =
    useState<ConversationState>(initialConversationState);

  const speechRecognitionSupported = useMemo(
    () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        setStatusMessage("Requesting microphone access.");
        await navigator.mediaDevices.getUserMedia({ audio: true });

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

        session.on(SessionEvent.SESSION_STATE_CHANGED, (nextState) => {
          setSessionState(nextState);
        });
        session.on(SessionEvent.SESSION_STREAM_READY, () => {
          setIsStreamReady(true);
          setStatusMessage("Avatar stream ready.");
        });
        session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
          setIsAvatarTalking(true);
        });
        session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
          setIsAvatarTalking(false);
        });

        setStatusMessage("Starting avatar stream.");
        await session.start();
        if (videoRef.current) {
          session.attach(videoRef.current);
        }

        setStatusMessage("Avatar ready. Launch a Meet when you want.");
      } catch (error) {
        console.error(error);
        setErrorMessage(error instanceof Error ? error.message : "Failed to initialize avatar.");
        setStatusMessage("Avatar setup failed.");
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
      shouldRestartRecognitionRef.current = false;

      if (finalizedTextTimerRef.current !== null) {
        window.clearTimeout(finalizedTextTimerRef.current);
      }

      recognitionRef.current?.stop();
      sessionRef.current?.removeAllListeners();
      void sessionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!isStreamReady || !videoRef.current || !sessionRef.current) {
      return;
    }

    sessionRef.current.attach(videoRef.current);
  }, [isStreamReady]);

  useEffect(() => {
    if (!isStreamReady || introDeliveredRef.current || !sessionRef.current) {
      return;
    }

    introDeliveredRef.current = true;
    void speakAsAvatar(getIntroLine());
    setConversationState({ stage: "waiting_for_interest" });
  }, [isStreamReady]);

  useEffect(() => {
    if (!speechRecognitionSupported || !isStreamReady) {
      return;
    }

    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Recognition) {
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const latestResult = event.results[event.results.length - 1];
      if (!latestResult?.isFinal) {
        return;
      }

      const latestText = latestResult[0]?.transcript?.trim();
      if (!latestText) {
        return;
      }

      if (finalizedTextTimerRef.current !== null) {
        window.clearTimeout(finalizedTextTimerRef.current);
      }

      finalizedTextTimerRef.current = window.setTimeout(() => {
        void handleUserUtterance(latestText);
      }, SPEECH_RECOGNITION_GAP_MS);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error", event.error, event.message);
    };

    recognition.onend = () => {
      if (shouldRestartRecognitionRef.current) {
        try {
          recognition.start();
        } catch (error) {
          console.error("Speech recognition restart failed", error);
        }
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setStatusMessage("Listening for speech from the meeting.");
    } catch (error) {
      console.error("Speech recognition start failed", error);
    }

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [isStreamReady, speechRecognitionSupported]);

  async function handleUserUtterance(text: string) {
    appendTranscript("user", text);

    const next = getNextReply(conversationState, text);
    if (!next) {
      return;
    }

    setConversationState(next.nextState);
    await speakAsAvatar(next.reply);
  }

  async function speakAsAvatar(text: string) {
    appendTranscript("avatar", text);

    const session = sessionRef.current;
    if (!session) {
      return;
    }

    setStatusMessage("Avatar speaking.");

    try {
      session.repeat(text);
    } catch (error) {
      console.error("Avatar speak failed", error);
      setErrorMessage(error instanceof Error ? error.message : "Avatar failed to speak.");
    } finally {
      setStatusMessage("Listening for speech from the meeting.");
    }
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
      {!isStreamReady ? (
        <div className="output-overlay">
          <p className="output-status">{statusMessage}</p>
          <p className="output-meta">Session: {String(sessionState)}</p>
          <p className="output-meta">Speech recognition: {speechRecognitionSupported ? "on" : "off"}</p>
          <p className="output-meta">Avatar speaking: {isAvatarTalking ? "yes" : "no"}</p>
          {errorMessage ? <p className="error-line">{errorMessage}</p> : null}
        </div>
      ) : null}
    </main>
  );
}
