import { describe, it, expect } from 'vitest';
// ?raw hands us the file's bytes, untouched — not a DOM our own code built. That
// distinction is the whole point: a test that renders the app would pass while the
// document a crawler downloads stayed empty, which is exactly the bug below.
import html from '../index.html?raw';
import { SLICEMARGIN_URL } from '../src/promo';

// The home page is the site's most valuable URL and the one a crawler reaches
// first. Built from JavaScript, its initial HTML was an empty <div id="app">: a
// text-mode fetch saw a title and nothing else.
const doc = new DOMParser().parseFromString(html, 'text/html');
// Collapse the source's line wrapping: these assertions are about what the page
// says, not about where the HTML happens to break a line.
const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ');

describe('the shipped index.html', () => {
  it('carries an h1 in the initial HTML, with no JavaScript run', () => {
    const h1 = doc.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toMatch(/SliceReady/i);
  });

  it('states the privacy guarantee in the initial HTML', () => {
    expect(text).toMatch(/never leaves your (computer|browser|machine)/i);
  });

  it('says what the tool actually does, in prose a crawler can read', () => {
    expect(text).toMatch(/STL/i);
    expect(text).toMatch(/3MF/i);
    expect(text).toMatch(/browser/i);
  });

  // The honesty rule reaches the shop window too: the home page names the three
  // faults the engine actually repairs, and no others.
  it('names only the repairs the engine actually performs', () => {
    expect(text).toMatch(/open edges/i);
    expect(text).toMatch(/normals/i);
    expect(text).toMatch(/degenerate triangles/i);
    expect(text).not.toMatch(/thin wall|hollow|remesh|self-intersect/i);
  });

  it('links to the guides so a crawler can reach them from the root', () => {
    const link = doc.querySelector<HTMLAnchorElement>('a[data-testid="guides-link"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/guides/');
  });

  it('credits SliceMargin', () => {
    const cta = doc.querySelector<HTMLAnchorElement>('a[data-testid="slicemargin-cta"]');
    expect(cta).not.toBeNull();
    expect(cta!.getAttribute('href')).toContain(SLICEMARGIN_URL);
    expect(cta!.getAttribute('rel')).toContain('noopener');
  });
});
