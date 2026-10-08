import type { Fetch } from '../geo/wikidata.js';
import { AiBilledError } from './errors.js';
import { isRecord, readCapped } from './http.js';
import {
  type AiCitation,
  AiError,
  type AiProvider,
  type AiStructuredRequest,
  type AiStructuredResult,
  type AiUsage,
} from './provider.js';

// The AiProvider for Anthropic's Claude (Messages API). One request carries
// the answer tool (the model's reply is that tool's input, which callers
// validate with Zod) and, when asked, the server-side web search tool, which
// runs inside the same request: the model searches, then answers.

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
/** The plain web search (no code execution): measured at about 14k input tokens and 4 s. */
const WEB_SEARCH_TOOL = 'web_search_20250305';
const TIMEOUT_MS = 60_000;
/** Search results travel back in the response (encrypted): 3 searches weigh a few hundred KB. */
const MAX_BODY_BYTES = 8_000_000;
/** Citations returned at most. */
const MAX_CITATIONS = 20;

export interface AnthropicOptions {
  /** Sent as x-api-key; never logged and never put in an error. */
  apiKey: string;
  model: string;
  /** Tests inject a stub. */
  fetch?: Fetch;
  /** One request's deadline. */
  timeoutMs?: number;
  /** Larger answers are refused. */
  maxBodyBytes?: number;
  /**
   * How hard the model thinks (output_config.effort). Leave it out for models
   * without the setting. Claude Sonnet 5.5 thinks by default; `low` keeps a
   * grounded rewrite quick and cheap.
   */
  effort?: 'low' | 'medium' | 'high';
  /** Sampling temperature. Leave it out unless the model takes one: Claude Sonnet 5.5 refuses any but its default. */
  temperature?: number;
}

/** Anthropic's error `type` ("rate_limit_error"…) when the body has one: a fixed vocabulary, safe to log. */
function errorType(body: string | null): string | undefined {
  if (!body) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    const type =
      isRecord(parsed) && isRecord(parsed['error']) ? parsed['error']['type'] : undefined;
    return typeof type === 'string' && /^[a-z_]{1,40}$/.test(type) ? type : undefined;
  } catch {
    return undefined;
  }
}

/** The AiError for a non-2xx answer. 429 and 529 (overloaded) ask us to slow down; a refused key, billing or model is not coming back by itself. */
function failureOf(status: number, type: string | undefined): AiError {
  const message = `anthropic ${status}${type ? ` ${type}` : ''}`;
  if (status === 429 || status === 529) return new AiError('rate_limited', message);
  if ([401, 402, 403, 404].includes(status)) return new AiError('unavailable', message);
  return new AiError('failed', message);
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** Tokens and searches the response says it used (cache reads and writes count as input). */
function usageOf(usage: unknown): AiUsage {
  if (!isRecord(usage)) return { inputTokens: 0, outputTokens: 0, webSearches: 0 };
  const server = isRecord(usage['server_tool_use']) ? usage['server_tool_use'] : {};
  return {
    inputTokens:
      count(usage['input_tokens']) +
      count(usage['cache_creation_input_tokens']) +
      count(usage['cache_read_input_tokens']),
    outputTokens: count(usage['output_tokens']),
    webSearches: count(server['web_search_requests']),
  };
}

/** A source with an http(s) address; anything else (or no title) is dropped or filled in. */
function sourceOf(url: unknown, title: unknown): AiCitation | undefined {
  if (typeof url !== 'string') return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  return { title: typeof title === 'string' && title.trim() ? title : parsed.hostname, url };
}

/**
 * The pages the answer rests on: first those a text block cites, then every
 * result the searches returned, without repeats.
 */
function citationsOf(content: readonly unknown[]): AiCitation[] {
  const cited: AiCitation[] = [];
  const found: AiCitation[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block['type'] === 'text' && Array.isArray(block['citations'])) {
      for (const citation of block['citations']) {
        if (!isRecord(citation) || citation['type'] !== 'web_search_result_location') continue;
        const source = sourceOf(citation['url'], citation['title']);
        if (source) cited.push(source);
      }
    } else if (block['type'] === 'web_search_tool_result' && Array.isArray(block['content'])) {
      // On failure `content` is a single error object instead of a list.
      for (const result of block['content']) {
        if (!isRecord(result) || result['type'] !== 'web_search_result') continue;
        const source = sourceOf(result['url'], result['title']);
        if (source) found.push(source);
      }
    }
  }
  const seen = new Set<string>();
  return [...cited, ...found]
    .filter((source) => !seen.has(source.url) && seen.add(source.url))
    .slice(0, MAX_CITATIONS);
}

export function createAnthropicProvider(options: AnthropicOptions): AiProvider {
  const send = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  return {
    async structured(
      request: AiStructuredRequest,
      signal: AbortSignal,
    ): Promise<AiStructuredResult> {
      const { tool } = request;
      // Claude Sonnet 5.5 refuses a forced tool_choice (400), so the choice is
      // left to the model: the prompt tells it to answer through the tool, and
      // an answer without it is 'invalid_output' for the caller to retry.
      const body = {
        model: options.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        tools: [
          { name: tool.name, description: tool.description, input_schema: tool.inputSchema },
          ...(request.webSearch
            ? [{ type: WEB_SEARCH_TOOL, name: 'web_search', max_uses: request.webSearch.maxUses }]
            : []),
        ],
        tool_choice: { type: 'auto' },
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.effort ? { output_config: { effort: options.effort } } : {}),
      };
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);

      // Never the fetch error itself: it could echo the request.
      const interrupted = () =>
        new AiError(
          'failed',
          signal.aborted ? 'aborted' : deadline.aborted ? 'timeout' : 'network',
        );

      let response: Response;
      let text: string | null;
      try {
        response = await send(ENDPOINT, {
          method: 'POST',
          headers: {
            'x-api-key': options.apiKey,
            'anthropic-version': API_VERSION,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(body),
          redirect: 'error',
          signal: deadline,
        });
        text = await readCapped(response, options.maxBodyBytes ?? MAX_BODY_BYTES);
      } catch {
        throw interrupted();
      }
      if (!response.ok) throw failureOf(response.status, errorType(text));
      if (text === null) throw new AiError('failed', 'too_large');

      let message: unknown;
      try {
        message = JSON.parse(text);
      } catch {
        throw new AiError('failed', 'bad_response');
      }
      if (!isRecord(message) || !Array.isArray(message['content'])) {
        throw new AiError('failed', 'bad_response');
      }
      const content: unknown[] = message['content'];
      const usage = usageOf(message['usage']);
      // A refusal or a cut-off answer is no answer, whatever blocks came before.
      const stop = message['stop_reason'];
      if (stop === 'refusal' || stop === 'max_tokens') {
        throw new AiBilledError('invalid_output', `stopped: ${stop}`, usage);
      }
      const answer = content.find(
        (block) => isRecord(block) && block['type'] === 'tool_use' && block['name'] === tool.name,
      );
      if (!isRecord(answer) || !isRecord(answer['input'])) {
        throw new AiBilledError('invalid_output', 'no answer through the tool', usage);
      }
      return {
        input: answer['input'],
        citations: citationsOf(content),
        usage,
        model: typeof message['model'] === 'string' ? message['model'] : options.model,
      };
    },
  };
}
