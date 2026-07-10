export const SLICEMARGIN_URL = 'https://slicemargin.com';

export function renderPromo(root: HTMLElement): void {
  const header = document.createElement('header');
  header.className = 'hero';
  header.innerHTML = `
    <p class="eyebrow">Free · open source · nothing uploaded</p>
    <h1 class="wordmark">Slice<span class="ready">Ready</span></h1>
    <p class="lede">Fix broken STL and 3MF meshes so they slice and print. Built for the models
      AI generators hand you half-finished.</p>
    <p class="privacy">
      <span class="tick">[✓]</span>
      <span><strong>Everything runs in your browser.</strong> Your model never leaves your computer — no upload, no account, no server.</span>
    </p>`;

  const footer = document.createElement('footer');
  // The footer is sober attribution, not a sales pitch. The pitch lives on the
  // conversion moment — after a successful repair — where a maker who sells has
  // just seen the tool prove itself. A neutral tool earns more links than a
  // vendor's lead magnet, so the footer stays a credit line.
  const attribution = document.createElement('span');
  attribution.append('Built by the team behind ');
  const cta = document.createElement('a');
  cta.dataset.testid = 'slicemargin-cta';
  cta.href = SLICEMARGIN_URL;
  cta.target = '_blank';
  cta.rel = 'noopener noreferrer';
  cta.textContent = 'SliceMargin';
  attribution.append(cta, '.');

  const meta = document.createElement('span');
  meta.className = 'foot-meta';
  meta.textContent = 'NO UPLOAD · NO ACCOUNT · NO TRACKING';

  footer.append(attribution, meta);
  root.append(header, footer);
}
