import { revokeInvite } from "@jd/core";
import { json, withAdmin } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export function DELETE(req: Request, { params }: Ctx) {
  return withAdmin(req, async () => {
    revokeInvite(Number((await params).id));
    return json({ ok: true });
  });
}
