import { ConfigService } from '@nestjs/config';
import { ChatLlmProvider } from './chat-llm.provider';
import { ChatRulesProvider } from './chat-rules.provider';
import type { ProductFixture } from '../../mocks/catalog.fixtures';

describe('ChatLlmProvider', () => {
  const products = [
    {
      slug: 'tiger-10w30-sl-fully-synthetic',
      name: 'TIGER 10W30',
      productCode: 'BT-1',
      categorySlug: 'passenger-cars',
      currency: 'SAR',
      unitPrice: 88.5,
      inStock: true,
      packagingOptions: [],
    },
  ] as unknown as ProductFixture[];

  it('uses rules when CHAT_PROVIDER is not llm', async () => {
    const config = {
      get: (key: string) => (key === 'CHAT_PROVIDER' ? 'rules' : undefined),
    } as unknown as ConfigService;
    const provider = new ChatLlmProvider(config, new ChatRulesProvider());
    const result = await provider.recommend('10W-30', products);
    expect(result.provider).toBe('rules');
    expect(result.products.length).toBeGreaterThan(0);
  });

  it('falls back to rules when llm call fails', async () => {
    const config = {
      get: (key: string) => {
        const map: Record<string, string> = {
          CHAT_PROVIDER: 'llm',
          CHAT_LLM_API_KEY: 'test-key',
          CHAT_LLM_BASE_URL: 'https://example.invalid/v1',
          CHAT_LLM_MODEL: 'gpt-test',
        };
        return map[key];
      },
    } as unknown as ConfigService;
    const provider = new ChatLlmProvider(config, new ChatRulesProvider());
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));
    const result = await provider.recommend('10W-30 for car', products);
    expect(result.provider).toBe('rules');
    jest.restoreAllMocks();
  });

  it('uses LLM reply and passes conversation history', async () => {
    const config = {
      get: (key: string) => {
        const map: Record<string, string> = {
          CHAT_PROVIDER: 'llm',
          CHAT_LLM_API_KEY: 'test-key',
          CHAT_LLM_BASE_URL: 'https://api.example/v1',
          CHAT_LLM_MODEL: 'gpt-test',
          CHAT_LLM_JSON_MODE: 'true',
        };
        return map[key];
      },
    } as unknown as ConfigService;
    const provider = new ChatLlmProvider(config, new ChatRulesProvider());
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: 'For a petrol passenger car, TIGER 10W30 is a strong fit.',
                slugs: ['tiger-10w30-sl-fully-synthetic'],
              }),
            },
          },
        ],
      }),
    });
    const result = await provider.recommend('what about that oil?', products, 4, [
      { role: 'user', content: 'I need 10W-30 for my car' },
      { role: 'assistant', content: 'I can help with passenger grades.' },
    ]);
    expect(result.provider).toBe('llm');
    expect(result.reply).toContain('TIGER 10W30');
    expect(result.products[0]?.slug).toBe('tiger-10w30-sl-fully-synthetic');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.messages.some((m: { content: string }) => m.content.includes('I need 10W-30'))).toBe(
      true,
    );
    expect(body.response_format).toEqual({ type: 'json_object' });
    jest.restoreAllMocks();
  });

  it('calls Ollama without response_format and parses fenced JSON', async () => {
    const config = {
      get: (key: string) => {
        const map: Record<string, string> = {
          CHAT_PROVIDER: 'llm',
          CHAT_LLM_BASE_URL: 'http://localhost:11434/v1',
          CHAT_LLM_MODEL: 'llama3.2:3b',
          CHAT_LLM_API_KEY: 'ollama',
          CHAT_LLM_JSON_MODE: 'false',
        };
        return map[key];
      },
    } as unknown as ConfigService;
    const provider = new ChatLlmProvider(config, new ChatRulesProvider());
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '```json\n{"reply":"Try TIGER 10W30 for passenger cars.","slugs":["tiger-10w30-sl-fully-synthetic"]}\n```',
            },
          },
        ],
      }),
    });
    const result = await provider.recommend('10W-30 for my car', products);
    expect(result.provider).toBe('llm');
    expect(result.reply).toContain('TIGER 10W30');
    expect(result.reply).not.toContain('slugs');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.model).toBe('llama3.2:3b');
    expect(body.response_format).toBeUndefined();
    expect(String(body.messages[1].content)).toContain('10W-30');
    jest.restoreAllMocks();
  });

  it('parses loose reply:/slugs: output and strips JSON from the bubble', async () => {
    const config = {
      get: (key: string) => {
        const map: Record<string, string> = {
          CHAT_PROVIDER: 'llm',
          CHAT_LLM_BASE_URL: 'http://localhost:11434/v1',
          CHAT_LLM_MODEL: 'llama3.2:3b',
          CHAT_LLM_JSON_MODE: 'false',
        };
        return map[key];
      },
    } as unknown as ConfigService;
    const provider = new ChatLlmProvider(config, new ChatRulesProvider());
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                'reply: "For a Suzuki Hayabusa, use our 10W-30 catalog oil."\nslugs:["tiger-10w30-sl-fully-synthetic"]',
            },
          },
        ],
      }),
    });
    const result = await provider.recommend('Hayabusa oil?', products);
    expect(result.provider).toBe('llm');
    expect(result.reply).toContain('Suzuki Hayabusa');
    expect(result.reply).not.toMatch(/slugs/i);
    expect(result.products[0]?.slug).toBe('tiger-10w30-sl-fully-synthetic');
    jest.restoreAllMocks();
  });
});
