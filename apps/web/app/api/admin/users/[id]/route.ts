import crypto from "node:crypto";
import { activeAdminCount, getUser, resetPassword, updateUser } from "@jd/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { json, notFound, readJson, withAdmin } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

const Patch = z.union([
  z.object({ role: z.enum(["admin", "member"]) }),
  z.object({ disabled: z.boolean() }),
  z.object({ resetPassword: z.literal(true) }),
]);

export function PATCH(req: Request, { params }: Ctx) {
  return withAdmin(req, async (me) => {
    const id = Number((await params).id);
    const target = getUser(id);
    if (!target) return notFound();
    const body = Patch.parse(await readJson(req));

    if ("resetPassword" in body) {
      // Shown once to the admin, who passes it on; the person changes it under Account.
      const temporary = crypto.randomBytes(12).toString("base64url");
      await resetPassword(id, temporary);
      return json({ temporaryPassword: temporary });
    }
    const losesAdmin = ("role" in body && body.role === "member") || ("disabled" in body && body.disabled);
    if (losesAdmin && target.role === "admin" && !target.disabled && activeAdminCount() <= 1) {
      return NextResponse.json({ error: "There must be at least one active admin." }, { status: 409 });
    }
    if ("disabled" in body && body.disabled && id === me.id) {
      return NextResponse.json({ error: "You can't disable your own account." }, { status: 409 });
    }
    updateUser(id, body);
    return json({ ok: true });
  });
}
