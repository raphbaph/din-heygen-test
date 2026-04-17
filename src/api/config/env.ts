import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

export const env = z
  .object({
    HEYGEN_AVATAR_API_KEY: z.string().min(1),
    HEYGEN_AVATAR_ID: z.string().min(1),
    HEYGEN_AVATAR_VOICE_ID: z.string().min(1),
    HEYGEN_AVATAR_CONTEXT_ID: z.string().min(1),
    RECALL_API_KEY: z.string().min(1),
    RECALL_REGION: z.string().min(1),
    PUBLIC_APP_URL: z.string().url()
  })
  .parse(process.env);
