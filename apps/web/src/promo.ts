export const SLICEMARGIN_URL = 'https://slicemargin.com';

// The hero and the footer used to be built here at runtime. They are static markup
// in index.html now, because rendering them from JavaScript left the initial
// document as an empty <div id="app"> — a crawler, a text browser or a reader with
// no JS got a <title> and nothing else, on the site's most valuable URL. Prose that
// has to be readable without JavaScript belongs in the HTML, not in a render call.
//
// What stays here is the SliceMargin URL, which main.ts needs for the CTA it shows
// after a successful repair. That one is deliberately NOT static: it belongs to the
// conversion moment, shown to a maker who has just watched the tool prove itself,
// and it should not exist on the page before then. The footer credit line is a
// different thing — sober attribution, and it ships in the HTML.
