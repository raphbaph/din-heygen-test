import { z } from "zod";
import { env } from "./config/env.js";

const LaunchBotBodySchema = z.object({
  meetingUrl: z.string().url()
});

export async function launchRecallBot(input: unknown) {
  const { meetingUrl } = LaunchBotBodySchema.parse(input);

  const response = await fetch(
    `https://${env.RECALL_REGION}.recall.ai/api/v1/bot/`,
    {
      method: "POST",
      headers: {
        Authorization: env.RECALL_API_KEY,
        "Content-Type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        output_media: {
          camera: {
            kind: "webpage",
            config: {
              url: `${env.PUBLIC_APP_URL}?output=1`
            }
          }
        },
        recording_config: {
          transcript: {
            provider: {
              recallai_streaming: {
                mode: "prioritize_low_latency",
                language_code: "en"
              }
            }
          },
          include_bot_in_recording: {
            audio: true
          }
        },
        variant: {
          google_meet: "web_4_core"
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Recall bot launch failed: ${await response.text()}`);
  }

  return response.json();
}
