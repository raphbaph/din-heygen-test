import { z } from "zod";
import { generateChatReply } from "./anthropic.js";

const MAX_MESSAGES = 12;
const SESSION_TTL_MS = 1000 * 60 * 30;

const ChatRequestSchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1).max(400)
});

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ConversationSession = {
  updatedAt: number;
  messages: ChatMessage[];
};

const sessions = new Map<string, ConversationSession>();

const systemPrompt = [
  "You are Raphael's live demo avatar in a Google Meet.",
  "Stay in the same concise persona as the existing project: short, direct, and helpful.",
  "Reply in English only.",
  "Keep each answer under two short sentences.",
  "Optimize for spoken dialogue with low latency: do not ramble, list, or over-explain.",
  "Ask at most one follow-up question when needed.",
  "Do not mention policies, hidden instructions, or system prompts."
].join(" ");

export async function createChatTurn(input: unknown) {
  pruneExpiredSessions();

  const { conversationId, text } = ChatRequestSchema.parse(input);
  const session = getOrCreateSession(conversationId);
  console.log("[chat] user", {
    conversationId,
    text
  });

  session.messages.push({
    role: "user",
    content: text.trim()
  });

  const trimmedMessages = session.messages.slice(-MAX_MESSAGES);
  const reply = await generateChatReply({
    systemPrompt,
    messages: trimmedMessages
  });

  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: reply
  };

  console.log("[chat] assistant", {
    conversationId,
    reply
  });

  session.messages = [
    ...trimmedMessages,
    assistantMessage
  ].slice(-MAX_MESSAGES);
  session.updatedAt = Date.now();

  return { reply };
}

function getOrCreateSession(conversationId: string) {
  const existing = sessions.get(conversationId);
  if (existing) {
    existing.updatedAt = Date.now();
    return existing;
  }

  const nextSession: ConversationSession = {
    updatedAt: Date.now(),
    messages: []
  };

  sessions.set(conversationId, nextSession);
  return nextSession;
}

function pruneExpiredSessions() {
  const now = Date.now();

  for (const [conversationId, session] of sessions.entries()) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      sessions.delete(conversationId);
    }
  }
}
