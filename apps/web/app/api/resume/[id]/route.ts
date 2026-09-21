import { ResumeSourceSchema } from "@jd/core";
import { ownedResume, rerenderResume, updateResumeSource } from "@jd/research";
import { json, notFound, readJson, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export function PUT(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const id = Number((await params).id);
    if (!await ownedResume(user.id, id)) return notFound();
    const saved = await updateResumeSource(id, ResumeSourceSchema.parse(await readJson(req)));
    // Tailored resumes are generated files: keep the PDF in step with your edits.
    await rerenderResume(id);
    return json(saved);
  });
}
