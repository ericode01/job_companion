# Job Discovery & Apply Assistant: Design

Status: v8 (2026-09-19). M0–M5 are built, plus the accounts/dashboards redesign (§19) and mailbox sync (§20). Implementation notes are in §15–20.

## 1. Goals and decisions so far

| # | Goal | Decision |
|---|------|----------|
| 1 | Find tech job openings from a query like "staff software engineer in NYC" | Pull directly from ATS public job-board APIs (Greenhouse, Lever, Ashby, Workday, SmartRecruiters). Start from a bundled list of companies and grow it from company websites and web search. |
| 2 | Show detailed info about each company and job | Claude researches the company: overview, product, funding, size and stage. Results are cached per company and cite their sources. |
| 3 | Apply in close to one click | A Chrome extension prefills the ATS form and tailors the answers. **You always click Submit yourself.** |
| - | Form factor | A web app (Next.js) plus a Chrome extension (MV3). Runs locally or hosted (§19) |
| - | Stack | TypeScript everywhere, Claude API, Postgres (SQLite until v11, §24), pnpm monorepo |
| - | Runtime | Local only in v1–M5; since v7, hostable for several people with accounts (§19) |
| - | Location matching | Remote-US roles count as a match for a city search by default. You can turn this off for a single search or globally in Settings. |
| - | Resume | One master resume. For any job, you can **tailor a resume** as an option (§6.4). |
| - | Standing answers | Authorized to work in the US, no sponsorship needed. These are managed in **Settings → Answers**, and recurring questions the tool hasn't seen before are added there automatically (§6.5). |
| - | Cover letter | The tool **asks you each time** you click Apply (§6.1). |
| - | Notifications | Email digest of new matches (§9), led by emails that need a reply (§20) |
| - | Pipeline from email | Each person can connect their mailbox **read-only**; application, interview, rejection and offer emails update the pipeline (§20) |
| - | Limits and preferences | All adjustable in one **Settings** page (§8) |

Out of scope for v1: LinkedIn/Indeed scraping, submitting applications automatically, cloud hosting, and multiple users.

## 2. Architecture

```
┌──────────────────────── your Mac ────────────────────────────────┐
│                                                                  │
│  Chrome (your real, logged-in browser)                           │
│  ┌──────────────────────────────┐                                │
│  │ Extension (MV3)              │  fetch localhost:4317          │
│  │  • ATS detector              │◄──────────────┐                │
│  │  • Form filler (per ATS)     │               │                │
│  │  • Side panel: review + gaps │               │                │
│  └──────────────────────────────┘               │                │
│                                                 ▼                │
│  ┌──────────────────── apps/web (Next.js) ──────────────────┐    │
│  │ UI: Search · Results · Job detail · Pipeline · Profile   │    │
│  │ API routes: /jobs /companies /apply/prefill /profile     │    │
│  └────────┬─────────────────┬──────────────────┬────────────┘    │
│           │                 │                  │                 │
│   packages/sources   packages/research   packages/apply          │
│   (ATS adapters,     (Claude + web       (field mapping,         │
│    discovery)         search, cache)      answer bank, tailoring)│
│           │                 │                  │                 │
│           └────────── packages/core ───────────┘                 │
│               (types, Drizzle schema, Postgres, job queue)       │
│              Cloud SQL + a GCS bucket (local: docker, data/)     │
└───────────────────────────────┬──────────────────────────────────┘
                                │ HTTPS
          ATS public APIs ◄─────┴─────► Claude API (web_search / web_fetch tools)
```

### Repo layout

```
apps/
  web/          Next.js (App Router) UI + API routes + background worker entry
  extension/    Chrome MV3 extension (WXT framework), React side panel
packages/
  core/         zod types, Drizzle schema + migrations, config, logger
  sources/      ATS adapters, company registry, discovery, normalization
  research/     company enrichment (Claude + tools), fit scoring
  apply/        form field model, answer bank, cover letter / answer tailoring
  llm/          thin Claude client: model routing, structured output, token/cost ledger
data/           (gitignored) local file store (resumes, research notes) when GCS_BUCKET is unset
```

The worker runs in-process with the Next.js server, using a simple database-backed job queue. That way there is no Redis and everything starts with `pnpm dev`. A macOS `launchd` job can run `pnpm refresh` once a day.

## 3. Data model (Postgres via Drizzle; SQLite until v11)

```
profile          (single row) name, email, phone, location, links{linkedin,github,site}
resume           id, kind(master|tailored), base_resume_id, job_id?, file_path(pdf),
                 source_json (structured sections), parsed_text, change_log_json,
                 status(draft|approved), created_at
settings         key, value_json, updated_at        -- the whole Settings page (§8)
company          id, name, domain, ats_type, ats_slug, source(seed|discovered|manual),
                 watch(bool), last_crawled_at, crawl_status
company_profile  company_id, overview, products[], customers, business_model,
                 competitors[], founded, hq, headcount_range, stage, total_funding,
                 last_round{type,amount,date}, investors[], sources[{url,claim}],
                 confidence, model, enriched_at
job              id, company_id, ats_type, external_id, url, apply_url, title,
                 title_normalized, level(senior|staff|principal|…), function,
                 locations[], location_type(onsite|hybrid|remote), comp{min,max,currency},
                 description_html, description_text, posted_at, first_seen_at,
                 last_seen_at, closed_at, content_hash
                 UNIQUE(ats_type, company_id, external_id)
saved_search     id, raw_query, parsed_filter_json, notify(bool), last_run_at
job_match        job_id, search_id, rule_pass(bool), fit_score(0-100),
                 fit_reasons_json, gaps_json, model, scored_at
application      id, job_id, status(saved|prefilled|submitted|interview|offer|rejected|withdrawn),
                 resume_id, cover_letter_choice(yes|no), cover_letter, answers_json,
                 submitted_at, notes
answer_bank      id, category(work_auth|sponsorship|relocation|salary|eeo|logistics|custom),
                 question_canonical, question_variants[], answer_type(text|choice|boolean),
                 answer, scope(global|per_job_draft), approved(bool), use_count, last_used_at
question_inbox   id, question_text, field_type, options[], seen_count, first_job_id,
                 suggested_answer, status(pending|answered|ignored)
digest_run       id, sent_at, job_ids[], status, error
llm_usage        ts, purpose, model, input_tokens, output_tokens, cached_tokens
```

## 4. Goal 1: Discovery

### 4.1 Pipeline

```
"staff software engineer in NYC"
      │ 1. Parse query (Claude Haiku, structured output)
      ▼
Filter { titles: ["staff software engineer","staff engineer","staff backend engineer",…],
         levels: [staff], exclude: [manager, "engineering manager"],
         locations: [{city:"New York", radius:"metro"}], include_remote_us: true,  // default from Settings
         posted_within_days: 30 }
      │ 2. Crawl (incremental, only stale companies)
      ▼
ATS adapters → normalized Job rows (upsert, content_hash, mark closed when missing)
      │ 3. Rule prefilter (cheap, local)
      ▼   title regex/synonyms, level, location normalization (NYC aliases,
      │   "New York, NY", "Remote - US" …), recency
      │ 4. LLM fit scoring (only for rule-passing jobs not yet scored)
      ▼   Haiku: JD + resume summary → score, reasons, gaps
Results list, sorted by fit score and recency
```

You can edit the parsed filter in the UI before running the search. The LLM only proposes the filter.

### 4.2 ATS adapters (`packages/sources`)

A common interface:

```ts
interface AtsAdapter {
  type: 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'smartrecruiters';
  detect(url: string): { slug: string } | null;       // for discovery + extension
  verify(slug: string): Promise<boolean>;             // does the board exist?
  listJobs(slug: string): Promise<RawJob[]>;
  normalize(raw: RawJob, company: Company): Job;
}
```

| ATS | Public endpoint | Phase |
|-----|-----------------|-------|
| Greenhouse | `GET boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` | MVP |
| Lever | `GET api.lever.co/v0/postings/{slug}?mode=json` | MVP |
| Ashby | `GET api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` | MVP |
| SmartRecruiters | `GET api.smartrecruiters.com/v1/companies/{slug}/postings` | P2 |
| Workday | `POST {tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` (undocumented, paginated) | P2 |

Crawler rules:
- At most 8 concurrent requests, with at most 4 per host (both adjustable in Settings → Sources), and jittered backoff on 429/5xx. A full crawl of ~250 companies takes about a minute.
- A company is recrawled only if its data is older than 12 hours. Companies on your watchlist refresh first.
- Raw payloads are stored gzipped for debugging and replay.
- A job that disappears from its board gets `closed_at` set and is hidden, not deleted.

### 4.3 Company registry: seed list plus automatic growth

1. **Seed.** A bundled `seed-companies.json` of about 2–5k tech companies with `{name, domain, ats_type, ats_slug}`. It is built once by a script that uses web search and then checks every slug with `verify()`. It is checked into the repo and refreshed now and then.
2. **Manual.** You can paste a careers URL or a company name. `detect()` or a web search finds the ATS and slug.
3. **Automatic growth.** When a search runs, a discovery job calls Claude with the `web_search` tool using queries such as `site:job-boards.greenhouse.io "staff" "New York"` and the same for `jobs.lever.co` and `jobs.ashbyhq.com`. It then pulls ATS URLs from the results and verifies them. New companies are added with `source=discovered`.
4. **Company sites that embed their ATS.** Some companies host jobs on their own domain. A fetch-and-sniff step looks for `greenhouse.io/embed`, `lever.co`, or `ashbyhq.com` in the page HTML.

## 5. Goal 2: Company and job detail

### 5.1 Enrichment (`packages/research`)

- This runs when a job first reaches the results list or you open a company page. It runs at most once per company every 30 days unless you force a refresh.
- It calls Claude Sonnet with the `web_search` and `web_fetch` tools and a strict JSON schema (the `company_profile` table).
- Prompt rules: **every factual claim needs a source URL**. Use `null` instead of guessing. Report `confidence` for funding and headcount.
- Suggested source order: the company website (home, about, product, pricing, customers), then its press or newsroom, then Wikipedia, then recent funding news, then SEC filings (EDGAR) for public companies.
- Funding, size, and stage come from free public sources only. A paid provider (Crunchbase or similar) can plug in later through a `FundingProvider` interface.

### 5.2 Job-level analysis

- **Pulled out of the job description (Haiku):** level, team, tech stack mentioned, must-have vs. nice-to-have requirements, comp (if the ATS didn't provide it), onsite or hybrid policy, visa language.
- **Fit (Haiku, or Sonnet when you ask for it):** a 0–100 score, the top matching experience cited from your resume, gaps, and suggested talking points.

### 5.3 Job detail screen

```
┌ Staff Software Engineer, Payments · Acme ─────────── [Save] [Apply ▸] ┐
│ NYC · Hybrid 3d · $230–280k · posted 4d ago · Greenhouse              │
├─────────────────────────────┬─────────────────────────────────────────┤
│ Fit 82  ✓ distributed sys   │ Acme                                    │
│         ✓ payments domain   │ Overview · Products · Customers         │
│         △ no Kotlin         │ Series C · $120M total · 200–500 people │
│ Requirements (parsed)       │ Investors: …        [sources ↗]         │
│ Job description (full)      │ Other open roles matching your search   │
└─────────────────────────────┴─────────────────────────────────────────┘
```

## 6. Goal 3: Near one-click apply

### 6.1 Flow

```
[Apply ▸] in web app
   │ 0. Apply dialog asks two things:
   │      Resume:       (•) Master   ( ) Tailor for this job   ( ) Use existing tailored version
   │      Cover letter: ( ) Yes, write one   ( ) No     ← marked "required by this form" when the ATS says so
   │    If you chose to tailor, the resume goes through §6.4 and you approve it before continuing
   │ 1. Server builds an ApplyPacket: profile, chosen resume, cover letter (if Yes),
   │    and drafts for known custom questions (from the ATS API when it exposes them: Greenhouse
   │    `questions`, Ashby form definition)
   │ 2. Opens apply_url in a new tab with #jda=<packetId>
   ▼
Extension content script (on greenhouse / lever / ashby domains or embedded iframes)
   │ 3. Detect ATS → load per-ATS field map → GET /apply/prefill/<packetId>
   │ 4. Fill standard fields (name, email, phone, links, location)
   │    Upload resume via DataTransfer on <input type=file>
   │ 5. Custom questions: answer_bank match → else LLM draft (marked "needs review")
   │    EEO / demographic: your saved answers (default "decline to self-identify")
   │    Work auth / sponsorship: from Settings → Answers (authorized, no sponsorship)
   │    Unrecognized question → queued in question_inbox (§6.5)
   │ 6. Side panel shows ✓ filled, ⚠ needs review, ✗ couldn't fill
   ▼
YOU review and click Submit
   │ 7. Extension detects confirmation page / success XHR → POST /applications/<id>/submitted
   │ 8. Answers you edited are saved back to answer_bank for next time
```

**Why the extension, and not Playwright or ATS APIs:** the Greenhouse and Lever application POST APIs need the *employer's* API key. A headless browser trips bot detection and CAPTCHAs. The extension runs in your real browser session, so you stay in control and nothing gets blocked.

### 6.2 Field filling strategy

1. **Deterministic mapping per ATS.** Known selectors for standard fields cover about 80% of the work and are fast and reliable.
2. **Heuristic matching.** For unknown fields, match on label text, `name`/`id`, and `autocomplete` attributes.
3. **LLM fallback.** Send the serialized form (labels, types, options) plus the ApplyPacket to Haiku and get back `{fieldId: value, confidence}`. Anything below the threshold is left blank and flagged.
4. Use native setters and dispatch `input` and `change` events, so React- and Vue-controlled inputs register the values.

### 6.3 Guardrails
- The extension **never** clicks Submit and never programmatically fires a form submit.
- Free-text answers written by the LLM are always flagged for review the first time. Once you approve an answer, it's reused automatically.
- The extension only runs on an allowlist of ATS host patterns. It pairs with the local server using a one-time token shown in the web app.

### 6.4 Tailored resume (optional, per job)

```
master resume (source_json) + job's parsed requirements + fit gaps
      │ Claude Sonnet, structured output
      ▼
tailored source_json: reordered bullets, reworded to match the job's terms,
                      summary rewritten, skills re-ranked
      │ render: React-PDF template (one template, same look as your master)
      ▼
Review screen: side-by-side diff (master vs tailored) + change_log
      [Edit] [Regenerate] [Approve]  → resume row kind=tailored, linked to the job
```

- **Truthfulness rule:** tailoring can only reorder, trim, or reword content that is already in your master resume. It cannot invent employers, titles, dates, metrics, or skills. A validation pass compares every tailored bullet to its source bullet and flags anything without a match.
- When you upload your master resume (PDF), the tool pulls out its text with `pdfjs-dist`, and Claude turns that text into `source_json` once. You correct the result in the UI, and that structured version is what gets tailored.
- The PDF template is ATS-friendly: one column, real text, standard headings.

### 6.5 Answers and recurring questions (Settings → Answers)

- **Starting answers:** authorized to work in the US = Yes. Need sponsorship now or in the future = No. EEO = decline to self-identify. You can edit, add, or delete any of these.
- **Asked the first time a form needs them:** relocation and salary expectation start with no answer. The first form that asks goes through the Inbox flow below. The side panel also lets you type the answer on the spot and choose to save it for all jobs or use it for this job only. Salary answers default to this job only, because the right number depends on the role.
- **Matching:** each answer stores the variant wordings it has matched before. A new question is matched with normalized text first and a Haiku similarity check second. A choice answer maps to the closest option on the form (for example "No" → "I will not require sponsorship").
- **New questions:** when the extension finds a question it can't match with confidence, it:
  1. fills a draft (flagged ⚠) so the current application isn't blocked,
  2. adds the question to **question_inbox** and counts how often it appears.
- The Answers page has an **Inbox** tab for these questions. Answer a question once and it moves to the bank. After that, future forms fill it with no review.
- **Job-specific questions** (for example "Why do you want to work at Acme?") are saved as drafts for that job only and are not reused.

## 7. LLM usage (`packages/llm`)

| Task | Model | Notes |
|------|-------|-------|
| Query parsing, JD extraction, fit scoring, form mapping | `claude-haiku-4-5` | High volume, structured output |
| Company research, cover letters, long answers | `claude-sonnet-5` | Tool use (web_search/web_fetch) |

- Prompt caching for the resume and profile block, which is reused on every scoring call.
- Every call is logged to `llm_usage`. Spend is checked against the budget caps set in Settings (§8).
- Fit scoring runs only after the rule prefilter and only once per (job, resume version).

## 8. Settings page

All settings live in one page and are stored in the `settings` table. Each setting is validated by a zod schema with defaults, so a new setting only needs a schema entry and one UI field.

| Section | Settings (defaults) |
|---------|--------------------|
| **Profile** | name, email, phone, location, links |
| **Resume** | master resume upload + structured editor; tailoring template; truthfulness check on/off (on) |
| **Answers** | answer bank + Inbox (§6.5) |
| **Search** | include remote-US for city searches (on); default posting age (30 days); excluded companies; excluded title keywords |
| **Sources** | enabled ATS adapters; refresh interval (12h); auto-grow company list (on) |
| **AI and budget** | model per task; daily and monthly spend caps (unset = no cap); what happens at the cap: *pause background work* (default) or *ask each time*; month-to-date spend chart |
| **Email digest** | on/off; to-address; send time (08:00 local); frequency (daily); minimum fit score (60); sending method (§9) |
| **Extension** | pairing token; ATS host allowlist |

When a cap is reached, background work (crawl scoring, enrichment, digests) pauses, and things you start yourself show a confirmation with the current spend.

## 9. Email digest

- A scheduled worker job runs at the configured time. It collects jobs that were first seen since the last `digest_run`, match any saved search with `notify=true`, and score at or above the minimum fit score.
- **Content:** group by saved search. For each job show title, company, location, pay, fit score, a one-line reason, and links to the job's detail page in the local app and to the original posting. It ends with "N new questions in your Answers inbox" when there are any.
- **Rendering:** React Email template → HTML plus plain text.
- **Sending:** a `Mailer` interface with two implementations. You choose one in Settings:
  - **SMTP with your own mailbox (default).** For example Gmail with an app password. The SMTP password is stored in `.env.local`, not in the DB. The digest is sent from you, to you, which helps it stay out of spam.
  - **Resend API key**: an optional fallback.
- **When the Mac is asleep or off:** `launchd` runs the job when the machine wakes, and the digest covers everything since the last successful run. If nothing is new, no email is sent (configurable).

## 10. Privacy and security
- The resume, profile, and answers live in `data/`, which is gitignored and local.
- Outbound PII goes to whichever model provider each task is set to (§23): Anthropic direct, or a
  provider reached through OpenRouter. Every routed request pins `provider.data_collection: "deny"`,
  so OpenRouter refuses to send it to an endpoint that logs or trains on it. This is documented in settings.
- `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` are stored in `.env.local`.
- The server binds to `127.0.0.1` only. The extension authenticates with a pairing token.

## 11. Delivery plan

| Milestone | Scope | Done when |
|-----------|-------|-----------|
| **M0 Skeleton** (≈2 days) ✅ | Monorepo, Drizzle schema, Next.js shell, Claude client + usage ledger, Settings framework (zod-backed, empty sections) | `pnpm dev` runs, the DB migrates, and the Settings page saves and loads |
| **M1 Discovery MVP** (≈1 wk) ✅ | Greenhouse/Lever/Ashby adapters, 247-company verified starter seed, query parsing (remote-US included), rule filter, results UI | "staff software engineer in NYC" returns real, deduped, live NYC and remote-US jobs |
| **M2 Detail** (≈1 wk) ✅ | Master resume upload and parsing, company enrichment with sources, JD extraction, fit scoring, job detail page, pipeline board | Job page shows a cited company profile and fit analysis against your resume |
| **M3 Apply** (≈1.5 wk) ✅ | Answers page + Inbox (starting answers pre-filled), Apply dialog (resume and cover-letter choice), extension for Greenhouse → Lever → Ashby, side panel, submit detection | Greenhouse application prefilled end to end; you only click Submit; a new question appears in the Inbox |
| **M4 Tailor + Digest** (≈1 wk) ✅ | Tailored resume (diff review, truthfulness check, PDF), email digest (SMTP + Resend), budget caps enforced, daily refresh via launchd | Morning email lists new matches; a tailored PDF is uploaded through the extension |
| **M5 Scale** ✅ | Workday + SmartRecruiters adapters, lazy detail fetch, careers-page ATS detection, web-search company discovery | Pasting a company's website adds it; "Find new companies" adds verified boards on its own |

## 12. Risks
- **Coverage gap:** companies that post only on LinkedIn or use in-house ATSes are missed. This can be reduced later with an optional aggregator API adapter.
- **Workday** endpoints are undocumented and vary by tenant, so they are more fragile.
- **ATS form markup changes** break selectors. Mitigation: the heuristic and LLM fallback, plus per-ATS fixture tests on saved HTML.
- **Location parsing** is messy ("NYC or SF", "Remote (US) / New York office"). Plan to use an LLM to normalize it and cache the results.
- **LLM accuracy** in research claims. Mitigation: mandatory citations, `null` over guessing, and confidence shown in the UI.

- **Tailored resumes** can overstate your experience. Mitigation: the reorder/reword-only rule, the per-bullet validation pass, and required diff approval.
- **Email from a local machine:** Gmail needs 2-step verification and an app password for SMTP. If sending fails, the error shows in Settings and the tool can switch to Resend.
- **PDF parsing:** text from resumes with two columns or heavy design can come out in the wrong order. You review and fix the parsed structure once in the resume editor.

## 13. Decisions log
| Date | Question | Decision |
|------|----------|----------|
| 2026-09-16 | Form factor, apply mode, sources, stack | Local web app + extension; prefill, and you click Submit; ATS APIs; TypeScript + Claude |
| 2026-09-16 | Company list, research depth, runtime | Seed list + automatic growth; overview/product + funding/size/stage; local SQLite |
| 2026-09-16 | Remote roles for city searches | Included by default, with a toggle |
| 2026-09-16 | Resume | Master resume + optional tailored resume per job |
| 2026-09-16 | Standing answers | Authorized to work, no sponsorship; managed in Settings → Answers; new questions go to the Inbox |
| 2026-09-16 | Cover letter | Asked each time you apply |
| 2026-09-16 | Notifications | Email digest |
| 2026-09-16 | Spend limit | Set later in Settings; no cap by default |

| 2026-09-16 | Email sending | Default is SMTP through your own mailbox (Resend kept as an option) |
| 2026-09-16 | Master resume format | PDF |
| 2026-09-16 | Relocation and salary answers | Left empty; the tool asks the first time a form needs them |
| 2026-09-18 | Workday/SmartRecruiters descriptions | Fetched on demand, not at crawl time — a detail request per posting would be thousands per board |
| 2026-09-18 | Trusting discovered companies | The model only proposes names; the board comes from the company's own careers page and must list real jobs before anything is stored |
| 2026-09-18 | Newly supported job board systems | Switched on once for existing installs, recorded in `knownAts` so turning one back off sticks |
| 2026-09-18 | Users | Several people with accounts; hosted over HTTPS; email + password; first account is admin, others by invite (§19) |
| 2026-09-18 | Look and navigation | "AI companion" palette; one dashboard per search behind a header switcher; one combined daily email with a section per dashboard |
| 2026-09-21 | Database and hosting | Postgres on Cloud SQL (private IP) with the app on a GCE VM in the same region; files in a GCS bucket; PGlite for tests, docker-compose Postgres for development (§24) |
| 2026-09-21 | Postgres version | 18, in production and the dev container; tests can run against a real server with `TEST_DATABASE_URL` (§24) |

## 14. Open questions
None right now. New questions will be added here as they come up during the build.

## 15. Implementation notes (M2)

Decisions and measurements made while building, which change or refine the plan above.

- **Worker is a separate process.** `pnpm dev` runs the Next.js app and `scripts/worker.ts` side by side (via `concurrently`). The web app only enqueues rows in the `task` table, and the worker polls every second. Running the worker inside the Next.js dev server went wrong in two ways: it kept running stale code after reloads, and slow streaming calls outlived their callers. Each task has a timeout (research 8 min, others 2–3 min) and up to 3 attempts for rate limits, overload, and timeouts.
- **When AI work runs:** company research runs when you open a job (or click Research). Fit scoring runs in the background for search results, newest 200 per search by default. Both are configurable in Settings → Research and fit.
- **Company research is two steps.**
  1. Sonnet 5 with the *basic* `web_search_20250305` tool and prompt caching writes notes with a URL after every fact.
  2. Haiku 4.5 turns the notes into a flat JSON schema. Code then drops any source URL that Claude didn't actually retrieve.
  - Measured on Ramp: the dynamic-filtering `web_search_20260209` tool used 510k input tokens (~$1.16), because each internal code-execution round re-reads the context. The basic tool plus caching used ~58k (~$0.19). Datadog through the worker cost $0.22 and took 60s.
  - Full page reads (`web_fetch`) are off by default. Each adds roughly $0.10–0.30.
  - Notes are cached on disk for a day, so a failed structuring step doesn't repeat the research.
  - The nested `CompanyProfile` schema was too large for structured outputs ("compiled grammar is too large"), so the model fills a flat `facts[]` list that code maps back.
- **Resume parsing sends the PDF itself to Claude,** which handles two-column layouts. `unpdf` extracts plain text for display and as a fallback. Bullets get stable ids (`e1b1`) for M4 tailoring. Empty profile fields are filled from the resume's contact block.
- **Fit scores are keyed by a hash of the resume's parsed content,** so editing the resume triggers rescoring. The rubric plus resume form a cached system prefix.
- **Remote-only searches:** the filter has a `remoteOnly` flag ("senior backend engineer remote" → remote US roles only). A code check also drops levels the query didn't mention, because Haiku kept adding "sr" to "staff".
- **Application statuses** are `saved | applying | applied | interview | offer | rejected | withdrawn`; the board shows rejected and withdrawn together as Closed.
- **Measured costs so far:**

  | Task | Cost |
  |------|------|
  | Query parse | ~$0.002 |
  | Job analysis | ~$0.003–0.005 |
  | Company research | ~$0.20 |

## 16. Implementation notes (UI refresh + M3)

### UI refresh
The refresh followed data from the ui-ux-pro-max repo. I read its CSVs directly and didn't install or run its CLI or scripts.
- **Direction** (from its *Job Board/Recruitment* and *Productivity Tool* entries):
  - flat + minimal style, borders instead of shadows
  - professional blue for actions, green for success and pay
  - Plus Jakarta Sans
- **Every text/background pair is checked at ≥4.5:1** in both light and dark mode.
- **Accessibility and interaction fixes:**
  - skip link, visible focus rings, `aria-current` in the nav, pointer cursors
  - SVG icons (lucide) instead of text glyphs
  - skeleton placeholders
  - confirmation dialogs before destructive actions
  - errors shown next to the field that caused them
  - results filters kept in the URL
  - reduced motion respected
  - fit badges carry a word as well as a color

### Apply flow
1. **Apply dialog** (job page):
   - Resume: your master resume. Tailoring shows as M4.
   - Cover letter: Yes or No, asked every time. Greenhouse's public questions API tells us whether the form requires one.
   - The generated letter is editable before the tab opens.
2. **Opening the application:** the app posts a message to the extension's bridge script, and the extension opens the tab and remembers which application it belongs to. Without the extension, the tab opens normally.
3. **Content script** (Greenhouse, Lever, Ashby, including embedded iframes):
   1. collects questions
   2. fills profile fields and files locally
   3. opens custom dropdowns to read their options
   4. asks the app to answer the rest
   5. shows a review panel
   - It never submits. It detects the confirmation page and marks the job Applied.

### Answering questions (server, `packages/apply`)
Questions are answered in this order:
1. Exact match against saved answers (normalized wording, including every wording seen before).
2. Rules:
   - consent and acknowledgements, detected from the label or the options, are always left for you
   - demographic questions use your saved "decline" answer, mapped onto each form's wording
   - narrow work-authorization and sponsorship patterns, which skip inverted wordings such as "…without sponsorship?"
3. One Haiku call for the rest: semantic match to a saved answer, drafts for job-specific questions (flagged for review), or null.

Recurring questions nobody has answered go to the **Answers inbox**.

**Grounding check:** every number in a resume-derived answer must appear in your profile or resume. This was added after Haiku invented a ZIP code from a street address.

### Cover letters
- Sonnet writes the letter in the worker, about $0.02–0.07 and 13–20 seconds.
- A second grounding pass looks for numbers and counted phrases ("six years", "200+") that aren't in the resume, company notes, or posting.
  - If it finds any, one correction request asks Claude to rewrite without them.
  - Anything still unsupported is shown as a warning in the dialog.
- The first live letter claimed "six years" (it's about 8), and the correction pass removed it.

### Pairing and security
- The bridge script fetches a token same-origin from `/api/extension/token`, which requires `Sec-Fetch-Site: same-origin`.
- Extension API calls send `x-jd-token`, with CORS allowed only for `chrome-extension://` origins.
- Every API route checks the Host header against DNS rebinding.
- **Settings → Extension → Unpair** rotates the token.

### Tested against live forms (fake data, never submitted)
- **Greenhouse (Toast):** 16 of 18 fields filled; the other 2 (privacy agreement and postal code) were correctly left for you.
  - react-select dropdowns need mousedown + mouseup + click to open.
  - Location pickers are searched as "City, State".
- **Ashby (Ramp):**
  - all profile fields and the resume filled
  - the SMS consent radio group (labeled only "Phone") was left alone
  - the form has no `<form>` element, so its root is found from section containers
  - type-to-search dropdowns are filled by typing
- **Lever:** covered by fixture tests built from real markup (plain HTML form).

## 17. Implementation notes (M4)

### Tailored resumes
- Sonnet returns only what it may change: a rewritten summary, per-role bullets (each with the id of the master bullet it came from), re-ordered skills, and a change list. Everything else is copied from the master, so contact details, education and dates can't drift.
- **Three checks run in code, not in the prompt.** Anything that fails is reverted to your original wording and reported:
  1. a bullet whose `sourceId` isn't in the master resume is dropped
  2. a bullet that adds a number the resume doesn't have is reverted
  3. a bullet that shares under 40% of its words with its source is reverted as drifted
  - Skills not on the master resume are removed, and every role keeps at least one bullet.
- The PDF is rendered with pdf-lib: one column, real text, standard headings, about 2 pages. The extracted text was verified to be readable.
- Cost: about $0.07 and 55 seconds. The first attempt failed because the JSON hit the token limit; the model no longer echoes original text back (the app fills it in), the limit is 16k, and a truncated response now reports what happened.
- The number check ignores bare numbers under 10, which were producing false warnings from phrases like "Tier 0".

### Email digest
- `buildDigest` collects jobs first seen since the last digest, for saved searches you follow (the bell on a results page), ranked by fit and filtered by your minimum score. A job is reported once, even if two searches match it.
- Rendering is table-based HTML with inline styles, plus a plain-text version.
- Sending uses your own mailbox over SMTP (nodemailer) or Resend. Credentials live in `.env.local`, never in the database.
- **Every run is recorded**, including skipped and failed ones, and the window moves forward so the next digest doesn't repeat jobs.
- Settings → Email digest has **Preview in a tab** and **Send now**.

### Scheduling
- The worker refreshes stale boards every 10 minutes while the app runs, queues fit scores for followed searches, and sends the digest once the send time passes (once per day).
- `pnpm refresh` does the same work in one pass for `launchd`; the README has the plist.
- `Settings → Sources → Refresh job boards automatically` turns the in-app timer off.
- "Find new companies automatically" is now off by default and labeled as not built (M5), instead of looking enabled.

## 18. Implementation notes (M5)

### Two more job board systems
- **Workday** is per-tenant, so the stored slug carries everything needed to rebuild a URL: `host/tenant/site`, e.g. `nvidia.wd5.myworkdayjobs.com/nvidia/NVIDIAExternalCareerSite`. Both `{tenant}.wdN.myworkdayjobs.com/{site}` and `wdN.myworkdaysite.com/recruiting/{tenant}/{site}` are detected, along with the `wday/cxs/...` API URL itself.
- Its list endpoint is a POST, returns **20 postings per request whatever limit you ask for**, and stops around offset 2000. Dates come as prose ("Posted 3 Days Ago"), parsed into an approximate date and replaced by the real start date on hydration.
- **SmartRecruiters** pages 100 at a time. An unknown company answers `200` with an empty page rather than 404, so an empty first page is treated as a missing board.
- `Settings → Sources → Most jobs to pull from one board` (default 2000) caps each refresh.

### Descriptions fetched on demand
- Neither board's list endpoint carries the description, and Workday hides multi-site locations behind "5 Locations". Fetching a detail page per posting at crawl time would be thousands of requests per board.
- Those rows are stored with `needs_detail` set, and filled in by `hydrateJobs()`:
  - **before a search runs** — the title, level, exclusion and age rules are applied first on data we already have, so only their survivors cost a request (tens, not thousands), and the location rules run afterwards on real locations
  - **when you open a job**, so the description is there for analysis and fit scoring
- A crawl never overwrites a hydrated row with an empty list payload. A failed detail request leaves the row pending so the next pass retries; a detail page that genuinely has nothing is marked done.

### Finding a company's job board from its website
- `findAtsForSite()` walks `/careers`, `/jobs`, `/company/careers` and friends, pulls every URL out of the HTML (including ones escaped inside JSON), and ranks the ATS boards the page points at by how often it links to them. If a page has none, it follows up to four same-origin "jobs"-looking links one hop further.
- Nothing is trusted until `verifyBoard()` lists real postings from it.
- Measured on the bundled candidate list: **28 of 132 companies** that slug-guessing had missed, including 6 Workday tenants (Zendesk, CrowdStrike, Zillow, Sprinklr, Dataminr, Cityblock Health). The seed list is now 275 companies.
- **The limit is client-rendered careers pages.** Etsy, Rippling, Deel, HubSpot and DraftKings load their listings from JavaScript, so there is nothing to read in the HTML. Those need the board URL pasted in by hand.

### Finding new companies
- Claude searches the web for companies matching a brief — either a saved search (`briefFor()` turns the filter into prose) or text you type — and returns name, domain, reason, source and, if it is sure, a board URL.
- **Every claim is then checked in code.** The company's own careers page is the authority; the model's board URL is only a fallback, and either way the board must list real jobs. Companies already tracked by domain or by board are skipped, not re-added.
- Each candidate's outcome is stored on the run and shown in the UI: added, already tracked, no board found, or couldn't check.
- One run: 8 candidates, 3 added with live boards, 85 seconds, $0.19.
- `Settings → Sources → Look for new companies` runs one a day off your first followed search; it is off by default.

## 19. Redesign: accounts, dashboards, onboarding, admin portal (v7)

### Decisions (2026-09-18)
| Question | Decision |
|----------|----------|
| Who uses it | Several people, each with an account. **Reverses the v1 "single user, local only" scope.** |
| Where it runs | Hosted on a server over HTTPS. Local dev on 127.0.0.1 keeps working. |
| Sign-in | Email + password (scrypt), server-side sessions in the database, httpOnly cookie |
| Sign-up | The first account is the admin and inherits all existing data. Everyone else needs an invite link from the admin portal. |
| Look | "AI companion": neutral surfaces, one indigo accent, green for pay/success, Plus Jakarta Sans |
| Switching searches | One dashboard on screen; a switcher in the header lists the others and "+ New search" |
| Digest | One email per person per day, a section per dashboard; each dashboard's Digest tab turns its section on/off |

### Design system (from ui-ux-pro-max)
- Queried `"job search AI career companion" --design-system`, plus product, style, typography and ux domains.
- Product matches: *Job Board/Recruitment* (Flat + Minimalism, professional blue + success green) and *AI/Chatbot Platform* (AI-Native UI: neutral + single indigo accent, context cards). The chosen direction is the second, keeping the first's flat, border-not-shadow style.
- Typography: the generated pairing (Inter + Playfair Display, "editorial/luxury") doesn't fit a productivity tool; the typography domain's *Friendly SaaS* pairing (Plus Jakarta Sans) is used instead.
- UX rules applied: progress indicator + Back/Skip on onboarding, active-state tabs with deep-linkable URLs, helpful empty states with one action, errors next to fields, 4.5:1 contrast in both themes, visible focus, reduced motion.

### Information architecture
```
Public            /login  /setup (only while there are no accounts)  /invite/[token]
Onboarding        /welcome → search → resume → about you (skippable) → answers → done
Dashboard         /d/[id]            Jobs (default)
                  /d/[id]/digest     this search's section of the daily email
                  /d/[id]/edit       filters, name, archive
                  /searches/new
Shared views      /jobs/[id]?d=…     /companies/[id]
Central (per person, not per search)
                  /pipeline          Saved → Applying → Applied → Interview → Offer (+ Rejected)
                  /profile           contact details, resume, "about you"
                  /answers           common answers + inbox
                  /extension         step-by-step Chrome setup with live status
                  /account           email digest address/time, search defaults, password
Admin portal      /admin             overview: people, jobs, crawl, spend, queue
                  /admin/users       accounts, roles, invites, password resets
                  /admin/companies   company list, add, discovery
                  /admin/sources     job board systems, crawling
                  /admin/ai          models, budget caps (system + per person), research limits, spend
                  /admin/email       mail transport status and a test send
```

### Data: shared vs per person
- **Shared:** companies, jobs, company research, job analysis, crawl runs, system settings. Research is objective and costs money, so one person's research serves everyone.
- **Per person:** profile, resumes, dashboards (saved searches), matches, applications, answers and inbox, digest runs, extension pairing, personal settings.
- Fit scores stay keyed by resume hash: identical resumes produce identical scores, so nothing leaks between people.
- Every existing per-person row gets a nullable `user_id`; `/setup` assigns the orphaned rows to the first (admin) account.
- AI usage records the person it was spent for (via AsyncLocalStorage, so no call site has to pass it). Admin sets system caps and an optional per-person daily cap.

### Security for hosting
- `APP_ORIGIN` (e.g. `https://jobs.example.com`) defines the allowed Host and Origin; dev defaults to `http://127.0.0.1:4317`.
- Session cookie: httpOnly, SameSite=Lax, Secure over HTTPS, 30-day sliding expiry; only a SHA-256 of the token is stored.
- Mutations still require a same-origin `Origin`; login is rate-limited per IP and email.
- Every API route resolves the signed-in person and filters by `user_id`; admin routes also check the role. Resume files are served only to their owner.
- The extension is built against `APP_URL`, pairs per person through the signed-in session, and its token maps back to that person.

### Implementation notes (v7)

**Accounts and data**
- New tables: `user`, `session` (SHA-256 of the cookie token), `invite` (hash of a single-use link, optional email lock, 7-day expiry), `user_setting`, `extension_pairing`. Per-person tables gained `user_id`.
- `/setup` exists only while there are no accounts. The first account becomes admin and inherits the pre-accounts rows, the old single-user search/digest settings, and the mail method.
- The old app saved a search every time it ran, each with its own AI reading of the query. Those repeats are collapsed to one dashboard per query text (the one with email on, else the newest); the rest are archived, not deleted, and can be restored under **Account → Archived searches**. On this install that turned 7 saved searches into 3 dashboards.
- Applications that predate dashboards are assigned to the first dashboard whose matches include the job, else the most recent one. All 19 existing applications landed in a pipeline.
- AI spend is attributed through `runAs(userId)` (AsyncLocalStorage) at the edges — request handlers and worker tasks — so `recordUsage` and the budget check know who the work is for without threading an id through every call. **A cap now stops foreground work too** (the single-user app let clicks through); with several people on one bill that seemed the only safe reading. Admins are exempt from the per-person cap, not the server caps.
- Settings split: `sources`, `ai` (+ per-person daily cap), `research` and `mail` are system settings (admin portal); `search` defaults and `digest` delivery are per person.
- The digest runs per person at their own send time in their own time zone (captured from the browser at sign-up, editable under Account).

**Security (hosted)**
- `APP_ORIGIN` defines the allowed Host and Origin. In production the local dev addresses are rejected (verified: 421).
- Every API route goes through `withUser`/`withAdmin`/`withExtension`, which check host, origin (for mutations), the session or pairing token, the role, and run the handler as that person.
- Sign-in is rate-limited per IP and per email (8 failures per 15 minutes → 429). Passwords are scrypt (N=16384) with the parameters stored in the hash. A failed lookup still hashes, so timing doesn't reveal which emails exist.
- Admins can reset a password (a temporary one, shown once, and the person is signed out everywhere) and disable accounts; there must always be one active admin. There is no email-based "forgot password" yet.
- Verified against a copy of the real database with two accounts: a member gets 403 on admin APIs, 404 on the admin's dashboards, pipeline and resume file, and is redirected away from `/admin`; requests without a session get 401, cross-site mutations 403, a foreign Host header 421, forged sessions and extension tokens 401.

**UI**
- Route groups: `(auth)` for sign-in/setup/invite, `welcome` for onboarding, `(app)` for the signed-in app, `admin` with its own header and navigation.
- The dashboard switcher shows how many jobs are new in your other searches. "New" means first seen since you last opened that dashboard; the Jobs tab keeps its first load's cut-off while it polls, so markers don't vanish mid-visit.
- The companion card ranks: AI unavailable → resume missing or unreadable → unanswered recurring questions → extension not set up → new strong matches (80+) → new matches → applications stuck in "applying" for 2+ days → digest on but this search not in it.
- Onboarding: step 3 is explicitly skippable; step 2 (resume) also offers "I'll add it later" rather than trapping someone without a PDF to hand. Each step leads with three concrete benefits, and only ones the code delivers (an early draft promised that "about you" shapes fit scores; it doesn't, so that line was replaced).
- **Company list and company discovery moved to the admin portal**, since they're shared by everyone and cost money. Company research pages stay available to everyone.
- The app is named "Job Companion" in the UI and the extension.
- Checked at 375 px (no horizontal overflow on any page; the header's Profile/Answers/Extension links move into the account menu), in dark mode, and for console errors. A hydration mismatch from reading the browser's time zone during server render was found and fixed.

**Extension**
- Built per server: `APP_URL` goes into the manifest's permissions, the bridge match patterns and the background script, so a build only ever talks to that one server. Non-localhost addresses must be https.
- The build writes `job-companion-extension.zip`, served to signed-in people at `/api/extension/download`. The setup page walks through unzip → Load unpacked and pings the extension every two seconds; on install the extension injects its bridge into open app tabs, so the page turns green without a reload.
- Pairing is per person: the bridge fetches the signed-in person's token, and extension API calls run as that person.
- **Not done: Chrome Web Store publishing.** Until then, installing needs Developer mode, which is the biggest remaining friction for non-technical people.

**Hosting**
- `Dockerfile` (web + worker via `pnpm serve`, data in a `/data` volume, health check on `/api/health`) and `.dockerignore`. The Docker daemon wasn't running on this machine, so **the image itself hasn't been built**; the production build and `next start` with hosting settings were verified directly.

## 20. Mailbox sync (v8)

Each person can connect their own mailbox, read-only. Job emails keep their pipeline current, applications made elsewhere show up, interview emails are sorted into rounds, and anything that asks for a reply is flagged with a link back to the email.

### Decisions

| Question | Decision |
|---|---|
| How to connect | Gmail through Google sign-in with the `gmail.readonly` scope, so Google enforces read-only. Other providers (iCloud, Fastmail, Yahoo, …) by IMAP with an app password. Outlook/Hotmail are refused: Microsoft no longer accepts app passwords for IMAP. |
| Pipeline layout | Same columns. Applied cards show ✓ Confirmed; Interview cards show round progress; a "Needs your reply" strip sits above the board; Rejected (with Withdrawn) collapses to a count. |
| Alerts | In the app (Pipeline tab and switcher counts, the Next-step card) and a "Needs your reply" section at the top of the daily digest. No instant emails. |
| What's stored | Job emails only: sender, subject, date, a 300-character snippet, and what the email means. No bodies, no attachments. Unrelated emails are kept as ids only, so they're never read twice. |
| Trust | Moves only go forward, a manual move made after an email arrived wins, and an email below the confidence setting (default 0.75), or sorted without AI, waits in "Check these" instead of moving a card. Every automatic move can be undone. |

### How a check works (`packages/mail`)

1. **List**. Gmail: a server-side search (ATS senders, the person's companies, job words in subjects, a few body phrases like "your application"), `newer_than:Nd` the first time and `after:` the last check (with an hour of overlap) afterwards. IMAP: `SEARCH SINCE` then UIDs above the last one seen per folder, reading INBOX plus the archive, or Gmail's All Mail.
2. **Prefilter** (`prefilter.ts`, rules only). Headers plus Gmail's free snippet: ATS domains, companies applied to, job words, replies in tracked threads, LinkedIn "application sent". Job alerts, Job Companion's own digests (`X-Job-Companion` header), your own mail and newsletters are dropped.
3. **Classify** (`classify.ts`). One Haiku call per remaining email, structured output (`EmailClassificationSchema`): kind, interview round, company, title, the matching application, event time, action and deadline, a one-line summary, and confidence. The email is treated as untrusted data. Without an API key a regex classifier runs, and its results always go to review.
4. **Link** (`link.ts`). The same thread → a job-board URL (`matchJobByUrl`, now including Workday and SmartRecruiters) → the classifier's pick when the company agrees → the company by name or sender domain, then the closest title. Ties go to review. No match plus a kind that implies an application → a new application with `source='email'`, linked to a known job only when the title overlap is ≥ 0.75.
5. **Apply** (`status.ts`, `process.ts`). Moves are written through `setStatus()` with an `application_event` row, which gives the history, undo, and the manual-move rule. A later round, an offer or a rejection closes earlier rounds' open actions.
   - **Dates.** `appliedAt` is filled the first time a card reaches a status that implies you applied (`impliesApplied`: Applied, Interview, Offer, or a rejection an email reported, not one you set yourself), so skipping Applied still dates it; an email move uses the email's time. `confirmedAt` comes from a confirmation email, written in the same `setStatus` call as the move. Both are only ever filled from empty, so each event records whether it filled them (`filled_applied_at`, `filled_confirmed_at`) and undo clears exactly those. Migration 0002 backfilled cards that had skipped Applied, from the earlier of the move and the first email about them.

Checks run as `sync_mailbox` tasks: every `intervalMinutes` per mailbox, and right away on connect or "Check now". Up to `maxClassifyPerRun` emails are read per check, with a 7-minute time budget; the cursor only advances after a complete pass, so nothing is skipped. Hitting the AI spend limit pauses the check without losing its place.

Dates come back in the person's time zone: a bare deadline date means the end of that day there.

### Data

- **`mailbox_connection`**: provider, address, status (`active` / `needs_reauth` / `paused` / `error`), the encrypted secret, cursor, look-back and progress. Disconnecting blanks the secret and revokes Google's grant; job emails stay unless deleted too.
- **`email_message`**: one row per job email. Unique on (connection, provider id).
- **`application_event`**: status history (from, to, source `manual`/`extension`/`email`, email, reverted).
- **`application`**: `job_id` is nullable now, plus `company_name`, `job_title`, `job_url`, `source` and `confirmed_at`.
- **Secrets**: AES-256-GCM with `SECRET_KEY`. In development a key file is generated in the data folder; in production the variable is required.

### Safety

- **Read-only**: IMAP folders are opened with EXAMINE, and fetches use BODY.PEEK. The code only ever gets a `ReadOnlyImap` wrapper with no mutating methods, and a test fails if one is called. Gmail grants broader than read-only plus identity are refused.
- **IMAP hosts** people type are resolved and refused if private or loopback, and only ports 993 and 143 are allowed.
- **Rate limits**: connect attempts and "Check now" are rate-limited.
- **Isolation**: all rows are per person. Admins see connection health only (person, provider, domain, status, last error).

### UI

- **`/mailbox`**: benefits, a "What I can and can't do" panel, a look-back picker, Connect Gmail, and an app-password form with per-provider instructions. Once connected: progress, a summary of what was found, Check now / Pause / Disconnect, and "Check these".
- **Pipeline** (`/pipeline`): the Needs-your-reply strip, "Check these", "From your email this week" with undo, card chips (Confirmed, Action needed, Applied elsewhere, rounds, email count), and a collapsible Rejected column (remembered per browser).
- **Application panel** (`?app=` deep link): status, which search, posting links or "Link to a job posting", round tracker, emails grouped by stage with an action box, Open in Gmail / Open in Mail / Reply, "This is wrong", and history with undo.
- **Elsewhere**: the job page shows the same timeline. The header's Pipeline item shows the "to reply" count, the Email tab is now "Digest", onboarding's last step offers to connect the inbox, and Admin → Mailbox sync has the Google setup steps, settings and connection health.

## 21. One pipeline per person (v9)

### Why

The pipeline used to live under each saved search (`/d/:id/pipeline`). A saved search is a
*discovery* filter, though, and after you apply, what matters is who's waiting on a reply and who's
gone quiet — neither has anything to do with which search found the job. Splitting by search meant:

- Overlapping searches ("staff … in NYC" vs "senior … in NYC") made a card's location arbitrary.
- Mailbox sync creates applications from email, so each one had to be *guessed* onto a board by
  `chooseDashboard`; a wrong guess hid the card somewhere you weren't looking.
- Replies, interviews and the funnel were split across boards, and archiving a search hid its
  applications completely (`/d/:id` 404s on `archivedAt`).

### What changed

- **`/pipeline`** holds every application, from any search, including archived ones. It sits in the
  header next to Mailbox with a count of emails needing a reply. `/d/:id/pipeline` redirects to
  `/pipeline?search=:id` (`proxy.ts`), so digest links keep working, and the per-search Pipeline tab
  is gone: a search has Jobs and Digest.
- **The search became a filter and a tag.** Chips above the board (`All`, one per search, archived
  ones marked) scope everything on the page; a text box finds a company or role. Both live in the
  URL (`?search=&q=`) and the chip is remembered per browser. The application panel still moves a
  card to another search — a mis-tagged application is now a wrong label, not a hidden card.
- **Long columns are grouped by how long it's been** (`lib/pipeline-groups.ts`): "Heard back this
  week" / "Waiting 1–3 weeks" / "Silent 3+ weeks" for columns where you're waiting on them, "Added
  this week" / "1–3 weeks old" / "Stalled 3+ weeks" where you're the holdup. Grouping starts at six
  cards; inside a group, cards needing a reply come first, then the most recent activity. Rejected
  stays one compact, collapsed list. Each group header folds its cards away, remembered per browser;
  a folded group that holds a card needing a reply says so on its header, so folding never hides it.
- **Queries lost their `searchId` option** (`openActions`, `reviewQueue`, `emailChangesSince`); rows
  carry `searchId` and the browser filters. `GET /api/pipeline` replaced
  `GET /api/searches/:id/pipeline`; the Next-step card's application steps count all searches.

## 22. UX pass on the whole app (v9.1)

A review of the running app against real data (50 applications, 114 emails, 101 matches) found
thirteen issues, fixed in three batches.

### Trust
- A pipeline move or "Done" the server refused used to revert in silence. Both keep the optimistic
  update, then show a `FeedbackBar` (`components/ui.tsx`) with the reason and a **Retry**; "Done"
  offers **Undo**, which reopens the action.
- Linking by company now needs a close title match (`SURE_TITLE = 0.55` in `packages/mail/src/link.ts`).
  Between 0.3 and 0.55 the email waits in "Check these" instead of joining a card, which stops
  several roles at one company collapsing onto one application. The timeline names an email's own
  role when it differs from the card's.

### Mobile
- `components/BottomNav.tsx` (phones only): Jobs · Pipeline · Answers · Mailbox with counts, above
  the safe area. Previously those destinations hid in the avatar menu with no badge at all.
- The board shows one stage at a time below `md` (segmented picker, remembered per browser), one
  sideways-scrolling row between `md` and `xl`, and the six-column grid at `xl`. The phone page went
  from ~7,900px to ~3,200px.
- Jobs filters fold into a **Filters** button on phones.

### Board and polish
- Empty stages collapse to the same rail the Rejected column uses; at `xl` the grid tracks are
  computed so rails stay narrow.
- `@media (pointer: coarse)` raises `.btn`/`.input`/`select` to 44px, and the card title and avatar
  grew to match.
- **Add application** (`POST /api/pipeline`) tracks something applied to outside the app.
- Money facts are formatted at render (`formatFactValue`), so "1770000000" reads "$1.77B".
- The answers inbox shows how many are left, clamps very long questions, and moves focus to the next
  one after saving.
- Mailbox lists "What changed recently" and uses relative times.
- Appearance control (System · Light · Dark) in the user menu, stamped before paint by a small
  script in `app/layout.tsx`; the dark tokens are defined for both `prefers-color-scheme` and an
  explicit `data-theme`.

Two layout bugs surfaced while testing the sideways row: absolutely positioned `sr-only` spans
escaped the scroller and widened the page (the row is now a containing block), and sticky group
headers sat on the cards inside it (they pin only where the page itself scrolls).

## 23. Choosing a model per job, and paying less for it (v10)

Four days of real use cost **$17.60 over 1,031 calls**, and most of it was frontier-model work on
tasks that don't need one. From `llm_usage`:

| purpose | model | calls | cost | after |
|---|---|---:|---:|---:|
| company_research (+ structuring) | claude-sonnet-5 | 70 | $11.13 | **$2.79** |
| fit_score | claude-haiku-4-5 | 760 | $4.99 | $4.99 |
| email_classify | claude-haiku-4-5 | 114 | $0.48 | **$0.03** |
| job summaries, form answers, searches | claude-haiku-4-5 | 73 | $0.26 | **$0.03** |
| cover letters, tailoring, resume PDFs | claude-sonnet-5 | 14 | $0.74 | $0.74 |
| **total** | | **1,031** | **$17.60** | **$8.58** |

About **−51%**, from a measured per-company research cost and a measured per-email sorting cost, not
from a price list. It is less than the −70% this started out aiming for, and the gap is entirely fit
scoring: the section below explains why that one didn't move.

### The route is part of the model setting

Each `ai.models.*` value is `<route>:<model id exactly as that route spells it>` —
`anthropic:claude-sonnet-5`, `openrouter:deepseek/deepseek-v4-flash`, `openrouter:openrouter/auto`.
`parseModel` splits on the first colon; `forModel` hands back the client and the id to send.

The route needs its own separator because OpenRouter's slug for Claude *is*
`anthropic/claude-sonnet-5`: slashes alone can't distinguish Anthropic direct from Claude routed
through OpenRouter, and both are wanted (the second for its failover). Keeping the model id verbatim
also means nothing is reassembled, so OpenRouter's own router stays spelled `openrouter/auto` even
though `openrouter:openrouter/auto` repeats the word.

A value with no colon means Anthropic direct. That kept every stored settings row working across the
change; `reconcileAiSettings()` then rewrites them to the qualified form once, beside
`reconcileAtsSettings`.

### One SDK, two endpoints

OpenRouter exposes an Anthropic-compatible `POST /api/v1/messages` that accepts everything this app
sends — `system`, `tools`, `stream`, top-level `cache_control`, `output_config.format` and
`.effort`. So the OpenRouter client is the same `@anthropic-ai/sdk` with `baseURL`
`https://openrouter.ai/api` and `authToken`; `messages.parse()`, `zodOutputFormat()`,
`.stream().finalMessage()` and PDF blocks work unchanged.

A `fetch` wrapper (`routingPrefs`) adds the fields the SDK's types don't know about, so no call site
has to care: `provider.data_collection: "deny"` (below), `require_parameters` so the router can't
pick an endpoint that would ignore the JSON schema, `provider.max_price`, the `auto-router` plugin
when the model is the Auto Router, and `temperature: 0` whenever a schema is being filled — open
models default near 1.0, which invents fields.

### What Automatic is for

`openrouter:openrouter/auto` classifies the prompt and picks whatever the community spends most on
for that task type, within a `cost_tier` band. No fee, and it brings its own fallbacks. It is
supported everywhere and is **not the default anywhere**, which was a change of mind during the
work: the plan had it defaulted for query parsing and extraction, and `pnpm probe` disagreed.

Repeating one structured-output call, Auto answered in 3.2s, 14s and 31.8s, against a steady
1.3–1.8s from the pinned model — it lands on a different provider each time. Two separate reasons
rule that out here:

- **Latency.** Query parsing runs while someone waits on the search box, and form answers while they
  wait in the apply dialog. A 30-second search box is not a saving.
- **Comparability.** Fit scores are ranked against each other and `job_fit.model` records which
  model produced each one, so a 72 from one model and a 68 from another mean nothing together.
  Email classification decides which pipeline card moves.

That leaves no purpose in this app that wants a model chosen per request. Auto is still wired up,
tested and selectable — worth having when a genuinely background, one-off task appears.

### Cost is measured, not modelled

`usage.cost` comes back on every OpenRouter response, so routed spend is the real charge, server-tool
fees included. Anthropic doesn't report cost, so `estimateCostUsd` still prices those from
`packages/core/src/model-prices.json` — a committed snapshot of OpenRouter's public catalogue
(`pnpm prices:refresh`; the worker keeps a fresher copy in `data/`). Usage is recorded against the
model that **answered**, not the one requested, because with Automatic those differ and a ledger
that says "openrouter/auto" answers nothing.

The old estimator fell back to *Opus* pricing for any unrecognised model, which would have costed a
$0.06 model at $5 and tripped the daily cap in minutes. It now falls back to the dearest price on
file, deliberately: a cap is a safety device, so an unknown model should stop work early rather than
look free.

### What each purpose actually runs on, and why

Every default below was chosen by running the thing, not by reading a price list. `pnpm probe`
checks whether a model can do the mechanics; `pnpm compare-models` re-runs real work and reports the
drift. Two of the plan's assumptions did not survive that.

| purpose | model | measured |
|---|---|---|
| fit scores | `anthropic:claude-haiku-4-5` | **no cheap model could take it** |
| email sorting | `openrouter:google/gemini-2.5-flash-lite` | 14/15 same verdict as Haiku, 94% cheaper |
| searches, summaries, form answers | `openrouter:google/gemini-2.5-flash-lite` | 27/27 valid structured output across both runs |
| company research | `anthropic:claude-haiku-4-5` | $0.085 a company, down from $0.337 |
| cover letters, tailoring, resume PDFs | `anthropic:claude-sonnet-5` | unchanged; writing quality, and PDFs need a multimodal model |

**Fit scoring was supposed to be the big saving and isn't.** On twelve real postings, DeepSeek V4
Flash drifted 16.4 points from the stored Haiku scores and changed the verdict band on 9 of 11, in
both directions (−32 to +13), with one call failing outright. Gemini Flash Lite drifted 17.7 points
and changed the band on 11 of 12 — every single one upward, clustered on three distinct values, so
the lowest-scored job in the sample tied with the middle of the pack. Qwen3 30B managed three calls
in four minutes before stalling. Scoring is calibrated judgement, and the rubric is calibrated to
Claude; extraction is not the same task. Fit scores stay on Haiku, and its $4.99 stays on the bill.

**Email sorting nearly fooled us.** DeepSeek appeared to agree with Haiku 14 times out of 15 — until
the comparison separated who answered. It had failed to fill the schema 13 of those times, and the
rules-based fallback had quietly got the easy "Thanks for applying" mail right. Its one real answer
read an interview reminder as unrelated. `compare-models --purpose emails` now reports model answers
and rules fallbacks separately, and `classifyEmail` logs when it falls back, because a model that can
never fill the schema otherwise looks like a model that works.

### Company research stays on Anthropic

Not for compatibility — `web_search_20250305` is in OpenRouter's schema and the `pause_turn` loop
exits cleanly for a provider that finishes in one turn. It is because `collectConsultedUrls` learns
which URLs were really retrieved from the search-result blocks and citations, and `restrictSources`
drops every source outside that set. A provider that reports searches differently wouldn't fail; it
would produce a profile where an invented URL is indistinguishable from a retrieved one.
`assertNativeSearch` therefore refuses any other route, and `pnpm probe <model> --search` is the
measurement that would justify lifting it.

Research got cheaper anyway, with settings alone: `maxWebSearches` 5 → 3 (each search's results join
a context every later turn re-reads, so it drives tokens as much as the $0.01 fee),
`refreshAfterDays` 30 → 90, and the research model Sonnet 5 → Haiku 4.5, which supports the same
native search at half the token price. Measured on one re-research: **$0.085 against $0.337**, a 75%
cut with the source checks untouched.

Moving research to Haiku also found a trap. `output_config: { effort: "medium" }` is a thinking
budget Sonnet accepts and Haiku rejects with a 400 — so the switch didn't make research worse, it
stopped it dead. `effortFor()` now sends the parameter only where it is taken, and the test asserts
both halves.

### Privacy

Resumes, inbox contents and profile facts now reach a third party, so every routed request pins
`provider.data_collection: "deny"` — OpenRouter errors rather than routing to an endpoint that logs
or trains. Every model offered in the admin list has zero-data-retention endpoints. §10 is updated.

### Tests can no longer spend money

While this change was in flight, a test mock stopped covering the code under test and the suite made
real, billed API calls. `test/no-network.ts` now replaces `fetch` in every test run, so a stale mock
is a loud failure instead of an invoice.

## 24. Postgres on Cloud SQL (v11)

SQLite in-process tied the web app and the worker to one filesystem: one machine, a disk to back
up, and no second process that could safely claim work. The app now runs on **Postgres** (Cloud SQL,
private IP) with files in a **GCS bucket**, on a GCE VM in the same region. Local development uses
the Postgres in `docker-compose.yml`; tests use PGlite.

### The cost was async, not the schema

The schema translated one-to-one (`timestamp_ms` → `timestamptz`, `json` → `jsonb`, 0/1 → `boolean`,
autoincrement → identity) and the SQLite migrations were replaced by one Postgres baseline. The real
work was that `better-sqlite3` answers synchronously and every Postgres driver doesn't: **169
functions** became async, found by a codemod that rewrote the terminal `.all()/.get()/.run()` calls
and then followed each newly async function to its callers until nothing changed.

`getDb()` stayed synchronous (a pool connects on first query), so only queries gained `await`.
`one()` replaces `.get()` and adds `LIMIT 1`, since `.get()` never read past the first row;
`returned()` is for `INSERT … RETURNING`, which always yields one. Migrations run once at startup —
`initDb()` from the worker and from `instrumentation.ts` — instead of on first query.

### What compiled and was still wrong

Each of these type-checked and passed the existing tests. Each now has a fix and a test that fails
without it:

- **NULL ordering.** SQLite sorts nulls first ascending, Postgres last. `staleCompanies()` orders by
  `lastCrawledAt`, where null means never crawled — a new company would have waited behind every
  other. Now `nulls first`; a company's jobs list gets `nulls last`.
- **Aggregates as strings.** node-postgres returns `count(*)` (bigint) and `numeric` as strings, so
  spend totals and counts need `.mapWith(Number)`.
- **Epoch milliseconds in raw SQL.** One `sql` fragment compared `updated_at` with `Date.now() - …`,
  valid only while times were numbers; it failed the whole dashboard. It's a typed `lt()` now, and a
  scan found no other raw fragment interpolating a value.
- **The task claim.** Selecting the top task then updating it was atomic only because SQLite had one
  writer. `claimTask` locks with `FOR UPDATE SKIP LOCKED`; four processes racing over 200 tasks
  claimed each exactly once.
- **Look, then insert.** Synchronous code couldn't interleave, so "is this task already queued? if
  not, add it" was safe. With awaits in between it isn't: four processes enqueueing the same 100 keys
  left duplicates for 60 of them. A partial unique index on live tasks (`task_live_key_uq`, queued or
  running only) makes it zero; `enqueueTask` inserts with `ON CONFLICT DO NOTHING` and returns
  whichever task won. Other tables already had unique constraints doing this job.
- **Migrating from two processes at once.** The web app and the worker both migrate at startup. On a
  fresh database, or the first start after a new migration, all but one failed ("duplicate key"
  creating the drizzle schema) — three of four, every run — and under `pnpm serve` one failing takes
  both down. `initDb()` now holds an advisory lock on a connection of its own while migrating.
- **A catch that learned to swallow more.** The OpenRouter fetch wrapper caught "not a JSON body" and
  sent the request unchanged. Reading the routing preferences became a query inside that `try`, so a
  database blip would have sent requests without `data_collection: "deny"`. Only the parse is caught
  now; failing to read the preferences fails the request.
- **Async misuse.** `.filter(async …)` is always truthy (every user was due a digest every tick);
  arrays of promises serialized to `[{}]` in two API responses; a Gmail save went unawaited. A
  checker for floating promises, promise conditions and async array callbacks found these.
- **NUL characters.** Postgres refuses U+0000 in text; SQLite stored it. The crawler strips it, so
  one stray byte can't fail a whole board.
- **A connection ending while idle.** When Postgres ends a connection sitting in the pool (a
  restart, a Cloud SQL maintenance window or failover), node-postgres emits `error` on the pool, and
  with no listener Node ends the process: restarting the dev database killed the worker. The pool now
  logs it and opens a fresh connection on the next query. Found while moving to Postgres 18, not
  caused by it.

### Tests run on a driver that behaves like production's

PGlite is the real engine, but its driver is kinder than node-postgres: it turns bigint into numbers
and quietly converts a number bound to a timestamp. Both hid bugs above, so `useTestDb()` configures
PGlite to parse and serialize those types as node-postgres does. The regression tests were each
checked by reverting their fix and watching them fail.

### Moving the data

`pnpm db:copy-sqlite` copies `data/app.db` into an empty, migrated database in one transaction, in
foreign-key order read from the Postgres catalogue, resets every identity sequence, and moves resume
PDFs into the file store (rewriting `resume.file_path` to a storage key). It then reads every row back
and compares it with its SQLite original as a multiset of canonical fingerprints — no dependence on
row order or collation — and confirms each sequence is past its table's highest id.

On this install's data: **26 tables, 37,964 rows, every row identical, in 23s** against Postgres 17, and the same again against 18.
It refuses a non-empty target, and changing one value or deleting one row in the copy is reported as
exactly that. Postgres comes out at **336MB against SQLite's 512MB**: TOAST compresses the job
descriptions that make up nearly all of it.

### Postgres 18

Production runs Postgres 18 (Cloud SQL `POSTGRES_18`), and so does the dev container. Nothing in the
18 release notes touches what the app uses: no triggers, generated columns, `COPY`, full-text search
or jsonb-to-scalar casts; passwords are SCRAM on both. What did change is the Docker image, which
keeps data under `/var/lib/postgresql/18/docker`, so the volume mounts at `/var/lib/postgresql` and
has a new name (a major version can't open the old files anyway).

PGlite embeds Postgres 17, so `useTestDb()` also runs against a real server when `TEST_DATABASE_URL`
is set, each test file in its own database, dropped afterwards. Checked against 18.6: all tests pass
(one more than on PGlite: the dropped-connection test needs a server); the SQLite copy is identical;
four processes migrating at once all succeed; four claiming 200 tasks take each once; four enqueueing
the same 25 keys leave 25 live tasks; the dev data moved from 17 by `pg_dump`/`pg_restore` checksums
identical table by table, and the app's pages render on it.

### Cutover and rollback

Stop the app, snapshot `data/`, run the copy against Cloud SQL with `GCS_BUCKET` set, start the new
image with `DATABASE_URL` and `GCS_BUCKET`. Rollback is the previous image against the untouched
`data/` — true until the first write to Postgres.

### Not in this change

- A `pg_trgm` GIN index on `job.title_normalized`: title search is a leading-wildcard `LIKE`, still a
  full scan. Worth measuring on its own.
- `llm_usage.cost_usd` as `numeric` instead of `double precision`.
- Batching the crawler's per-job upserts; each is now a network round trip rather than a function call.
