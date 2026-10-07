import type { MarkerPopup } from './types.ts';

// Content of the ArcGIS popup (DESIGN §6.3): a compact card with the photo
// (16:9), the name, category/state chips, the distance and the actions. Plain
// DOM, because the SDK renders it inside its own popup.

/**
 * The card's own CSS. The SDK puts popup content inside a shadow root, where
 * global stylesheets don't reach; CSS variables (our tokens) still do.
 */
const POPUP_CSS = `
.rmb-popup { font-family: var(--font-ui); color: var(--color-text); width: 100%; }
.rmb-popup__media { position: relative; margin: 0; aspect-ratio: 16 / 9; overflow: hidden;
  border-radius: var(--radius-sm); background: var(--color-surface-2); }
.rmb-popup__media img { display: block; width: 100%; height: 100%; object-fit: cover; }
.rmb-popup__credit { position: absolute; right: 6px; bottom: 6px; max-width: calc(100% - 12px);
  padding: 2px 6px; border-radius: 4px; background: rgba(22, 25, 29, 0.7); color: #fff;
  font: 500 10px/14px var(--font-ui); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rmb-popup__body { display: flex; flex-direction: column; gap: 8px; padding: 10px 2px 2px; }
.rmb-popup__kicker { margin: 0; color: var(--color-text-muted); font: 600 11px/14px var(--font-ui);
  letter-spacing: 0.04em; text-transform: uppercase; }
.rmb-popup__title { margin: 0; color: var(--color-text); font: 600 17px/22px var(--font-display); }
.rmb-popup__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.rmb-popup__chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px;
  border-radius: var(--radius-xs); background: var(--color-surface-2); color: var(--color-text);
  font: 600 12px/16px var(--font-ui); }
.rmb-popup__dot { width: 8px; height: 8px; border-radius: 50%; }
.rmb-popup__distance { margin: 0; color: var(--color-text-muted); font: 400 14px/20px var(--font-ui); }
.rmb-popup__actions { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
.rmb-popup__btn { display: flex; align-items: center; justify-content: center; min-height: 44px;
  padding: 0 16px; border: 1px solid var(--color-border); border-radius: var(--radius-pill);
  background: var(--color-surface); color: var(--color-text); font: 600 15px/20px var(--font-ui);
  text-decoration: none; cursor: pointer; }
.rmb-popup__btn.is-primary { border-color: var(--color-primary); background: var(--color-primary);
  color: var(--color-on-primary); }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function popupContent(popup: MarkerPopup, onAction: (action: string) => void): HTMLElement {
  const card = el('div', 'rmb-popup');
  card.append(el('style', undefined, POPUP_CSS));

  if (popup.image) {
    const figure = el('figure', 'rmb-popup__media');
    const img = el('img');
    img.src = popup.image.url;
    img.alt = popup.image.alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    figure.append(img);
    if (popup.image.credit)
      figure.append(el('figcaption', 'rmb-popup__credit', popup.image.credit));
    card.append(figure);
  }

  const body = el('div', 'rmb-popup__body');
  if (popup.kicker) body.append(el('p', 'rmb-popup__kicker', popup.kicker));
  body.append(el('h3', 'rmb-popup__title', popup.title));

  if (popup.chips.length > 0) {
    const chips = el('div', 'rmb-popup__chips');
    for (const chip of popup.chips) {
      const node = el('span', 'rmb-popup__chip');
      if (chip.color) {
        const dot = el('span', 'rmb-popup__dot');
        dot.style.background = chip.color;
        node.append(dot);
      }
      node.append(document.createTextNode(chip.label));
      chips.append(node);
    }
    body.append(chips);
  }

  if (popup.distance) body.append(el('p', 'rmb-popup__distance', popup.distance));

  if (popup.actions.length > 0) {
    const actions = el('div', 'rmb-popup__actions');
    for (const action of popup.actions) {
      const className = `rmb-popup__btn${action.primary ? ' is-primary' : ''}`;
      if (action.href) {
        const link = el('a', className, action.label);
        link.href = action.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        actions.append(link);
        continue;
      }
      const button = el('button', className, action.label);
      button.type = 'button';
      button.addEventListener('click', () => onAction(action.id));
      actions.append(button);
    }
    body.append(actions);
  }

  card.append(body);
  return card;
}
