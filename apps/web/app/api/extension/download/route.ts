import fs from "node:fs";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { EXTENSION_ZIP } from "@/lib/extension-file";

/** The extension, built for this server, as a zip to load into Chrome. */
export function GET(req: Request) {
  return withUser(req, () => {
    const file = EXTENSION_ZIP();
    if (!fs.existsSync(file)) {
      return NextResponse.json({ error: "The extension hasn't been built on this server yet. Ask your admin." }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="job-companion-extension.zip"',
        "cache-control": "no-store",
      },
    });
  });
}
