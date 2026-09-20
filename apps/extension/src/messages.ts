import type { FormQuestion, QuestionAnswer } from "@jd/core/shared";
import type { ApplyPacket } from "@jd/apply/packet-types";

declare global {
  const __VERSION__: string;
  const __APP_ORIGINS__: string[];
}

export type Msg =
  | { type: "pair"; token: string }
  | { type: "open-application"; applicationId: number; url: string }
  | { type: "status" }
  | { type: "get-application" }
  | { type: "match"; url: string }
  | { type: "packet"; applicationId: number }
  | { type: "answers"; applicationId: number; questions: FormQuestion[] }
  | { type: "save-answer"; applicationId: number; question: string; answer: string; category: QuestionAnswer["category"]; scope: "global" | "job" }
  | { type: "submitted"; applicationId: number; answers: { label: string; value: string | string[] | null; source: string }[] };

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

export interface StatusInfo {
  paired: boolean;
  appReachable: boolean;
}

export type { ApplyPacket, FormQuestion, QuestionAnswer };

/** Sends a message to the background worker and unwraps the reply. */
export async function send<T>(msg: Msg): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(msg)) as Reply<T> | undefined;
  if (!reply) throw new Error("Extension background is not responding. Reload the page.");
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
