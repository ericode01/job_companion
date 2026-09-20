import { resolveQuestions } from "@jd/apply";
import { z } from "zod";
import { extensionJson, extensionPreflight, withExtension } from "@/lib/api";

export const OPTIONS = extensionPreflight;

const Body = z.object({
  applicationId: z.number().int(),
  questions: z
    .array(
      z.object({
        index: z.number().int(),
        label: z.string().max(2000),
        kind: z.enum(["text", "textarea", "select", "multiselect", "radio", "checkbox", "boolean", "file", "number", "date"]),
        required: z.boolean(),
        options: z.array(z.string().max(500)).max(300),
        description: z.string().max(4000).nullable().optional(),
      }),
    )
    .max(150),
});

export function POST(req: Request) {
  return withExtension(req, async (userId) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return extensionJson(req, { error: "Invalid request" }, { status: 400 });
    return extensionJson(req, await resolveQuestions(userId, parsed.data.applicationId, parsed.data.questions));
  });
}
