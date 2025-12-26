const https = require('https');
const http = require('http');

/**
 * Fetch URL content with timeout
 */
async function fetchUrl(url, options = {}) {
  const timeout = options.timeout || 10000;
  const maxSize = options.maxSize || 5 * 1024 * 1024; // 5MB default
  const maxRedirects = options.maxRedirects || 5;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;

    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SDK-Monitor/1.0)',
        ...options.headers
      }
    }, (res) => {
      // Handle redirects (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        const redirectUrl = res.headers.location;

        if (!redirectUrl) {
          reject(new Error(`Redirect without location header: ${url}`));
          return;
        }

        // Check redirect limit
        const redirectCount = options.redirectCount || 0;
        if (redirectCount >= maxRedirects) {
          reject(new Error(`Too many redirects (${maxRedirects}): ${url}`));
          return;
        }

        // Follow redirect
        const newUrl = redirectUrl.startsWith('http')
          ? redirectUrl
          : new URL(redirectUrl, url).href;

        console.log(`Following redirect: ${url} -> ${newUrl}`);

        // Recursive call with incremented redirect count
        fetchUrl(newUrl, {
          ...options,
          redirectCount: redirectCount + 1
        }).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }

      let data = '';
      let size = 0;

      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxSize) {
          req.destroy();
          reject(new Error(`Response too large (>${maxSize} bytes): ${url}`));
          return;
        }
        data += chunk;
      });

      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error(`Timeout: ${url}`));
    });
  });
}

/**
 * Simple XML/RSS parser (regex-based for zero dependencies)
 */
function parseRSS(xml) {
  const items = [];

  // Limit XML size to prevent memory issues
  if (xml.length > 2 * 1024 * 1024) {
    xml = xml.substring(0, 2 * 1024 * 1024);
  }

  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  const titleRegex = /<title[^>]*>([\s\S]*?)<\/title>/i;
  const linkRegex = /<link[^>]*>([\s\S]*?)<\/link>/i;
  const pubDateRegex = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i;
  const descRegex = /<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i;
  const descRegex2 = /<description[^>]*>([\s\S]*?)<\/description>/i;

  let match;
  let count = 0;
  const maxItems = 20; // Limit to prevent memory issues

  while ((match = itemRegex.exec(xml)) !== null && count < maxItems) {
    const itemXml = match[1];
    const title = (titleRegex.exec(itemXml)?.[1] || '').trim();
    const link = (linkRegex.exec(itemXml)?.[1] || '').trim();
    const pubDate = (pubDateRegex.exec(itemXml)?.[1] || '').trim();

    let description = descRegex.exec(itemXml)?.[1] || descRegex2.exec(itemXml)?.[1] || '';
    description = description.replace(/<[^>]+>/g, '').trim();

    if (title && link) {
      items.push({
        title: decodeHTMLEntities(title),
        link: decodeHTMLEntities(link),
        description: decodeHTMLEntities(description.substring(0, 500)),
        pubDate,
        date: pubDate ? new Date(pubDate).getTime() : Date.now()
      });
      count++;
    }
  }

  return items;
}

/**
 * Fetch RSS feed
 */
async function fetchRSS(source) {
  try {
    const xml = await fetchUrl(source.url);
    let items = parseRSS(xml);

    // Apply filter if specified
    if (source.filter) {
      items = items.filter(item =>
        item.title.includes(source.filter) ||
        item.description.includes(source.filter)
      );
    }

    // Normalize to common format
    return items.map(item => ({
      id: hashString(item.link),
      title: item.title,
      url: item.link,
      description: item.description.substring(0, 500),
      publishedAt: item.date,
      source: source.id,
      rawData: item
    }));
  } catch (error) {
    console.error(`[${source.id}] RSS fetch failed:`, error.message);
    return [];
  }
}

/**
 * Fetch GitHub releases
 */
async function fetchGitHub(source) {
  try {
    const [owner, repo] = source.url.split('/');
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;

    const data = await fetchUrl(apiUrl, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });

    const releases = JSON.parse(data);

    return releases.slice(0, 10).map(release => ({
      id: `github-${release.id}`,
      title: `${source.name} - ${release.tag_name}`,
      url: release.html_url,
      description: (release.body || '').substring(0, 500),
      publishedAt: new Date(release.published_at).getTime(),
      version: release.tag_name,
      prerelease: release.prerelease,
      source: source.id,
      rawData: release
    }));
  } catch (error) {
    console.error(`[${source.id}] GitHub fetch failed:`, error.message);
    return [];
  }
}

/**
 * Fetch HTML page and extract basic info
 */
async function fetchHTML(source) {
  try {
    const html = await fetchUrl(source.url);

    // Simple extraction: look for links
    const items = [];
    const links = [];

    // Extract links based on selector or default pattern
    let linkRegex;
    if (source.selector) {
      // If selector is provided, try to match it
      // For simple selectors like "h3 a" or "a[href^='/news/']"
      if (source.selector.includes('a')) {
        linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
      } else {
        linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
      }
    } else {
      // Default: extract all links
      linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
    }

    let match;
    while ((match = linkRegex.exec(html)) !== null && links.length < 10) {
      const href = match[1];
      const text = match[2].replace(/<[^>]+>/g, '').trim();

      // Convert relative URL to absolute URL
      let absoluteUrl;
      try {
        if (href.startsWith('http')) {
          absoluteUrl = href;
        } else if (href.startsWith('/')) {
          const baseUrl = new URL(source.url);
          absoluteUrl = `${baseUrl.protocol}//${baseUrl.host}${href}`;
        } else if (href.startsWith('#') || href.startsWith('javascript:')) {
          continue; // Skip anchors and javascript links
        } else {
          // Relative path
          absoluteUrl = new URL(href, source.url).href;
        }
      } catch (e) {
        console.error(`[${source.id}] Invalid URL: ${href}`);
        continue;
      }

      if (text.length > 5 && text.length < 200) {
        links.push({
          url: absoluteUrl,
          text: decodeHTMLEntities(text)
        });
      }
    }

    // Get first 5 links as potential updates
    links.slice(0, 5).forEach((link, idx) => {
      items.push({
        id: hashString(link.url),
        title: link.text,
        url: link.url,
        description: `Update from ${source.name}`,
        publishedAt: Date.now() - (idx * 86400000), // Estimate: newer first
        source: source.id,
        rawData: link
      });
    });

    return items;
  } catch (error) {
    console.error(`[${source.id}] HTML fetch failed:`, error.message);
    return [];
  }
}

/**
 * Main fetcher - routes to appropriate handler
 */
async function fetchSource(source) {
  if (!source.enabled) {
    console.log(`[${source.id}] Skipped (disabled)`);
    return [];
  }

  console.log(`[${source.id}] Fetching ${source.type}...`);

  switch (source.type) {
    case 'rss':
      return await fetchRSS(source);
    case 'github':
      return await fetchGitHub(source);
    case 'html':
      return await fetchHTML(source);
    case 'reference':
      console.log(`[${source.id}] Reference only - manual check required`);
      return [];
    default:
      console.log(`[${source.id}] Unknown type: ${source.type}`);
      return [];
  }
}

/**
 * Fetch all sources with concurrency control
 */
async function fetchAllSources(sources, concurrency = 2) {
  const results = {};

  // Process sources sequentially in small batches to avoid memory issues
  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency);

    const batchPromises = batch.map(source =>
      fetchSource(source)
        .then(items => {
          results[source.id] = items;
        })
        .catch(err => {
          console.error(`[${source.id}] Fatal error:`, err.message);
          results[source.id] = [];
        })
    );

    await Promise.all(batchPromises);

    // Small delay between batches
    if (i + concurrency < sources.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

// Utility functions
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function decodeHTMLEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'"
  };
  return text.replace(/&[a-z0-9#]+;/gi, match => entities[match] || match);
}

module.exports = {
  fetchSource,
  fetchAllSources,
  fetchUrl
};
