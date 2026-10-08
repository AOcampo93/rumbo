import { AiError, type AiUsage } from './provider.js';

/**
 * An AiError for a call that was billed all the same: the model answered, but
 * not usably (a refusal, a cut-off answer, no answer through the tool). The
 * usage still counts against the budget.
 */
export class AiBilledError extends AiError {
  readonly usage: AiUsage;

  constructor(reason: AiError['reason'], message: string, usage: AiUsage) {
    super(reason, message);
    this.name = 'AiBilledError';
    this.usage = usage;
  }
}

/** What a failed call used, when the provider says: nothing known otherwise. */
export const billedBy = (error: unknown): AiUsage | undefined =>
  error instanceof AiBilledError ? error.usage : undefined;
