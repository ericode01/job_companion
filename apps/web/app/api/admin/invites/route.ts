import { appOrigin, createInvite, listInvites } from "@jd/core";
import { z } from "zod";
import { json, readJson, withAdmin } from "@/lib/api";

export function GET(req: Request) {
  return withAdmin(req, () =>
    json(
      listInvites().map(({ tokenHash: _t, ...i }) => ({
        ...i,
        state: i.usedAt ? "used" : i.expiresAt.getTime() < Date.now() ? "expired" : "open",
      })),
    ),
  );
}

const Body = z.object({
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email, or leave it blank.")]).optional(),
  role: z.enum(["admin", "member"]).default("member"),
});

/** The link is returned once; only its hash is stored. */
export function POST(req: Request) {
  return withAdmin(req, async (me) => {
    const { email, role } = Body.parse(await readJson(req));
    const { token, invite } = createInvite(me.id, { email: email || null, role });
    return json({ url: `${appOrigin()}/invite/${token}`, invite: { ...invite, tokenHash: undefined } });
  });
}
