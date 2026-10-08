// The generative AI behind the cards and the suggestions (PROJECT_PLAN §12),
// as one narrow interface: the routes never talk to a vendor's API directly,
// and tests use a fake. The implementation for Anthropic's Claude lives in
// anthropic.ts; AI_PROVIDER picks it.

/** What a call used; the API turns it into a cost estimate for the daily budget. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
}

/** A source the answer relied on (web search results it cited). */
export interface AiCitation {
  title: string;
  url: string;
}

export interface AiStructuredRequest {
  system: string;
  prompt: string;
  /** The one tool the model must call with its answer; `inputSchema` is a JSON Schema. */
  tool: { name: string; description: string; inputSchema: Record<string, unknown> };
  maxTokens: number;
  /** Lets the model search the web first (the provider's server-side search), then answer. */
  webSearch?: { maxUses: number };
}

export interface AiStructuredResult {
  /** The answer tool's input, unchecked: callers validate it with Zod. */
  input: unknown;
  citations: AiCitation[];
  usage: AiUsage;
  /** The model that answered (for the card's `generated.model`). */
  model: string;
}

export interface AiProvider {
  structured(request: AiStructuredRequest, signal: AbortSignal): Promise<AiStructuredResult>;
}

/**
 * Why a call failed: 'unavailable' (bad or missing key), 'rate_limited' (the
 * provider asked us to slow down), 'invalid_output' (no usable answer) or
 * 'failed' (anything else, timeouts included). Never carries the key or the prompt.
 */
export class AiError extends Error {
  readonly reason: 'unavailable' | 'rate_limited' | 'invalid_output' | 'failed';

  constructor(reason: AiError['reason'], message: string = reason) {
    super(message);
    this.name = 'AiError';
    this.reason = reason;
  }
}

/** One AI call as the budget records it. */
export interface AiCallRecord {
  deviceId: string | null;
  kind: 'card' | 'suggest';
  cacheKey: string | null;
  locale: string;
  model: string;
  usage: AiUsage;
  status: 'ok' | 'failed';
  latencyMs: number;
}

/**
 * Spending control shared by every AI endpoint (built over ai_generations):
 * `check` throws the 429 ApiFailure (ai_budget_exceeded or ai_device_limit)
 * when no more calls are allowed today; `record` logs a call and its cost.
 */
export interface AiBudget {
  check(deviceId: string): Promise<void>;
  record(call: AiCallRecord): Promise<void>;
}
