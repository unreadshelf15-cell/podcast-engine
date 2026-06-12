# podcast-engine

A multi-show automated podcast pipeline. One engine, many shows. Each run:

1. **Generates a script** with the Claude API (per-show prompt, prompt caching on).
2. **Synthesizes audio** with ElevenLabs (sentence-safe chunking + ffmpeg concat).
3. **Publishes the MP3** into `public/<show>/episodes/`.
4. **Rebuilds the RSS feed** at `public/<show>/feed.xml`.
5. **Commits + pushes**, so GitHub Pages serves the MP3 and feed.
6. Runs on a **cron** via GitHub Actions — fully unattended once it's set up.

First show: **The Unread Shelf in 15** (`shows/unread-shelf-en/`).

---

## Privacy — what is and isn't exposed

This engine is built to keep personal data out of anything public:

- **No email in the RSS feed.** `owner_email` ships empty. Apple dropped the RSS owner-email requirement in 2022; verification now runs through your Apple Podcasts Connect / Apple ID account. If a directory ever insists on one, put a **dedicated alias** in `config.json` (not your personal address) — note it becomes publicly visible in the feed.
- **Brand name as author.** `author` is `"The Unread Shelf"`, not a personal name.
- **API keys never touch the repo.** They live in `.env` (git-ignored) locally, and as GitHub **Secrets** in Actions.
- **The one remaining public trace** of the GitHub route is your GitHub **username**, baked into the Pages URL (`https://USERNAME.github.io/podcast-engine`). If even that matters later, the same code runs unchanged behind a custom domain or a Cloudflare R2 bucket — only `SITE_BASE_URL` changes.

---

## Add a new show (no code changes)

Create `shows/<slug>/` with three files:

- `config.json` — metadata, voice ID, cron schedule
- `prompt.md` — the script-generation prompt (this *is* the show)
- `queue.json` — list of upcoming topics/books

Then add the slug to the `matrix.show` list and (if it needs a new time) a `cron` line in `.github/workflows/publish.yml`. `src/due.js` makes sure each show only publishes on its own schedule.

---

## Local first run (do this before turning on cron)

```bash
cp .env.example .env        # then fill in your two API keys + SITE_BASE_URL
npm install                 # needs Node 18+ and ffmpeg on PATH
node src/run.js --show=unread-shelf-en --script-only   # just the script — read it
node src/run.js --show=unread-shelf-en --local         # full episode, no git push
```

`--local` produces the MP3 in `output/unread-shelf-en/audio/` and the feed in
`public/unread-shelf-en/feed.xml` without pushing. **Listen to episode 1 before
automating anything.** If it's off, tune `shows/unread-shelf-en/prompt.md` and rerun.

Validate the feed at <https://www.castfeedvalidator.com> before submitting it anywhere.

---

## Go live (GitHub route)

1. Create a GitHub repo named `podcast-engine` and push this folder to `main`.
2. **Settings → Pages →** Source: `main` branch, folder `/` (root) — the feed lives at
   `public/<slug>/feed.xml` so the public URL is `https://USERNAME.github.io/podcast-engine/<slug>/feed.xml`.
   *(If you prefer serving only `/public`, set Pages to the `/public` folder and drop `public/` from `SITE_BASE_URL` paths — see note below.)*
3. **Settings → Secrets and variables → Actions →** add:
   - `ANTHROPIC_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `SITE_BASE_URL` = `https://USERNAME.github.io/podcast-engine`
4. Drop cover art at `public/unread-shelf-en/cover.jpg` (3000×3000, JPG, < 500 KB).
5. Trigger once manually: **Actions → publish → Run workflow** (force = true) to publish episode 1, or just push your first local run's output.
6. Submit the feed URL to Spotify for Podcasters, Apple Podcasts Connect, etc.

> **Pages path note:** GitHub Pages serves the repo root by default, so MP3/feed
> URLs include the `public/` segment unless you point Pages at the `/public`
> folder. `SITE_BASE_URL` plus the show slug must resolve to wherever Pages
> actually serves `feed.xml`. Confirm by opening the feed URL in a browser after
> the first deploy, then keep `SITE_BASE_URL` consistent with it.

---

## Quality gate

Cron stays off until: episode 1 is fully listened to, voice + script land, the
RSS validates, and the feed is accepted by at least one directory. If episode 1
isn't right, fix the prompt and regenerate — don't automate a bad sound.

---

## File map

```
shows/<slug>/config.json | prompt.md | queue.json   # per-show definition
src/generate-script.js    # Claude API + prompt caching + word-floor retry
src/generate-audio.js     # ElevenLabs TTS + chunking + ffmpeg concat
src/update-rss.js         # builds feed.xml (omits owner email unless set)
src/upload.js             # git commit + push
src/due.js                # per-show schedule gate for the shared workflow
src/run.js                # orchestrator (--show, --local, --script-only)
output/<slug>/            # scripts, audio, episodes.json manifest (audio git-ignored)
public/<slug>/            # feed.xml, cover.jpg, episodes/*.mp3  (served by Pages)
.github/workflows/publish.yml
```
