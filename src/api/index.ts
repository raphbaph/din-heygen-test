import http from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createChatTurn } from "./chat.js";
import { createHeyGenSession } from "./heygen.js";
import { launchRecallBot } from "./recall.js";

const port = 4000;
const transcriptSubscribers = new Map<string, Set<http.ServerResponse>>();
const bufferedTranscriptEvents = new Map<string, string[]>();
const launchConversationIds = new Map<string, string>();
const transcriptProcessingQueues = new Map<string, TranscriptDataEvent[]>();
const transcriptProcessingActive = new Map<string, boolean>();
const recentTranscriptFingerprints = new Map<string, Map<string, number>>();
const MAX_BUFFERED_TRANSCRIPT_EVENTS = 25;
const TRANSCRIPT_FINGERPRINT_TTL_MS = 1000 * 30;

const TranscriptWordSchema = z.object({
  text: z.string(),
  start_timestamp: z
    .object({
      relative: z.number()
    })
    .nullish(),
  end_timestamp: z
    .object({
      relative: z.number()
    })
    .nullish()
});

const TranscriptEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("transcript.data"),
    data: z.object({
      data: z.object({
        words: z.array(TranscriptWordSchema),
        participant: z.object({
          id: z.union([z.number(), z.string()]),
          name: z.string().nullish()
        })
      }),
      transcript: z.object({
        id: z.string()
      }),
      recording: z.object({
        id: z.string()
      })
    })
  }),
  z.object({
    event: z.literal("transcript.partial_data"),
    data: z.object({
      data: z.object({
        words: z.array(TranscriptWordSchema),
        participant: z.object({
          id: z.union([z.number(), z.string()]),
          name: z.string().nullish()
        })
      }),
      transcript: z.object({
        id: z.string()
      }),
      recording: z.object({
        id: z.string()
      })
    })
  })
]);
type TranscriptEvent = z.infer<typeof TranscriptEventSchema>;
type TranscriptDataEvent = Extract<TranscriptEvent, { event: "transcript.data" }>;

const ChatReplyEventSchema = z.object({
  event: z.literal("chat.reply"),
  data: z.object({
    userText: z.string(),
    reply: z.string(),
    transcriptId: z.string(),
    participantName: z.string()
  })
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/transcript-events") {
      const launchId = url.searchParams.get("launchId");
      if (!launchId) {
        return json(res, 400, { error: "Missing launchId." });
      }

      console.log("[recall] transcript event subscriber connected", { launchId });
      return openTranscriptEventStream(res, launchId);
    }

    if (req.method === "POST" && url.pathname === "/api/session") {
      console.log("[heygen] /api/session requested");
      const session = await createHeyGenSession();
      console.log("[heygen] /api/session created", {
        sessionId: session.session_id
      });
      return json(res, 200, session);
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJsonBody(req);
      const chatTurn = await createChatTurn(body);
      return json(res, 200, chatTurn);
    }

    if (req.method === "POST" && url.pathname === "/api/join-meet") {
      const body = await readJsonBody(req);
      const bot = await launchRecallBot(body);
      return json(res, 200, bot);
    }

    if (req.method === "POST" && url.pathname === "/api/recall-transcript") {
      const launchId = url.searchParams.get("launchId");
      if (!launchId) {
        return json(res, 400, { error: "Missing launchId." });
      }

      const body = await readJsonBody(req);
      const result = TranscriptEventSchema.safeParse(body);

      if (!result.success) {
        console.log("[recall] received unhandled webhook payload", {
          launchId,
          event: body?.event ?? "unknown",
          recordingId: body?.data?.recording?.id ?? "unknown"
        });
        return json(res, 200, { ok: true });
      }

      const transcriptEvent = result.data;
      const transcriptText = transcriptEvent.data.data.words.map((word) => word.text).join(" ");
      console.log("[recall] webhook event received", {
        launchId,
        event: transcriptEvent.event,
        recordingId: transcriptEvent.data.recording.id,
        transcriptId: transcriptEvent.data.transcript.id,
        participant: transcriptEvent.data.data.participant.name ??
          transcriptEvent.data.data.participant.id,
        textPreview: transcriptText.slice(0, 160)
      });

      publishTranscriptEvent(launchId, transcriptEvent);
      if (transcriptEvent.event === "transcript.data") {
        enqueueTranscriptForProcessing(launchId, transcriptEvent);
      }
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: `Not found: ${req.method} ${url.pathname}` });
  } catch (error) {
    console.error(error);
    return json(res, 400, {
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`API server listening on http://localhost:${port}`);
});

async function readJsonBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function openTranscriptEventStream(res: http.ServerResponse, launchId: string) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  res.write(`data: ${JSON.stringify({ event: "ready" })}\n\n`);

  const listeners = transcriptSubscribers.get(launchId) ?? new Set<http.ServerResponse>();
  listeners.add(res);
  transcriptSubscribers.set(launchId, listeners);

  const bufferedEvents = bufferedTranscriptEvents.get(launchId) ?? [];
  for (const bufferedEvent of bufferedEvents) {
    res.write(bufferedEvent);
  }

  res.on("close", () => {
    const currentListeners = transcriptSubscribers.get(launchId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(res);
    if (currentListeners.size === 0) {
      transcriptSubscribers.delete(launchId);
    }

    console.log("[recall] transcript event subscriber disconnected", { launchId });
  });
}

function publishTranscriptEvent(launchId: string, payload: unknown) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  const bufferedEvents = bufferedTranscriptEvents.get(launchId) ?? [];
  bufferedEvents.push(message);
  if (bufferedEvents.length > MAX_BUFFERED_TRANSCRIPT_EVENTS) {
    bufferedEvents.shift();
  }
  bufferedTranscriptEvents.set(launchId, bufferedEvents);

  const listeners = transcriptSubscribers.get(launchId);
  if (!listeners?.size) {
    console.log("[recall] buffered transcript event without active subscriber", { launchId });
    return;
  }

  for (const listener of listeners) {
    listener.write(message);
  }
}

function enqueueTranscriptForProcessing(launchId: string, transcriptEvent: TranscriptDataEvent) {
  const fingerprint = getTranscriptFingerprint(transcriptEvent);
  if (isRecentTranscriptReplay(launchId, fingerprint)) {
    console.log("[chat] skipped exact replayed transcript.data event", {
      launchId,
      transcriptId: transcriptEvent.data.transcript.id,
      fingerprint
    });
    return;
  }

  const queue = transcriptProcessingQueues.get(launchId) ?? [];
  queue.push(transcriptEvent);
  transcriptProcessingQueues.set(launchId, queue);
  void flushTranscriptProcessingQueue(launchId);
}

async function flushTranscriptProcessingQueue(launchId: string) {
  if (transcriptProcessingActive.get(launchId)) {
    return;
  }

  transcriptProcessingActive.set(launchId, true);

  try {
    while (true) {
      const queue = transcriptProcessingQueues.get(launchId) ?? [];
      const nextTranscript = queue.shift();
      transcriptProcessingQueues.set(launchId, queue);

      if (!nextTranscript) {
        break;
      }

      const userText = nextTranscript.data.data.words.map((word) => word.text).join(" ").trim();
      if (!userText) {
        console.log("[chat] skipped empty transcript.data event", {
          launchId,
          transcriptId: nextTranscript.data.transcript.id
        });
        continue;
      }

      const conversationId =
        launchConversationIds.get(launchId) ??
        (() => {
          const newConversationId = randomUUID();
          launchConversationIds.set(launchId, newConversationId);
          return newConversationId;
        })();

      const fingerprint = getTranscriptFingerprint(nextTranscript);
      rememberTranscriptFingerprint(launchId, fingerprint);

      const participantName = String(
        nextTranscript.data.data.participant.name ?? nextTranscript.data.data.participant.id
      );
      console.log("[chat] processing finalized transcript", {
        launchId,
        conversationId,
        transcriptId: nextTranscript.data.transcript.id,
        participantName,
        userText
      });

      const chatTurn = await createChatTurn({
        conversationId,
        text: userText
      });

      publishTranscriptEvent(launchId, {
        event: "chat.reply",
        data: {
          userText,
          reply: chatTurn.reply,
          transcriptId: nextTranscript.data.transcript.id,
          participantName
        }
      });
    }
  } catch (error) {
    console.error("[chat] failed to process finalized transcript", { launchId, error });
  } finally {
    transcriptProcessingActive.set(launchId, false);
  }
}

function getTranscriptFingerprint(transcriptEvent: TranscriptDataEvent) {
  const words = transcriptEvent.data.data.words;
  const text = words.map((word) => word.text).join(" ").trim();
  const firstStart = words[0]?.start_timestamp?.relative ?? "na";
  const lastEnd = words.at(-1)?.end_timestamp?.relative ?? "na";
  const participantId = transcriptEvent.data.data.participant.id;

  return `${participantId}:${firstStart}:${lastEnd}:${text}`;
}

function isRecentTranscriptReplay(launchId: string, fingerprint: string) {
  pruneRecentTranscriptFingerprints(launchId);
  const recentFingerprints = recentTranscriptFingerprints.get(launchId);
  return recentFingerprints?.has(fingerprint) ?? false;
}

function rememberTranscriptFingerprint(launchId: string, fingerprint: string) {
  pruneRecentTranscriptFingerprints(launchId);
  const recentFingerprints = recentTranscriptFingerprints.get(launchId) ?? new Map<string, number>();
  recentFingerprints.set(fingerprint, Date.now());
  recentTranscriptFingerprints.set(launchId, recentFingerprints);
}

function pruneRecentTranscriptFingerprints(launchId: string) {
  const recentFingerprints = recentTranscriptFingerprints.get(launchId);
  if (!recentFingerprints) {
    return;
  }

  const cutoff = Date.now() - TRANSCRIPT_FINGERPRINT_TTL_MS;
  for (const [fingerprint, timestamp] of recentFingerprints.entries()) {
    if (timestamp < cutoff) {
      recentFingerprints.delete(fingerprint);
    }
  }

  if (recentFingerprints.size === 0) {
    recentTranscriptFingerprints.delete(launchId);
  }
}

function json(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown
) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}
