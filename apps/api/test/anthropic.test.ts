import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from '../src/ai/anthropic.js';
import { AiBilledError } from '../src/ai/errors.js';
import { AiError, type AiStructuredRequest } from '../src/ai/provider.js';
import type { Fetch } from '../src/geo/wikidata.js';

// The Anthropic provider against a stubbed fetch: the request it sends, how it
// reads the answer, and what each failure becomes. No test touches the network.

// Made up for the tests (a literal that looks like a real key would trip the
// secret scan of the repository's history).
const KEY = ['test', 'key', 'for', 'the', 'stub'].join('-');
const PROMPT = 'Write the card of the castle.';

const request: AiStructuredRequest = {
  system: 'You are a guide.',
  prompt: PROMPT,
  tool: {
    name: 'write_card',
    description: 'Writes the card.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
  },
  maxTokens: 1000,
};

const signal = () => new AbortController().signal;

const USAGE = { input_tokens: 1200, output_tokens: 300 };
const toolUse = (input: unknown = { title: 'Castelo' }, name = 'write_card') => ({
  type: 'tool_use',
  id: 'toolu_1',
  name,
  input,
});
const message = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  content,
  stop_reason: 'tool_use',
  usage: USAGE,
  ...extra,
});

/** A fetch that answers with `body` (JSON) and remembers what it was asked. */
function answering(body: unknown, status = 200) {
  return vi.fn<Fetch>(async () => Response.json(body, { status }));
}

const provider = (
  fetch: Fetch,
  options: Partial<Parameters<typeof createAnthropicProvider>[0]> = {},
) => createAnthropicProvider({ apiKey: KEY, model: 'claude-sonnet-5-5', fetch, ...options });

describe('the request', () => {
  it('posts the answer tool to the Messages API with the key, the version and no redirects', async () => {
    const fetch = answering(message([toolUse()]));
    await provider(fetch).structured(request, signal());

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      accept: 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 1000,
      system: 'You are a guide.',
      messages: [{ role: 'user', content: PROMPT }],
      tools: [
        {
          name: 'write_card',
          description: 'Writes the card.',
          input_schema: request.tool.inputSchema,
        },
      ],
      // Claude Sonnet 5.5 refuses a forced tool choice, and any temperature but its own.
      tool_choice: { type: 'auto' },
    });
  });

  it('adds the web search tool when asked, and the effort and temperature it is configured with', async () => {
    const fetch = answering(message([toolUse()]));
    await provider(fetch, { effort: 'low', temperature: 0.3 }).structured(
      { ...request, webSearch: { maxUses: 3 } },
      signal(),
    );
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.tools).toEqual([
      expect.objectContaining({ name: 'write_card' }),
      { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
    ]);
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.temperature).toBe(0.3);
  });
});

describe('the answer', () => {
  it("is the answer tool's input, with the usage and the model that answered", async () => {
    const fetch = answering(
      message([toolUse({ title: 'Castelo', facts: [] })], {
        model: 'claude-sonnet-5-5-20261001',
        usage: {
          input_tokens: 1000,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
          output_tokens: 300,
          server_tool_use: { web_search_requests: 2 },
        },
      }),
    );
    const result = await provider(fetch).structured(request, signal());
    expect(result.input).toEqual({ title: 'Castelo', facts: [] });
    expect(result.usage).toEqual({ inputTokens: 1150, outputTokens: 300, webSearches: 2 });
    expect(result.model).toBe('claude-sonnet-5-5-20261001');
    expect(result.citations).toEqual([]);
  });

  it('skips thinking and text blocks, and only takes a call to its own tool', async () => {
    const fetch = answering(
      message([
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'Let me write it.' },
        toolUse({ title: 'Other' }, 'some_other_tool'),
        toolUse({ title: 'Castelo' }),
      ]),
    );
    expect((await provider(fetch).structured(request, signal())).input).toEqual({
      title: 'Castelo',
    });
  });

  it('collects the sources: cited pages first, then every search result, without repeats', async () => {
    const castle = 'https://www.visitleiria.pt/castelo';
    const wiki = 'https://pt.wikipedia.org/wiki/Castelo_de_Leiria';
    const fetch = answering(
      message(
        [
          { type: 'text', text: 'Searching.' },
          { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'x' } },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_1',
            content: [
              { type: 'web_search_result', url: wiki, title: 'Castelo de Leiria - Wikipédia' },
              { type: 'web_search_result', url: castle, title: 'Castelo de Leiria' },
              { type: 'web_search_result', url: 'ftp://files.example/castle', title: 'Not a page' },
              { type: 'web_search_result', url: 'not a url', title: 'Broken' },
              { type: 'web_search_result', url: 'https://example.org/no-title' },
            ],
          },
          // A failed search answers with an error object where the results go.
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_2',
            content: { type: 'web_search_tool_result_error', error_code: 'unavailable' },
          },
          {
            type: 'text',
            text: 'It stands over the river.',
            citations: [
              {
                type: 'web_search_result_location',
                url: castle,
                title: 'Castelo de Leiria (cited)',
                cited_text: '…',
              },
              { type: 'char_location', cited_text: 'other kinds are not search results' },
            ],
          },
          toolUse(),
        ],
        { usage: { ...USAGE, server_tool_use: { web_search_requests: 1 } } },
      ),
    );
    const result = await provider(fetch).structured(
      { ...request, webSearch: { maxUses: 3 } },
      signal(),
    );
    expect(result.citations).toEqual([
      { title: 'Castelo de Leiria (cited)', url: castle },
      { title: 'Castelo de Leiria - Wikipédia', url: wiki },
      { title: 'example.org', url: 'https://example.org/no-title' },
    ]);
    expect(result.usage.webSearches).toBe(1);
  });
});

describe('an answer that is no answer', () => {
  const unusable = async (body: unknown) => {
    const error = await provider(answering(body))
      .structured(request, signal())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    return error as AiError;
  };

  it('is invalid_output when the model did not call the tool, and its usage still counts', async () => {
    const error = await unusable(
      message([{ type: 'text', text: 'Here is a card: …' }], { stop_reason: 'end_turn' }),
    );
    expect(error.reason).toBe('invalid_output');
    expect(error).toBeInstanceOf(AiBilledError);
    expect((error as AiBilledError).usage).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      webSearches: 0,
    });
    expect((await unusable(message([toolUse('not an object' as never)]))).reason).toBe(
      'invalid_output',
    );
  });

  it('is invalid_output when the model refused or ran out of tokens, whatever came before', async () => {
    for (const stop_reason of ['refusal', 'max_tokens']) {
      const error = await unusable(message([toolUse()], { stop_reason }));
      expect(error.reason).toBe('invalid_output');
      expect(error.message).toContain(stop_reason);
    }
  });

  it('is failed when the body is not a message', async () => {
    expect((await unusable({ content: 'nope' })).reason).toBe('failed');
    const html = vi.fn<Fetch>(async () => new Response('<html>oops</html>', { status: 200 }));
    const error = await provider(html)
      .structured(request, signal())
      .catch((e: unknown) => e);
    expect((error as AiError).reason).toBe('failed');
  });

  it('is failed when the body is larger than the provider takes', async () => {
    const big = answering(message([toolUse({ title: 'x'.repeat(5000) })]));
    const error = await provider(big, { maxBodyBytes: 1000 })
      .structured(request, signal())
      .catch((e: unknown) => e);
    expect((error as AiError).reason).toBe('failed');
    expect((error as AiError).message).toBe('too_large');
  });
});

describe('failures', () => {
  const errorBody = (type: string) => ({
    type: 'error',
    error: { type, message: `Detail that may echo the prompt: ${PROMPT}` },
  });

  it.each([
    [429, 'rate_limit_error', 'rate_limited'],
    [529, 'overloaded_error', 'rate_limited'],
    [401, 'authentication_error', 'unavailable'],
    [402, 'billing_error', 'unavailable'],
    [403, 'permission_error', 'unavailable'],
    [404, 'not_found_error', 'unavailable'],
    [400, 'invalid_request_error', 'failed'],
    [413, 'request_too_large', 'failed'],
    [500, 'api_error', 'failed'],
  ])(
    'turns HTTP %i (%s) into %s, without the prompt or the key in the message',
    async (status, type, reason) => {
      const error = await provider(answering(errorBody(type), status))
        .structured(request, signal())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiError);
      expect((error as AiError).reason).toBe(reason);
      expect((error as AiError).message).toBe(`anthropic ${status} ${type}`);
      expect((error as AiError).message).not.toContain(PROMPT);
      expect((error as AiError).message).not.toContain(KEY);
    },
  );

  it('does not repeat an error type outside the known vocabulary', async () => {
    const error = await provider(answering(errorBody('Some <odd> type with the prompt'), 500))
      .structured(request, signal())
      .catch((e: unknown) => e);
    expect((error as AiError).message).toBe('anthropic 500');
  });

  it('is failed when the network breaks, with nothing of the request in the message', async () => {
    const broken = vi.fn<Fetch>(async () => {
      throw new TypeError(`fetch failed for ${KEY} ${PROMPT}`);
    });
    const error = await provider(broken)
      .structured(request, signal())
      .catch((e: unknown) => e);
    expect((error as AiError).reason).toBe('failed');
    expect((error as AiError).message).toBe('network');
  });

  it('stops when the caller goes away and when the deadline passes', async () => {
    const hanging = vi.fn<Fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const stop = () => reject(new DOMException('aborted', 'AbortError'));
          if (init.signal?.aborted) stop();
          else init.signal?.addEventListener('abort', stop);
        }),
    );
    const controller = new AbortController();
    const gone = provider(hanging).structured(request, controller.signal);
    controller.abort();
    await expect(gone).rejects.toMatchObject({ reason: 'failed', message: 'aborted' });

    await expect(
      provider(hanging, { timeoutMs: 20 }).structured(request, signal()),
    ).rejects.toMatchObject({ reason: 'failed', message: 'timeout' });
  });
});
