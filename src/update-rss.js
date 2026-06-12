// update-rss.js
// Regenerates public/<slug>/feed.xml from the show config + episodes manifest.
// Privacy-safe: the itunes:owner / email block is emitted ONLY if config.owner_email
// is a non-empty string. Default config ships it empty, so nothing personal leaks.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function xmlEscape(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function baseUrl() {
  const u = process.env.SITE_BASE_URL;
  if (!u) throw new Error('SITE_BASE_URL is not set (e.g. https://USERNAME.github.io/podcast-engine)');
  return u.replace(/\/+$/, '');
}

/** Build the feed XML string. Exported for testing without writing to disk. */
export function buildFeed(config, episodes, base) {
  const showUrl = `${base}/${config.slug}/`;
  const feedUrl = `${base}/${config.slug}/feed.xml`;
  const coverUrl = `${base}/${config.slug}/cover.jpg`;

  const ownerBlock =
    config.owner_email && config.owner_email.trim()
      ? `    <itunes:owner>
      <itunes:name>${xmlEscape(config.author)}</itunes:name>
      <itunes:email>${xmlEscape(config.owner_email.trim())}</itunes:email>
    </itunes:owner>\n`
      : '';

  const items = episodes
    .slice()
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .map((ep) => {
      const epUrl = `${base}/${config.slug}/episodes/${ep.bookSlug}.mp3`;
      return `    <item>
      <title>${xmlEscape(ep.title)}</title>
      <description>${xmlEscape(ep.description || '')}</description>
      <itunes:summary>${xmlEscape(ep.description || '')}</itunes:summary>
      <enclosure url="${xmlEscape(epUrl)}" length="${ep.bytes || 0}" type="audio/mpeg"/>
      <guid isPermaLink="false">${xmlEscape(ep.guid || epUrl)}</guid>
      <pubDate>${new Date(ep.pubDate).toUTCString()}</pubDate>
      <itunes:duration>${xmlEscape(ep.durationLabel || '')}</itunes:duration>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:explicit>${config.explicit ? 'true' : 'false'}</itunes:explicit>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(config.title)}</title>
    <link>${xmlEscape(showUrl)}</link>
    <atom:link href="${xmlEscape(feedUrl)}" rel="self" type="application/rss+xml"/>
    <language>${xmlEscape(config.language || 'en')}</language>
    <description>${xmlEscape(config.description)}</description>
    <itunes:author>${xmlEscape(config.author)}</itunes:author>
    <itunes:summary>${xmlEscape(config.description)}</itunes:summary>
    <itunes:type>episodic</itunes:type>
    <itunes:explicit>${config.explicit ? 'true' : 'false'}</itunes:explicit>
    <itunes:image href="${xmlEscape(coverUrl)}"/>
    <itunes:category text="${xmlEscape(config.category || 'Business')}">
      <itunes:category text="${xmlEscape(config.subcategory || '')}"/>
    </itunes:category>
${ownerBlock}    <image>
      <url>${xmlEscape(coverUrl)}</url>
      <title>${xmlEscape(config.title)}</title>
      <link>${xmlEscape(showUrl)}</link>
    </image>
${items}
  </channel>
</rss>
`;
}

/** Read manifest, write feed.xml. */
export function updateRss(show) {
  const manifestPath = path.join(ROOT, 'output', show.slug, 'episodes.json');
  const episodes = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : [];
  const xml = buildFeed(show.config, episodes, baseUrl());

  const publicDir = path.join(ROOT, 'public', show.slug);
  fs.mkdirSync(publicDir, { recursive: true });
  const feedPath = path.join(publicDir, 'feed.xml');
  fs.writeFileSync(feedPath, xml, 'utf8');
  return feedPath;
}

// CLI: SITE_BASE_URL=... node src/update-rss.js [slug]
if (import.meta.url === `file://${process.argv[1]}`) {
  const slug = process.argv[2] || process.env.SHOW_SLUG || 'unread-shelf-en';
  const config = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'shows', slug, 'config.json'), 'utf8'),
  );
  const p = updateRss({ slug, config });
  console.log(`Wrote ${p}`);
}
