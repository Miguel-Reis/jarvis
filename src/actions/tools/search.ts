/**
 * Web Search Tool
 *
 * Lightweight search without launching a browser. Supports:
 *   - Brave Search API (https://api.search.brave.com) — recommended, free 2000/month
 *   - Tavily API (https://tavily.com) — AI-optimised, free 1000/month
 *   - DuckDuckGo instant answers (no key, fallback, limited)
 *
 * Configure in ~/.jarvis/config.yaml:
 *   search:
 *     provider: brave          # brave | tavily | duckduckgo
 *     brave_api_key: BSA...
 *     tavily_api_key: tvly-...
 *     max_results: 5
 */

import type { ToolDefinition } from './registry.ts';

export type SearchProvider = 'brave' | 'tavily' | 'duckduckgo';

export type SearchConfig = {
  provider?: SearchProvider;
  brave_api_key?: string;
  tavily_api_key?: string;
  max_results?: number;
};

export type SearchResult = {
  title: string;
  url: string;
  description: string;
};

// Module-level config, set via setSearchConfig()
let searchConfig: SearchConfig = {};

/**
 * Wire search configuration from JarvisConfig. Called during daemon startup.
 */
export function setSearchConfig(config: SearchConfig): void {
  searchConfig = config;
}

// --- Providers ---

async function searchBrave(query: string, numResults: number, apiKey: string): Promise<SearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(numResults, 20)));
  url.searchParams.set('text_decorations', 'false');
  url.searchParams.set('search_lang', 'en');

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Brave Search API error (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json() as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        extra_snippets?: string[];
      }>;
    };
  };

  return (data.web?.results ?? []).map(r => ({
    title: r.title ?? '',
    url: r.url ?? '',
    description: r.description ?? r.extra_snippets?.[0] ?? '',
  }));
}

async function searchTavily(query: string, numResults: number, apiKey: string): Promise<SearchResult[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: Math.min(numResults, 10),
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tavily API error (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json() as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
    }>;
  };

  return (data.results ?? []).map(r => ({
    title: r.title ?? '',
    url: r.url ?? '',
    description: r.content ?? '',
  }));
}

async function searchDuckDuckGo(query: string, numResults: number): Promise<SearchResult[]> {
  // DDG Lite HTML scrape — unofficial, no key needed, limited results
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; JARVIS/1.0)',
      'Accept': 'text/html',
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed (${response.status})`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  // Parse result blocks: <a class="result__a" href="...">title</a>
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>[^<]*)*)<\/a>/g;

  const links: Array<{ url: string; title: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html)) !== null && links.length < numResults * 2) {
    const href = m[1]!;
    const title = m[2]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    // DDG wraps real URLs — extract the uddg param
    const uddg = new URL('https://duckduckgo.com' + href).searchParams.get('uddg');
    if (uddg) {
      links.push({ url: uddg, title });
    }
  }

  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) !== null) {
    snippets.push(m[1]!.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim());
  }

  for (let i = 0; i < Math.min(links.length, numResults); i++) {
    results.push({
      title: links[i]!.title,
      url: links[i]!.url,
      description: snippets[i] ?? '',
    });
  }

  return results;
}

// --- Tool ---

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for current information without launching a browser. Returns titles, URLs, and descriptions. Use this for facts, news, documentation, or anything that requires up-to-date information.',
  category: 'research',
  parameters: {
    query: {
      type: 'string',
      description: 'The search query',
      required: true,
    },
    num_results: {
      type: 'number',
      description: 'Number of results to return (default: 5, max: 10)',
      required: false,
    },
  },
  execute: async (params) => {
    const query = String(params.query ?? '').trim();
    if (!query) {
      return 'Error: search query is required';
    }

    const numResults = Math.min(Math.max(1, Number(params.num_results ?? 5)), 10);
    const provider = searchConfig.provider ?? 'duckduckgo';

    try {
      let results: SearchResult[] = [];

      if (provider === 'brave') {
        if (!searchConfig.brave_api_key) {
          return 'Error: Brave Search API key not configured. Add search.brave_api_key to config.yaml, or set provider to "duckduckgo".';
        }
        results = await searchBrave(query, numResults, searchConfig.brave_api_key);
      } else if (provider === 'tavily') {
        if (!searchConfig.tavily_api_key) {
          return 'Error: Tavily API key not configured. Add search.tavily_api_key to config.yaml.';
        }
        results = await searchTavily(query, numResults, searchConfig.tavily_api_key);
      } else {
        // DuckDuckGo fallback — no key needed
        results = await searchDuckDuckGo(query, numResults);
      }

      if (results.length === 0) {
        return `No results found for: "${query}"`;
      }

      const formatted = results.map((r, i) => {
        const lines = [`${i + 1}. **${r.title}**`, `   ${r.url}`];
        if (r.description) {
          lines.push(`   ${r.description.slice(0, 200)}`);
        }
        return lines.join('\n');
      });

      return `Search results for "${query}" (${results.length} results, via ${provider}):\n\n${formatted.join('\n\n')}`;
    } catch (err) {
      return `Search error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
