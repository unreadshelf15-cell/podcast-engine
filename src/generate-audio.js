// generate-audio.js
// Converts a script to a single MP3 via ElevenLabs TTS. Long scripts are split
// into sentence-safe chunks (ElevenLabs has a per-request character limit),
// synthesized separately, then concatenated with ffmpeg.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import 'dotenv/config';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ELEVEN_BASE = 'https://api.elevenlabs.io/v1';
const CHUNK_CHAR_LIMIT = 2400;

/** Split text into chunks <= limit, never breaking mid-sentence. */
export function chunkText(text, limit = CHUNK_CHAR_LIMIT) {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*\s*/g) || [text];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > limit && cur) {
      chunks.push(cur.trim());
      cur = '';
    }
    // A single sentence longer than the limit: hard-split on spaces.
    if (s.length > limit) {
      const words = s.split(' ');
      for (const w of words) {
        if ((cur + ' ' + w).length > limit && cur) {
          chunks.push(cur.trim());
          cur = '';
        }
        cur += (cur ? ' ' : '') + w;
      }
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

async function ttsChunk(text, voiceId, modelId, apiKey) {
  const res = await fetch(`${ELEVEN_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function ffprobeDurationSeconds(file) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]).toString().trim();
    return Math.round(parseFloat(out));
  } catch {
    return 0;
  }
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * @returns {Promise<{path: string, bytes: number, durationSeconds: number, durationLabel: string}>}
 */
export async function generateAudio(show, book, scriptText, opts = {}) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

  const voiceId = show.config.elevenlabs_voice_id;
  const modelId = show.config.elevenlabs_model || 'eleven_multilingual_v2';
  const bookSlug = opts.bookSlug || book.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const workDir = path.join(ROOT, 'output', show.slug, 'audio', `${bookSlug}-parts`);
  fs.mkdirSync(workDir, { recursive: true });

  const chunks = chunkText(scriptText);
  const partFiles = [];
  for (let i = 0; i < chunks.length; i++) {
    const buf = await ttsChunk(chunks[i], voiceId, modelId, apiKey);
    const p = path.join(workDir, `part-${String(i).padStart(3, '0')}.mp3`);
    fs.writeFileSync(p, buf);
    partFiles.push(p);
    console.log(`[audio] chunk ${i + 1}/${chunks.length} -> ${path.basename(p)} (${buf.length} bytes)`);
  }

  const audioDir = path.join(ROOT, 'output', show.slug, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  const finalPath = path.join(audioDir, `${bookSlug}.mp3`);

  if (partFiles.length === 1) {
    fs.copyFileSync(partFiles[0], finalPath);
  } else {
    const listFile = path.join(workDir, 'concat.txt');
    fs.writeFileSync(listFile, partFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', finalPath], {
      stdio: 'inherit',
    });
  }

  // Clean up intermediate parts.
  for (const p of partFiles) fs.rmSync(p, { force: true });
  fs.rmSync(path.join(workDir, 'concat.txt'), { force: true });
  fs.rmSync(workDir, { recursive: true, force: true });

  const durationSeconds = ffprobeDurationSeconds(finalPath);
  return {
    path: finalPath,
    bytes: fs.statSync(finalPath).size,
    durationSeconds,
    durationLabel: formatDuration(durationSeconds),
  };
}
