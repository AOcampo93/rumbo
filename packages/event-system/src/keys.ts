/**
 * Every i18n key this package hands to the UI. The web's catalogs (es, en, pt)
 * must define all of them; a CI test will check it once the catalogs exist.
 *
 * Parameter conventions: `name` is a LocalizedText (a point's name), so the UI
 * resolves it in the active language; `distance` is in metres and `minutes`
 * is a number, both formatted by the UI for that language.
 */
export const UI_TEXT_KEYS = [
  'run.approaching',
  'run.backOnTrack',
  'notify.arrive',
  'notify.outOfOrder',
  'notify.deviation',
  'notify.idle',
  'notify.timeout',
  'notify.finish',
  'notify.generic',
  'notify.tapToOpen',
  'decision.deviation.title',
  'decision.deviation.body',
  'decision.deviation.primary',
  'decision.idle.title',
  'decision.idle.body',
  'decision.idle.primary',
  'decision.outOfOrder.title',
  'decision.outOfOrder.body',
  'decision.outOfOrder.primary',
  'decision.timeout.title',
  'decision.timeout.body',
  'decision.timeout.primary',
  'decision.continue',
  'end.confirm.title',
  'end.confirm.body',
  'end.confirm.yes',
  'end.confirm.no',
  'redirect.title',
  'redirect.body',
  'redirect.open',
  'redirect.later',
] as const;

export type UiTextKey = (typeof UI_TEXT_KEYS)[number];
