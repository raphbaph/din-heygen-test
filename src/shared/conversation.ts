export type TranscriptEntry = {
  id: string;
  speaker: "avatar" | "user" | "system";
  text: string;
};

export type ConversationStage =
  | "intro"
  | "waiting_for_interest"
  | "asked_goal"
  | "done";

export type ConversationState = {
  stage: ConversationStage;
};

export const initialConversationState: ConversationState = {
  stage: "intro"
};

export function getIntroLine() {
  return "Hi Raphael. I'm your test avatar in this Google Meet. Are you interested in trying a quick demo today?";
}

export function getNextReply(
  state: ConversationState,
  userText: string
): { nextState: ConversationState; reply: string } | null {
  const normalized = userText.toLowerCase();

  if (state.stage === "intro" || state.stage === "waiting_for_interest") {
    if (includesAny(normalized, ["yes", "sure", "okay", "ok", "let's", "demo"])) {
      return {
        nextState: { stage: "asked_goal" },
        reply: "Great. What should I help you test next: sales, support, or onboarding?"
      };
    }

    if (includesAny(normalized, ["no", "not now", "later"])) {
      return {
        nextState: { stage: "done" },
        reply: "No problem. This confirms I can join the meeting and respond to you."
      };
    }

    return {
      nextState: { stage: "waiting_for_interest" },
      reply: "I only need a short answer. Say yes if you want to keep going, or no if you want to stop."
    };
  }

  if (state.stage === "asked_goal") {
    if (includesAny(normalized, ["sales"])) {
      return {
        nextState: { stage: "done" },
        reply: "Sales demo selected. I would qualify the lead, ask budget and timeline, and then hand off to a human."
      };
    }

    if (includesAny(normalized, ["support"])) {
      return {
        nextState: { stage: "done" },
        reply: "Support demo selected. I would collect the issue, confirm urgency, and suggest the next troubleshooting step."
      };
    }

    if (includesAny(normalized, ["onboarding"])) {
      return {
        nextState: { stage: "done" },
        reply: "Onboarding demo selected. I would welcome the user, explain the first steps, and check where they get blocked."
      };
    }

    return {
      nextState: { stage: "asked_goal" },
      reply: "I heard you, but for this simple demo please say sales, support, or onboarding."
    };
  }

  return null;
}

function includesAny(text: string, candidates: string[]) {
  return candidates.some((candidate) => text.includes(candidate));
}
