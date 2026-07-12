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

  // The honesty rule reaches the shop window too. The home page names the three
  // faults the engine actually repairs — and names the ones it does not, rather
  // than leaving the reader to assume. Asserting the DISCLAIMER, not the absence
  // of the words: an earlier version of this test banned "thin wall" outright,
  // which would have failed the page for being more honest, not less.
  it('names the three repairs it performs, and disclaims the ones it does not', () => {
    expect(text).toMatch(/open edges/i);
    expect(text).toMatch(/normals/i);
    expect(text).toMatch(/degenerate triangles/i);
    expect(text).toMatch(/does not thicken thin walls, hollow, remesh or rescale/i);
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

  // "so they slice and print" promised an outcome the tool does not control.
  // Slicing cleanly is ours to deliver. Whether it PRINTS depends on wall
  // thickness, orientation, supports and slicer settings — none of which this
  // tool touches. Promise the part we own.
  it('does not promise a successful print, only a clean slice', () => {
    const desc = doc.querySelector('meta[name=description]')?.getAttribute('content') ?? '';
    const claims = `${doc.title} ${desc} ${text}`;
    expect(claims).not.toMatch(/slice and print|print-ready|ready to print/i);
  });

  // The open-source claim is the differentiator the comparison guides lean on
  // hardest — "every other browser tool asks you to believe its privacy claim;
  // ours you can read". A claim nobody can check is just a better-sounding
  // promise. The link is what turns it into a fact.
  it('links to the source, so the open-source claim can be checked', () => {
    const repo = doc.querySelector<HTMLAnchorElement>('a[data-testid="source-link"]');
    expect(repo).not.toBeNull();
    expect(repo!.getAttribute('href')).toContain('github.com/fjfontanez/sliceready');
    expect(repo!.getAttribute('rel')).toContain('noopener');
  });

  // A 3MF can carry colour, materials and several objects. What comes back is a
  // repaired STL, which carries none of them. Say so where the file is dropped,
  // not three clicks away inside a guide.
  it('states what goes in and what comes out', () => {
    expect(text).toMatch(/STL or 3MF/i);
    expect(text).toMatch(/repaired STL/i);
  });
});
