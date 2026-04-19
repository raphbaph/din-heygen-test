import { z } from "zod";
import { env } from "./config/env.js";

const AnthropicResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional()
    })
  )
});

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type GenerateChatReplyInput = {
  systemPrompt: string;
  messages: ChatMessage[];
};

export async function generateChatReply(input: GenerateChatReplyInput) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    console.log("[anthropic] request", {
      model: env.ANTHROPIC_MODEL,
      messageCount: input.messages.length,
      latestUserMessage: input.messages[input.messages.length - 1]?.content ?? null
    });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": env.ANTHROPIC_API_KEY
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL,
        system: input.systemPrompt,
        max_tokens: 120,
        temperature: 0.2,
        messages: input.messages.map((message) => ({
          role: message.role,
          content: message.content
        }))
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Anthropic request failed: ${await response.text()}`);
    }

    const payload = AnthropicResponseSchema.parse(await response.json());
    const reply = payload.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text?.trim() ?? "")
      .filter(Boolean)
      .join(" ");

    if (!reply) {
      throw new Error("Anthropic returned no text content.");
    }

    console.log("[anthropic] response", {
      reply
    });

    return normalizeReply(reply);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeReply(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
