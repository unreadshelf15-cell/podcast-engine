// upload.js
// Commits and pushes generated output (MP3 + feed.xml + manifest + queue state)
// to the repo. On GitHub Actions the checkout is already authenticated, so a
// plain `git push` works. Locally it uses your configured git credentials.

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, stdio: 'pipe' }).toString().trim();
}

/** Stage everything under public/, output manifests, and the show queue, then push. */
export function commitAndPush(message) {
  // Configure identity for unattended Actions runs if not present.
  try {
    git(['config', 'user.email']);
  } catch {
    git(['config', 'user.email', 'actions@users.noreply.github.com']);
    git(['config', 'user.name', 'podcast-engine-bot']);
  }

  git(['add', 'public', 'output', 'shows']);

  // Nothing staged? Skip cleanly.
  const status = git(['status', '--porcelain']);
  if (!status) {
    console.log('[upload] no changes to commit');
    return false;
  }

  git(['commit', '-m', message]);
  git(['push']);
  console.log('[upload] pushed:', message);
  return true;
}

// CLI: node src/upload.js "message"
if (import.meta.url === `file://${process.argv[1]}`) {
  const msg = process.argv[2] || `publish ${new Date().toISOString()}`;
  commitAndPush(msg);
}
