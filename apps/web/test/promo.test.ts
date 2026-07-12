import { describe, it, expect } from 'vitest';
import { renderPromo, SLICEMARGIN_URL } from '../src/promo';

describe('renderPromo', () => {
  it('states the privacy guarantee in plain language', () => {
    const root = document.createElement('div');
    renderPromo(root);
    expect(root.textContent).toMatch(/never leaves your (computer|browser|machine)/i);
  });

  it('links to SliceMargin', () => {
    const root = document.createElement('div');
    renderPromo(root);
    const cta = root.querySelector<HTMLAnchorElement>('a[data-testid="slicemargin-cta"]');
    expect(cta).not.toBeNull();
    expect(cta!.href).toContain(SLICEMARGIN_URL);
    expect(cta!.rel).toContain('noopener');
  });

  // The guides are static pages outside the SPA. This link is the only path a
  // crawler has from the app to them, so it is a ranking dependency, not decor.
  // It must point at the guides INDEX: pointed at a single guide, every other
  // guide is an orphan with no inbound link, and an orphan page does not rank.
  it('links to the guides index so crawlers can reach every guide', () => {
    const root = document.createElement('div');
    renderPromo(root);
    const link = root.querySelector<HTMLAnchorElement>('a[data-testid="guides-link"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/guides/');
  });
});
