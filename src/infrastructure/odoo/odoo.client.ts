import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type JsonRpcResponse<T> = {
  result?: T;
  error?: { data?: { message?: string }; message?: string };
};

@Injectable()
export class OdooClient {
  private readonly logger = new Logger(OdooClient.name);
  private uid: number | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return this.config.get<string>('ODOO_MODE') === 'live';
  }

  private get baseUrl(): string {
    return (this.config.get<string>('ODOO_URL') || 'http://localhost:8069').replace(/\/$/, '');
  }

  private get db(): string {
    return this.config.get<string>('ODOO_DB') || 'black_tiger_dev';
  }

  private get login(): string {
    return this.config.get<string>('ODOO_LOGIN') || 'commerce_api';
  }

  private get password(): string {
    return this.config.get<string>('ODOO_PASSWORD') || 'commerce_api_dev_change_me';
  }

  private async jsonRpc<T>(endpoint: string, params: Record<string, unknown>): Promise<T> {
    const timeoutMs = Number(this.config.get<string>('ODOO_RPC_TIMEOUT_MS') || 30_000);
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params,
        id: Date.now(),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Odoo HTTP ${res.status}`);
    }
    const body = (await res.json()) as JsonRpcResponse<T>;
    if (body.error) {
      throw new Error(body.error.data?.message || body.error.message || 'Odoo RPC error');
    }
    return body.result as T;
  }

  private async authenticate(): Promise<number> {
    if (this.uid) {
      return this.uid;
    }
    const uid = await this.jsonRpc<number>('/jsonrpc', {
      service: 'common',
      method: 'authenticate',
      args: [this.db, this.login, this.password, {}],
    });
    if (!uid) {
      throw new Error('Odoo authentication failed');
    }
    this.uid = uid;
    return uid;
  }

  async executeKw<T>(
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {},
  ): Promise<T> {
    const uid = await this.authenticate();
    return this.jsonRpc<T>('/jsonrpc', {
      service: 'object',
      method: 'execute_kw',
      args: [this.db, uid, this.password, model, method, args, kwargs],
    });
  }

  async getWebsitePageBlocks(slug: string): Promise<Record<string, unknown>> {
    const map = await this.executeKw<Record<string, OdooBlockPayload>>(
      'bt.website.page',
      'get_published_blocks_map',
      [slug],
    );
    if (!map || typeof map !== 'object') {
      return {};
    }
    return this.normalizeWebsiteBlocks(map);
  }

  private normalizeWebsiteBlocks(
    map: Record<string, OdooBlockPayload>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, block] of Object.entries(map)) {
      if (!block || typeof block !== 'object') {
        continue;
      }
      const normalized: Record<string, unknown> = {
        key: block.key ?? key,
        type: block.type ?? null,
        text: block.text ?? null,
        html: block.html ?? null,
        imageUrl: block.imageUrl ?? null,
        link: block.link ?? null,
      };
      if (block.type === 'json' && block.json != null) {
        normalized.json = this.parseJsonBlock(block.json);
      }
      out[key] = normalized;
    }
    return out;
  }

  private parseJsonBlock(raw: unknown): unknown {
    if (typeof raw !== 'string') {
      return raw;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
}

type OdooBlockPayload = {
  key?: string;
  type?: string;
  text?: string | null;
  html?: string | null;
  imageUrl?: string | null;
  json?: string | unknown;
  link?: { label?: string | null; href?: string | null } | null;
};
