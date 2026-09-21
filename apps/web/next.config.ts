import type { NextConfig } from "next";

const config: NextConfig = {
  // Lets a second dev server (e.g. a test instance on another DATA_DIR) run beside the main one.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["pg", "@google-cloud/storage", "unpdf", "imapflow", "mailparser"],
  transpilePackages: ["@jd/core", "@jd/sources", "@jd/llm", "@jd/research", "@jd/apply", "@jd/mail"],
};

export default config;
