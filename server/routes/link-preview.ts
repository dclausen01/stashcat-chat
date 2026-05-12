import { Router, type Response } from 'express';

const router = Router();

type PreviewEntry = { title?: string; description?: string; image?: string; siteName?: string; fetchedAt: number };
const linkPreviewCache = new Map<string, PreviewEntry>();
const PREVIEW_TTL = 3600_000; // 1 hour
const PREVIEW_MAX_ENTRIES = 500;

function cachePreview(url: string, entry: PreviewEntry) {
  // LRU-style eviction: when at capacity, drop the oldest entry (Map preserves insertion order).
  if (linkPreviewCache.size >= PREVIEW_MAX_ENTRIES && !linkPreviewCache.has(url)) {
    const oldestKey = linkPreviewCache.keys().next().value;
    if (oldestKey !== undefined) linkPreviewCache.delete(oldestKey);
  }
  linkPreviewCache.set(url, entry);
}

function isBlockedHost(hostname: string): boolean {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|localhost|::1|\[::1\]|fc|fd)/i.test(hostname);
}

async function extractAndRespondPreview(response: globalThis.Response, url: string, res: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    return res.json({ title: url, fetchedAt: Date.now() });
  }

  const reader = response.body?.getReader();
  let html = '';
  if (reader) {
    const decoder = new TextDecoder();
    let bytesRead = 0;
    while (bytesRead < 65536) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytesRead += value.length;
    }
    reader.cancel().catch(() => {});
  }

  const getMetaContent = (nameOrProp: string): string | undefined => {
    const propRe = new RegExp(`<meta[^>]+(?:property|name)=["']${nameOrProp}["'][^>]+content=["']([^"']+)["']`, 'i');
    const propMatch = html.match(propRe);
    if (propMatch) return propMatch[1];
    const revRe = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${nameOrProp}["']`, 'i');
    const revMatch = html.match(revRe);
    if (revMatch) return revMatch[1];
    return undefined;
  };

  const title = getMetaContent('og:title')
    || getMetaContent('twitter:title')
    || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const description = getMetaContent('og:description')
    || getMetaContent('twitter:description')
    || getMetaContent('description');
  const image = getMetaContent('og:image')
    || getMetaContent('twitter:image');
  const siteName = getMetaContent('og:site_name');

  const decode = (s?: string) => s?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  const result = {
    title: decode(title) || url,
    description: decode(description),
    image: image?.startsWith('http') ? image : undefined,
    siteName: decode(siteName),
    fetchedAt: Date.now(),
  };

  cachePreview(url, result);
  res.json(result);
}

router.get('/link-preview', async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url || !/^https?:\/\//.test(url)) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    try {
      const parsed = new URL(url);
      if (isBlockedHost(parsed.hostname)) {
        return res.status(400).json({ error: 'URL not allowed' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    const cached = linkPreviewCache.get(url);
    if (cached && Date.now() - cached.fetchedAt < PREVIEW_TTL) {
      return res.json(cached);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'manual',
    });
    clearTimeout(timeout);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (location) {
        try {
          const redirectUrl = new URL(location, url);
          if (isBlockedHost(redirectUrl.hostname)) {
            return res.json({ title: url, fetchedAt: Date.now() });
          }
          const ctrl2 = new AbortController();
          const to2 = setTimeout(() => ctrl2.abort(), 5000);
          const response2 = await fetch(redirectUrl.href, {
            signal: ctrl2.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)', 'Accept': 'text/html,application/xhtml+xml' },
            redirect: 'manual',
          });
          clearTimeout(to2);
          return extractAndRespondPreview(response2, url, res);
        } catch {
          return res.json({ title: url, fetchedAt: Date.now() });
        }
      }
    }

    return extractAndRespondPreview(response, url, res);
  } catch {
    res.json({ title: req.query.url, fetchedAt: Date.now() });
  }
});

export default router;
