import type { Section } from "@/components/SettingsForm";

/**
 * Each value is "<route>:<model>": the route says which provider gets the call, the rest is that
 * provider's own id. Prices are USD per million tokens, in/out, at the cheapest endpoint that
 * doesn't log or train on what we send — which is the only kind this app routes to.
 */
const MODEL_OPTIONS = [
  { value: "openrouter:openrouter/auto", label: "Automatic — OpenRouter picks, cheapest band (slower, varies)" },
  { value: "openrouter:deepseek/deepseek-v4-flash", label: "OpenRouter · DeepSeek V4 Flash — $0.06/$0.14 (text only)" },
  { value: "openrouter:qwen/qwen3-30b-a3b-instruct-2507", label: "OpenRouter · Qwen3 30B — $0.09/$0.30 (text only)" },
  { value: "openrouter:openai/gpt-5-nano", label: "OpenRouter · GPT-5 Nano — $0.05/$0.40" },
  { value: "openrouter:google/gemini-2.5-flash-lite", label: "OpenRouter · Gemini 2.5 Flash Lite — $0.10/$0.40" },
  { value: "openrouter:anthropic/claude-haiku-4.5", label: "OpenRouter · Claude Haiku 4.5 — $1/$5" },
  { value: "anthropic:claude-haiku-4-5", label: "Anthropic · Claude Haiku 4.5 — $1/$5" },
  { value: "anthropic:claude-sonnet-5", label: "Anthropic · Claude Sonnet 5 — $2/$10" },
  { value: "anthropic:claude-opus-5", label: "Anthropic · Claude Opus 5 — $5/$25" },
];

const COST_TIERS = [
  { value: "low", label: "Cheapest 20% of ranked models" },
  { value: "medium", label: "Lower-middle (20–40%)" },
  { value: "high", label: "Upper-middle (40–60%)" },
  { value: "xhigh", label: "Expensive (60–80%)" },
  { value: "max", label: "Best available (80–100%)" },
];

export const SOURCES: Section = {
  key: "sources",
  endpoint: "/api/admin/settings/sources",
  title: "Job boards and refreshing",
  description: "Which job-board systems are crawled and how often. Applies to every search on this server.",
  fields: [
    {
      path: "enabledAts",
      label: "Job board systems",
      type: "multiselect",
      options: [
        { value: "greenhouse", label: "Greenhouse" },
        { value: "lever", label: "Lever" },
        { value: "ashby", label: "Ashby" },
        { value: "workday", label: "Workday" },
        { value: "smartrecruiters", label: "SmartRecruiters" },
      ],
    },
    { path: "refreshIntervalHours", label: "Refresh a company's jobs after (hours)", type: "number" },
    { path: "autoRefresh", label: "Refresh job boards automatically", type: "boolean", hint: "Uses the interval above" },
    { path: "concurrency", label: "Parallel requests", type: "number" },
    { path: "perHostConcurrency", label: "Parallel requests per job board host", type: "number" },
    { path: "maxJobsPerBoard", label: "Most jobs to pull from one board", type: "number", hint: "Large Workday tenants post thousands of roles; this caps each refresh" },
    { path: "autoGrowCompanies", label: "Look for new companies once a day", type: "boolean", hint: "Uses the first followed search. About $0.20 per run" },
    { path: "maxCompaniesPerDiscovery", label: "Companies to consider per company search", type: "number" },
  ],
};

export const AI: Section = {
  key: "ai",
  endpoint: "/api/admin/settings/ai",
  title: "Models and spending limits",
  description:
    "Which model does each job, and the most AI can cost. Anthropic models go straight to Anthropic; the rest go through OpenRouter, which only routes to providers that don't log or train on what we send. Empty limit = no limit. When a limit is reached, AI work stops for everyone it applies to until the next day or month.",
  fields: [
    { path: "dailyCapUsd", label: "Daily limit for the whole server (USD)", type: "nullableNumber" },
    { path: "monthlyCapUsd", label: "Monthly limit for the whole server (USD)", type: "nullableNumber" },
    { path: "perUserDailyCapUsd", label: "Daily limit per person (USD)", type: "nullableNumber", hint: "Admins are exempt; the server limits still apply" },
    { path: "models.queryParse", label: "Reading searches", type: "select", options: MODEL_OPTIONS },
    { path: "models.extraction", label: "Job summaries and form answers", type: "select", options: MODEL_OPTIONS },
    {
      path: "models.fitScore",
      label: "Fit scores",
      type: "select",
      options: MODEL_OPTIONS,
      hint: "Scores are ranked against each other, so pin one model rather than letting Automatic vary it per job",
    },
    {
      path: "models.research",
      label: "Company research and finding companies",
      type: "select",
      options: MODEL_OPTIONS,
      hint: "Must be an Anthropic model: sources are verified against its search results",
    },
    { path: "models.writing", label: "Cover letters and tailored resumes", type: "select", options: MODEL_OPTIONS },
    { path: "models.resumeParse", label: "Reading resume PDFs", type: "select", options: MODEL_OPTIONS, hint: "Needs a model that reads PDFs — not the text-only ones" },
    {
      path: "models.emailClassify",
      label: "Sorting job emails (mailbox sync)",
      type: "select",
      options: MODEL_OPTIONS,
      hint: "Decides which pipeline card moves, so pin one model here too",
    },
    {
      path: "autoRouter.costTier",
      label: "Automatic: which models it may pick",
      type: "select",
      options: COST_TIERS,
      hint: "Only applies where a model above is set to Automatic. It lands on a different provider each time, so replies can take anywhere from 2 to 30 seconds",
    },
    { path: "autoRouter.maxPromptUsd", label: "Automatic: most to pay per million input tokens (USD)", type: "nullableNumber", hint: "Empty = no ceiling" },
    { path: "autoRouter.maxCompletionUsd", label: "Automatic: most to pay per million output tokens (USD)", type: "nullableNumber" },
    { path: "autoRouter.excludedModels", label: "Automatic: never pick these", type: "list", hint: 'Model patterns, e.g. "openai/*"' },
  ],
};

export const RESEARCH: Section = {
  key: "research",
  endpoint: "/api/admin/settings/research",
  title: "Research and fit scoring",
  description: "When company research and fit scoring run. Research is shared: one person's refresh serves everyone.",
  fields: [
    { path: "researchOnOpen", label: "Research a company automatically when someone opens one of its jobs", type: "boolean" },
    { path: "scoreSearchResults", label: "Score fit for search results in the background", type: "boolean" },
    { path: "maxScoredPerSearch", label: "Most jobs scored per search (newest first)", type: "number" },
    { path: "refreshAfterDays", label: "Re-research a company after (days)", type: "number" },
    {
      path: "maxWebSearches",
      label: "Web searches per company research",
      type: "number",
      hint: "$0.01 each, but the real cost is the tokens: every result joins a context the model re-reads on each later turn",
    },
    { path: "maxWebFetches", label: "Full page reads per company research (adds ≈$0.10–0.30 each)", type: "number" },
  ],
};

export const MAIL: Section = {
  key: "mail",
  endpoint: "/api/admin/settings/mail",
  title: "How digests are sent",
  description: "One method for everyone's daily email. Credentials are read from the server environment, never stored here.",
  fields: [
    {
      path: "method",
      label: "Sending method",
      type: "select",
      options: [
        { value: "smtp", label: "SMTP mailbox (SMTP_HOST, SMTP_USER, SMTP_PASS)" },
        { value: "resend", label: "Resend (RESEND_API_KEY)" },
      ],
    },
  ],
};

export const MAIL_SYNC: Section = {
  key: "mailSync",
  endpoint: "/api/admin/settings/mailSync",
  title: "Mailbox sync",
  description:
    "People connect their own inbox, read-only, and job emails update their pipeline. Each email that passes the sender and subject filter is sorted by the model chosen in AI and budget — well under a cent on the cheap ones, about $0.004 on Claude Haiku — charged to that person.",
  fields: [
    { path: "enabled", label: "Let people connect their mailbox", type: "boolean" },
    { path: "allowImap", label: "Allow app-password (IMAP) connections", type: "boolean", hint: "For iCloud, Fastmail, Yahoo and others; Gmail can use Google sign-in instead" },
    { path: "intervalMinutes", label: "Check each mailbox every (minutes)", type: "number" },
    { path: "maxBackfillDays", label: "Furthest look-back people can choose (days)", type: "number" },
    { path: "maxClassifyPerRun", label: "Emails sorted per check", type: "number", hint: "The rest continue at the next check; limits a first look-back's cost per run" },
    {
      path: "autoApplyConfidence",
      label: "Confidence needed to move a card on its own (0 to 1)",
      type: "number",
      hint: "Below this, the email waits in “Check these” for the person to confirm",
    },
  ],
};
