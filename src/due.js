// due.js
// Tiny scheduling gate so multiple shows with different cron schedules can share
// one workflow. Exits 0 ("due") if the show's own cron matches the current UTC
// time (hour + day-of-week), else exits 3 ("not due"). Supports *, lists (1,4),
// and ranges (1-5) for the day-of-week and hour fields. Minute is ignored on
// purpose — Actions cron firing is approximate, so we match on the hour.
//
// Usage: node src/due.js --show=unread-shelf-en   (|| treat non-zero as "skip")

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function arg(name) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

function fieldMatches(field, value) {
  if (field === '*') return true;
  for (const part of field.split(',')) {
    if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number);
      if (value >= lo && value <= hi) return true;
    } else if (Number(part) === value) {
      return true;
    }
  }
  return false;
}

function isDue(cron, now = new Date()) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Bad cron: "${cron}"`);
  const [, hour, , , dow] = parts;
  const curHour = now.getUTCHours();
  let curDow = now.getUTCDay(); // 0=Sun..6=Sat ; cron also allows 7 for Sun
  const dowField = dow.replace(/7/g, '0');
  return fieldMatches(hour, curHour) && fieldMatches(dowField, curDow);
}

export { isDue };

if (import.meta.url === `file://${process.argv[1]}`) {
  const force = !!arg('force');
  const slug = arg('show');
  if (!slug) {
    console.error('Pass --show=<slug>');
    process.exit(2);
  }
  const config = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'shows', slug, 'config.json'), 'utf8'),
  );
  const cron = config.publish_schedule?.cron;
  if (force) {
    console.log(`[due] --force: running "${slug}" regardless of schedule`);
    process.exit(0);
  }
  if (cron && isDue(cron)) {
    console.log(`[due] "${slug}" is due now (cron ${cron})`);
    process.exit(0);
  }
  console.log(`[due] "${slug}" not due now (cron ${cron}); skipping`);
  process.exit(3);
}
