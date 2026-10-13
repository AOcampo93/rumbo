import { GoogleGenAI, type LiveConnectConfig, type LiveServerMessage } from '@google/genai';

// The seam between the voice endpoint and Gemini's Live API: the endpoint
// only knows this small interface, so tests bring a fake.

export interface LiveRealtimeInput {
  audio?: { data: string; mimeType: string };
  activityStart?: Record<string, never>;
  activityEnd?: Record<string, never>;
}

export interface LiveClientContent {
  turns: { role: 'user'; parts: { text: string }[] }[];
  turnComplete: boolean;
}

export interface LiveSessionHandle {
  sendRealtimeInput(input: LiveRealtimeInput): void;
  sendClientContent(content: LiveClientContent): void;
  close(): void;
}

export interface LiveCallbacks {
  onmessage(message: LiveServerMessage): void;
  onerror(error: unknown): void;
  onclose(): void;
}

export interface LiveConnectRequest {
  model: string;
  config: LiveConnectConfig;
}

export interface LiveConnector {
  connect(request: LiveConnectRequest, callbacks: LiveCallbacks): Promise<LiveSessionHandle>;
}

/** The real connector, over the official SDK. The key never leaves this closure. */
export function createGeminiLiveConnector(apiKey: string): LiveConnector {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async connect({ model, config }, callbacks) {
      const session = await ai.live.connect({
        model,
        config,
        callbacks: {
          onmessage: (message) => callbacks.onmessage(message),
          onerror: (event) => callbacks.onerror(event),
          onclose: () => callbacks.onclose(),
        },
      });
      return {
        sendRealtimeInput: (input) => session.sendRealtimeInput(input),
        sendClientContent: (content) => session.sendClientContent(content),
        close: () => session.close(),
      };
    },
  };
}
