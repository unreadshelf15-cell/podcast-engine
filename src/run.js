// run.js — orchestrator
// Picks the next unpublished book in a show's queue, generates the script and
// audio, publishes the MP3 into public/, updates the RSS feed, marks the book
// published, and (unless --local) commits + pushes.
//
// Usage:
//   node src/run.js --show=unread-shelf-en
//   node src/run.js --show=unread-shelf-en --local        (no git push; for first local test)
//   node src/run.js --show=unread-shelf-en --script-only   (stop after script; no TTS, no publish)

import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { generateScript, slugifyBook } from './generate-script.js';
import { generateAudio } from './generate-audio.js';
import { updateRss } from './update-rss.js';
import { commitAndPush } from './upload.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function arg(name, def = undefined) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function main() {
  const slug = arg('show');
  if (!slug) throw new Error('Pass --show=<slug>, e.g. --show=unread-shelf-en');

  const local = !!arg('local');
  const scriptOnly = !!arg('script-only');

  const showDir = path.join(ROOT, 'shows', slug);
  const config = readJSON(path.join(showDir, 'config.json'));
  const queuePath = path.join(showDir, 'queue.json');
  const queue = readJSON(queuePath);
  const show = { slug, config };

  const idx = queue.findIndex((b) => !b.published);
  if (idx === -1) {
    console.log(`[run] queue for "${slug}" is empty — nothing to publish. Add more books.`);
    return;
  }
  const book = queue[idx];
  const bookSlug = slugifyBook(book.title);
  console.log(`[run] next up: "${book.title}" by ${book.author}`);

  // 1. Script
  const script = await generateScript(show, book);
  console.log(`[run] script: ${script.words} words -> ${script.path}`);
  if (scriptOnly) {
    console.log('[run] --script-only set; stopping before audio.');
    return;
  }

  // 2. Audio
  const audio = await generateAudio(show, book, script.text, { bookSlug });
  console.log(`[run] audio: ${audio.durationLabel} (${audio.bytes} bytes) -> ${audio.path}`);

  // 3. Publish MP3 into public/
  const epDir = path.join(ROOT, 'public', slug, 'episodes');
  fs.mkdirSync(epDir, { recursive: true });
  const publicMp3 = path.join(epDir, `${bookSlug}.mp3`);
  fs.copyFileSync(audio.path, publicMp3);

  // 4. Update episodes manifest
  const manifestPath = path.join(ROOT, 'output', slug, 'episodes.json');
  const episodes = fs.existsSync(manifestPath) ? readJSON(manifestPath) : [];
  const episodeNumber = episodes.length + 1;
  episodes.push({
    number: episodeNumber,
    title: `${book.title} — ${book.author}`,
    bookSlug,
    description: book.angle || config.description,
    pubDate: new Date().toISOString(),
    bytes: audio.bytes,
    durationSeconds: audio.durationSeconds,
    durationLabel: audio.durationLabel,
    guid: `${slug}-${bookSlug}-${Date.now()}`,
  });
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeJSON(manifestPath, episodes);

  // 5. Mark published in queue
  queue[idx].published = true;
  queue[idx].published_at = new Date().toISOString();
  writeJSON(queuePath, queue);

  // 6. Rebuild RSS
  const feedPath = updateRss(show);
  console.log(`[run] feed: ${feedPath}`);

  // 7. Commit + push
  if (local) {
    console.log('[run] --local set; skipping git push. Review output, then run for real.');
  } else {
    commitAndPush(`[${slug}] publish "${book.title}" (ep ${episodeNumber})`);
  }

  console.log('[run] done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
