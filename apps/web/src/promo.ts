export const SLICEMARGIN_URL = 'https://slicemargin.com';

export function renderPromo(root: HTMLElement): void {
  const header = document.createElement('header');
  header.innerHTML = `
    <h1>Mesh Repair</h1>
    <p class="tagline">Fix broken STL and 3MF meshes so they slice and print.</p>
    <p class="privacy">Everything runs in your browser. Your model never leaves your computer.</p>
  `;

  const footer = document.createElement('footer');
  const cta = document.createElement('a');
  cta.dataset.testid = 'slicemargin-cta';
  cta.href = SLICEMARGIN_URL;
  cta.target = '_blank';
  cta.rel = 'noopener noreferrer';
  cta.textContent = 'Price your prints with SliceMargin';
  footer.append(cta);

  root.append(header, footer);
}
