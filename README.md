# Job Companion

An AI companion for a job search, from the first search to the offer: it finds openings on company job boards, researches the companies, scores each job against your resume, writes cover letters and tailored resumes, fills application forms through a Chrome extension, and tracks every application.
Design: [docs/DESIGN.md](docs/DESIGN.md).

**Status:** M0–M5, the v7 redesign (accounts with invites, guided onboarding, one dashboard per job search with Jobs · Digest tabs, central Pipeline / Profile / Answers / Mailbox / Extension pages, a separate admin portal), v8 mailbox sync, and v9's single pipeline. It runs locally for development and is ready to host.

## Run it locally

Requires Node 22+ and pnpm 10+.

```bash
pnpm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY
pnpm setup                   # create the DB, import ~275 companies, pull their open jobs (~1 min)
pnpm dev                     # http://127.0.0.1:4317
```

`pnpm dev` starts the web app and the background worker (company research, fit scores, resume reading, cover letters, job-board refreshes, digests).

**First visit:** the app asks you to create the first account. That account is the admin, and anything already in this install (resume, searches, applications, answers) moves into it. Everyone else joins through invite links from **Admin → People and invites**, and a new person goes through a four-step onboarding: what they're looking for, resume, "about you", and common application questions.

Without an API key, searches are read with built-in rules and the AI features are off.

## Using it

- **Dashboards.** Each job search is a dashboard with two tabs: **Jobs** (matches, marked New since your last visit, with fit scores) and **Digest** (whether this search is in your daily email). Switch or add searches from the switcher next to the logo.
- **Pipeline.** One board for everything you've applied to, whichever search found it: Saved → Applying → Applied → Interview → Offer, with Rejected folded away. Filter it by search or by company, and long columns split by how long you've been waiting ("Silent 3+ weeks").
- **Mailbox.** Connect your inbox, read-only, and job emails keep the pipeline current. Confirmations mark applications ✓ Confirmed; interview emails move cards and are sorted into rounds (recruiter call, screening, assessment, hiring manager, onsite virtual or in person, other); rejections and offers move cards too; applications you made elsewhere are added. Anything asking for a reply appears under **Needs your reply** with its deadline and a link to the email. Emails I'm unsure about wait in **Check these** instead of moving anything, and every automatic move can be undone.
- **Next step.** Every dashboard opens with the single most useful thing to do now — add a resume, answer recurring questions, set up the extension, review new strong matches.
- **Profile, Answers, Mailbox, Extension** are shared by all your searches. **Account** holds your email address, send time, search defaults and password.

### Mailbox sync

Gmail connects with Google sign-in and read-only access, once an admin has set up a Google OAuth client (**Admin → Mailbox sync** lists the steps and the redirect URI; put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local`). Other providers, and Gmail without that setup, connect by IMAP with an app password. Only job emails are kept (sender, subject, date, a short preview); bodies are read by Claude to sort them and never stored. Sorting costs about $0.004 per email that passes the sender and subject filter, charged to that person's AI limit.

### Chrome extension

The **Extension** page walks you through it: download the zip, unzip, load it in `chrome://extensions` (Developer mode → Load unpacked), and the page turns green when Chrome picks it up. The extension fills Greenhouse, Lever and Ashby forms and never presses Submit.

The download is built for one server address. Rebuild it after changing `APP_ORIGIN`:

```bash
APP_URL=https://jobs.example.com pnpm --filter @jd/extension build
```

## Hosting

The app is one Node process for the web app plus one for the worker, with SQLite on disk, so a single small VM with a persistent volume is enough.

1. Set `APP_ORIGIN` to the public https address (see `.env.example`). It controls the allowed Host/Origin, secure cookies, links in emails and invites, the Google sign-in redirect, and the extension build. Also set `SECRET_KEY` (`openssl rand -base64 32`), which encrypts connected mailboxes' credentials.
2. Build and run the container:

   ```bash
   docker build --build-arg APP_ORIGIN=https://jobs.example.com -t job-companion .
   docker run -d --name job-companion -p 127.0.0.1:4317:4317 -v jc-data:/data --env-file .env.production job-companion
   ```

   `.env.production` holds `APP_ORIGIN`, `SECRET_KEY`, `ANTHROPIC_API_KEY`, mail credentials, and optionally `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. The database and uploaded resumes live in the `jc-data` volume; back it up.

3. Put an HTTPS reverse proxy in front. With Caddy, the whole config is:

   ```
   jobs.example.com {
     reverse_proxy 127.0.0.1:4317
   }
   ```

4. Open the site, create the admin account, then invite people.

Without Docker: `pnpm install && pnpm --filter @jd/web build && APP_URL=$APP_ORIGIN pnpm --filter @jd/extension build`, then `HOST=127.0.0.1 PORT=4317 pnpm serve` under a process manager.

To move an existing local install to a server, copy `data/` (the `app.db` file and `files/`) into the volume before the first start.

## Commands

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Web app on 127.0.0.1:4317 + background worker, with hot reload |
| `pnpm serve` | Production: web app (after `pnpm build`) + worker |
| `pnpm worker` | Background worker only |
| `pnpm crawl [--force]` | Refresh job boards (only companies older than the refresh interval unless `--force`) |
| `pnpm digest [--dry-run] [--force] [--user EMAIL]` | Send the digests that are due, or one person's. `--dry-run` writes `data/digest-preview-<id>.html` |
| `pnpm refresh` | One scheduled pass: crawl, score new matches, send due digests |
| `pnpm search "staff software engineer in NYC"` | Run a search from the terminal |
| `pnpm seed` | Import `packages/sources/seed/companies.json` into the DB |
| `pnpm seed:build` | Re-verify `seed/candidates.txt` by guessing Greenhouse/Lever/Ashby slugs |
| `pnpm find-boards [--all] [--dry-run]` | Read each candidate's careers page to find its board — the only way Workday tenants turn up |
| `pnpm test` | Unit tests |
| `pnpm typecheck` | Typecheck all packages and scripts |
| `pnpm db:generate` | Generate a migration after editing `packages/core/src/db/schema.ts` |

## Where jobs come from

Companies are crawled directly from their own job boards: **Greenhouse, Lever, Ashby, Workday and SmartRecruiters**. The company list is shared by everyone on the server and managed in **Admin → Companies**:

- **Add a company** — paste a job board URL, or just the company's website. For a website, its careers page is read to find which board it uses, and the board has to list real jobs before anything is saved.
- **Find new companies** — Claude searches the web for companies matching a saved search or a description. Each result is then checked the same way, so nothing is added on the model's word alone. About $0.20 a run.
- **`pnpm find-boards`** — the same careers-page detection over the bundled candidate list, writing results back into the seed file.

Workday and SmartRecruiters list job titles without descriptions, and Workday hides the locations of multi-site postings behind "5 Locations". Those postings are filled in on demand: when a search's title rules match them, and when someone opens one.

## Staying up to date

While the worker runs, it checks connected mailboxes every 10 minutes (Admin → Mailbox sync), refreshes stale job boards every 10 minutes (the freshness window is in **Admin → Job boards**) and sends each person's digest once their send time passes in their own time zone. With **Look for new companies** on, it also runs one company search a day.

On a Mac without the app running, schedule `pnpm refresh` with `launchd`. Save this as `~/Library/LaunchAgents/com.jobdiscovery.refresh.plist`, then run `launchctl load ~/Library/LaunchAgents/com.jobdiscovery.refresh.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.jobdiscovery.refresh</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>cd /Users/eric/development/job-discovery-calude &amp;&amp; pnpm refresh</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>/tmp/job-discovery-refresh.log</string>
  <key>StandardErrorPath</key><string>/tmp/job-discovery-refresh.err</string>
</dict></plist>
```

## Layout

```
apps/web            Next.js UI + API routes
  app/(auth)          sign in, first-run setup, invite acceptance
  app/welcome         onboarding
  app/(app)           dashboards (/d/[id]), jobs, companies, profile, answers, mailbox, extension, account
  app/admin           admin portal
  proxy.ts            sends signed-out visitors to /login
packages/core       zod types, Drizzle schema + migrations, accounts and sessions, settings, AI spend ledger
packages/sources    job-board adapters, career-site ATS detection, crawler, matching, seed list
packages/llm        Claude client, budget gate, query parser
packages/research   resume parsing, company research, job analysis, fit scoring, cover letters, company discovery, task worker
packages/apply      answer bank + inbox, form-question answering, application packets, extension pairing
packages/mail       mailbox sync: Gmail (read-only OAuth) and IMAP readers, prefilter, email classifier, linking, pipeline moves
packages/digest     per-person daily email: replies needed, pipeline changes, what's new; HTML/text rendering, SMTP or Resend
apps/extension      Chrome MV3 extension: bridge, background worker, form engine, review panel
scripts/            CLI entry points
data/               SQLite DB and uploaded files (gitignored)
```
