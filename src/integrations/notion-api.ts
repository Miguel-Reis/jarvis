/**
 * Notion API Client
 *
 * Wrapper for Notion API.
 * Docs: https://developers.notion.com/reference
 */

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export type NotionConfig = {
  apiKey: string;
};

export type NotionDatabase = {
  object: 'database';
  id: string;
  created_time: string;
  last_edited_time: string;
  title: Array<{ type: string; text: { content: string } }>;
  description: Array<{ type: string; text: { content: string } }>;
  properties: Record<string, {
    id: string;
    name: string;
    type: string;
  }>;
  parent: { type: string; workspace?: string; page_id?: string };
  url: string;
};

export type NotionPage = {
  object: 'page';
  id: string;
  created_time: string;
  last_edited_time: string;
  parent: { type: string; database_id?: string; page_id?: string };
  properties: Record<string, {
    id: string;
    type: string;
    title?: Array<{ type: string; text: { content: string } }>;
    rich_text?: Array<{ type: string; text: { content: string } }>;
    select?: { name: string; color: string };
    status?: { name: string; color: string };
    number?: number;
    checkbox?: boolean;
    date?: { start: string; end?: string | null };
  }>;
  url: string;
};

export type NotionBlock = {
  object: 'block';
  id: string;
  type: string;
  paragraph?: { rich_text: Array<{ type: string; text: { content: string } }>; color?: string };
  heading_1?: { rich_text: Array<{ type: string; text: { content: string } }>; color?: string };
  heading_2?: { rich_text: Array<{ type: string; text: { content: string } }>; color?: string };
  heading_3?: { rich_text: Array<{ type: string; text: { content: string } }>; color?: string };
  bulleted_list_item?: { rich_text: Array<{ type: string; text: { content: string } }>; color?: string };
  numbered_list_item?: { rich_text: Array<{ type: string; text: { content: string } }>; color?: string };
  to_do?: { rich_text: Array<{ type: string; text: { content: string } }>; checked?: boolean; color?: string };
  toggle?: { rich_text: Array<{ type: string; text: { content: string } }>; color?: string };
  code?: { rich_text: Array<{ type: string; text: { content: string } }>; language?: string; caption?: Array<{ type: string; text: { content: string } }> };
  quote?: { rich_text: Array<{ type: string; text: { content: string } }>; color?: string };
  divider?: Record<string, never>;
};

export type NotionUser = {
  object: 'user';
  id: string;
  type: string;
  name: string;
  avatar_url: string | null;
  person?: { email: string };
  bot?: { workspace_name: string };
};

export class NotionClient {
  private apiKey: string;

  constructor(config: NotionConfig) {
    this.apiKey = config.apiKey;
  }

  private async request<T>(endpoint: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET', body?: Record<string, unknown>): Promise<T> {
    const url = `${NOTION_API_BASE}/${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Notion API error (${response.status}): ${error}`);
    }

    return response.json() as T;
  }

  /**
   * Get current user (bot) info
   */
  async getBot(): Promise<NotionUser> {
    return this.request<NotionUser>('users/me');
  }

  /**
   * List all databases the bot has access to
   */
  async listDatabases(): Promise<NotionDatabase[]> {
    const data = await this.request<{ results: NotionDatabase[] }>('search', {
      filter: { property: 'object', value: 'database' },
    });
    return data.results;
  }

  /**
   * Get database by ID
   */
  async getDatabase(databaseId: string): Promise<NotionDatabase> {
    return this.request<NotionDatabase>(`databases/${databaseId}`);
  }

  /**
   * Query a database
   */
  async queryDatabase(databaseId: string, filter?: Record<string, unknown>, sorts?: Array<{ property: string; direction: 'ascending' | 'descending' }>): Promise<NotionPage[]> {
    const body: Record<string, unknown> = {};
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;

    const data = await this.request<{ results: NotionPage[] }>(`databases/${databaseId}/query`, 'POST', body);
    return data.results;
  }

  /**
   * Create a page in a database
   */
  async createPage(databaseId: string, properties: Record<string, unknown>): Promise<NotionPage> {
    const data = await this.request<NotionPage>('pages', 'POST', {
      parent: { database_id: databaseId },
      properties,
    });
    return data;
  }

  /**
   * Create a child page under a page
   */
  async createChildPage(parentPageId: string, title: string, content?: Array<{ type: string; [key: string]: unknown }>): Promise<NotionPage> {
    const data = await this.request<NotionPage>('pages', 'POST', {
      parent: { page_id: parentPageId },
      properties: {
        title: [
          {
            type: 'text',
            text: { content: title },
          },
        ],
      },
      children: content,
    });
    return data;
  }

  /**
   * Update a page
   */
  async updatePage(pageId: string, properties: Record<string, unknown>): Promise<NotionPage> {
    const data = await this.request<NotionPage>(`pages/${pageId}`, 'PATCH', {
      properties,
    });
    return data;
  }

  /**
   * Get page by ID
   */
  async getPage(pageId: string): Promise<NotionPage> {
    return this.request<NotionPage>(`pages/${pageId}`);
  }

  /**
   * Append blocks to a page
   */
  async appendBlocks(pageId: string, blocks: NotionBlock[]): Promise<NotionBlock[]> {
    const data = await this.request<{ results: NotionBlock[] }>(`blocks/${pageId}/children`, 'PATCH', {
      children: blocks,
    });
    return data.results;
  }

  /**
   * Get block children (for nested content)
   */
  async getBlockChildren(blockId: string): Promise<NotionBlock[]> {
    const data = await this.request<{ results: NotionBlock[] }>(`blocks/${blockId}/children`);
    return data.results;
  }

  /**
   * Search pages/databases
   */
  async search(query?: string, filter?: { property: string; value: string }): Promise<{ pages: NotionPage[]; databases: NotionDatabase[] }> {
    const body: Record<string, unknown> = {};
    if (query) body.query = query;
    if (filter) body.filter = filter;

    const data = await this.request<{ results: Array<NotionPage | NotionDatabase> }>('search', 'POST', body);

    const pages = data.results.filter((r): r is NotionPage => r.object === 'page');
    const databases = data.results.filter((r): r is NotionDatabase => r.object === 'database');

    return { pages, databases };
  }

  /**
   * Create a simple text block
   */
  static createParagraph(text: string): NotionBlock {
    return {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: text } }],
      },
    };
  }

  /**
   * Create a heading block
   */
  static createHeading(text: string, level: 1 | 2 | 3 = 1): NotionBlock {
    return {
      object: 'block',
      type: `heading_${level}`,
      [`heading_${level}`]: {
        rich_text: [{ type: 'text', text: { content: text } }],
      },
    };
  }

  /**
   * Create a to-do block
   */
  static createToDo(text: string, checked = false): NotionBlock {
    return {
      object: 'block',
      type: 'to_do',
      to_do: {
        rich_text: [{ type: 'text', text: { content: text } }],
        checked,
      },
    };
  }

  /**
   * Create a bulleted list item
   */
  static createBullet(text: string): NotionBlock {
    return {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content: text } }],
      },
    };
  }
}

/**
 * Create Notion client from config
 */
export function createNotionClient(config: NotionConfig): NotionClient {
  return new NotionClient(config);
}

/**
 * Test Notion connection
 */
export async function testNotionConnection(apiKey: string): Promise<{ success: boolean; botName?: string; error?: string }> {
  try {
    const client = new NotionClient({ apiKey });
    const bot = await client.getBot();
    return { success: true, botName: bot.bot?.workspace_name || bot.name };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
