import { z } from "zod";
import { env } from "./config/env.js";

const HeyGenSessionResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.object({
    session_id: z.string(),
    session_token: z.string()
  })
});

export async function createHeyGenSession() {
  const response = await fetch("https://api.liveavatar.com/v1/sessions/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": env.HEYGEN_AVATAR_API_KEY
    },
    body: JSON.stringify({
      mode: "FULL",
      avatar_id: env.HEYGEN_AVATAR_ID,
      avatar_persona: {
        voice_id: env.HEYGEN_AVATAR_VOICE_ID,
        context_id: env.HEYGEN_AVATAR_CONTEXT_ID,
        language: "en"
      }
    })
  });

  if (!response.ok) {
    throw new Error(`HeyGen session request failed: ${await response.text()}`);
  }

  return HeyGenSessionResponseSchema.parse(await response.json()).data;
}
