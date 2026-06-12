// generate-script.js
// Generates a spoken podcast script via the Claude API using a per-show prompt
// template, with prompt caching on the large static instruction block.

import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8000;
const WORD_FLOOR = 2000;

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Build the system + user blocks. The prompt template is large and identical
 * across runs, so we mark it with cache_control for ~90% input-token savings.
 */
function buildMessages(promptTemplate, book) {
  const filled = promptTemplate
    .replace('{title}', book.title)
    .replace('{author}', book.author)
    .replace('{angle}', book.angle || '');

  return {
    system: [
      {
        type: 'text',
        text: filled,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content:
          `Write the full episode now for:\n` +
          `BOOK_TITLE: ${book.title}\n` +
          `AUTHOR: ${book.author}\n` +
          `ANGLE: ${book.angle || ''}\n\n` +
          `Return only the spoken script.`,
      },
    ],
  };
}

/**
 * Generate a script for one book of one show.
 * @returns {Promise<{text: string, words: number, path: string}>}
 */
export async function generateScript(show, book, opts = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const model = opts.model || show.config.elevenlabs_model_override || DEFAULT_MODEL;
  const promptPath = path.join(ROOT, 'shows', show.slug, 'prompt.md');
  const promptTemplate = fs.readFileSync(promptPath, 'utf8');

  const client = new Anthropic({ apiKey });
  const { system, messages } = buildMessages(promptTemplate, book);

  let text = '';
  let words = 0;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages:
        attempt === 1
          ? messages
          : [
              ...messages,
              { role: 'assistant', content: text },
              {
                role: 'user',
                content:
                  `That draft was ${words} words, under the ${WORD_FLOOR}-word floor. ` +
                  `Rewrite the full script from the top, deeper in the big-idea and ` +
                  `supporting sections. No filler. Return only the spoken script.`,
              },
            ],
    });

    text = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    words = wordCount(text);

    if (words >= WORD_FLOOR) break;
    console.warn(`[script] attempt ${attempt}: ${words} words (< ${WORD_FLOOR}); retrying`);
  }

  const outDir = path.join(ROOT, 'output', show.slug, 'scripts');
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${slugifyBook(book.title)}.txt`);
  fs.writeFileSync(filePath, text, 'utf8');

  return { text, words, path: filePath };
}

export function slugifyBook(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// CLI: node src/generate-script.js "The Richest Man in Babylon" "George S. Clason" "angle..."
if (import.meta.url === `file://${process.argv[1]}`) {
  const [title, author, angle] = process.argv.slice(2);
  if (!title) {
    console.error('Usage: node src/generate-script.js "<title>" "<author>" "<angle>"');
    process.exit(1);
  }
  const slug = process.env.SHOW_SLUG || 'unread-shelf-en';
  const config = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'shows', slug, 'config.json'), 'utf8'),
  );
  generateScript({ slug, config }, { title, author, angle })
    .then((r) => {
      console.log(`\n--- ${r.words} words -> ${r.path} ---\n`);
      console.log(r.text.slice(0, 1200) + '\n...[truncated preview]...');
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
