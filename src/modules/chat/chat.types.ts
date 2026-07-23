export interface ChatProductCard {
  slug: string;
  name: string;
  productCode?: string;
  categoryLabel?: string;
  image?: { url: string; alt?: string };
  price?: { formatted?: string; amount?: number; currency?: string };
  viewHref?: string;
  badges?: string[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatUsage {
  identity: 'user' | 'guest';
  limit: number;
  remaining: number;
  resetAt: string;
  burstLimit: number;
  burstRemaining: number;
}

export interface ChatMessageResult {
  sessionId: string;
  reply: string;
  products: ChatProductCard[];
  provider: 'rules' | 'llm';
  usage?: ChatUsage;
}
