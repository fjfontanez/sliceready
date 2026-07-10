// Fonts are self-hosted via @fontsource, emitted to dist/assets by Vite. The page
// promises the model never leaves the browser; loading a font from a CDN would hand
// the visitor's IP to a third party on every page view, which is the same promise
// broken for type instead of geometry.
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';

import { renderPromo, SLICEMARGIN_URL } from './promo';
import { mountDropzone } from './dropzone';
import { createRepairWorker, repairInWorker, type RepairResult, type ManifoldReport, type Phase } from './repair-client';
import { createViewer, type Viewer } from './viewer';
import { summarize } from './report';
import { downloadStl, repairedFileName } from './download';
import { downloadLabel, errorMessageFor, phaseLabel, validateFile, type AppState } from './state';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app not found');

// promo appends the hero <header> and the <footer>. The working area belongs
// between them, so it is inserted before the footer rather than appended after —
// appending to root would leave the footer sandwiched in the middle of the page.
renderPromo(root);
const work = document.createElement('main');
work.className = 'work';
root.querySelector('footer')!.before(work);

// Dropzone first (the idle state), then the status line, the viewer, and the
// results. mountDropzone appends, so it must be called before the rest.
mountDropzone(work, (file) => { void handleFile(file); });

const status = document.createElement('p');
status.dataset.testid = 'status';
status.className = 'status';
const notice = document.createElement('p');
notice.dataset.testid = 'notice';
notice.className = 'notice';
const viewerHost = document.createElement('div');
viewerHost.className = 'viewer-frame';
const results = document.createElement('div');
results.dataset.testid = 'actions';
results.className = 'results';
work.append(status, notice, viewerHost, results);

let viewer: Viewer | undefined;

// Each drop invalidates the one before it. Without this, a slow first repair can
// resolve after a second one and paint its mesh and summary over the newer file's.
let generation = 0;

const PHASES: readonly Phase[] = ['parse', 'analyze-before', 'repair', 'analyze-after', 'export'];

// The five phases drawn as an extrusion line: a molten bead up to the current
// phase, a glowing hot point at its head. The `repair` phase is one opaque WASM
// call with no progress inside it — the note says so rather than faking a crawl.
function renderRepairing(phase: Phase): void {
  status.replaceChildren();
  const index = PHASES.indexOf(phase);
  const pct = ((index + 0.5) / PHASES.length) * 100;

  const line = document.createElement('div');
  line.className = 'extrusion';
  line.style.setProperty('--head', `${pct}%`);
  line.innerHTML = '<div class="bead"></div><div class="hot-point"></div>';

  const list = document.createElement('ul');
  list.className = 'phase-list';
  PHASES.forEach((p, i) => {
    const li = document.createElement('li');
    li.textContent = p.replace('analyze-', '').replace('-', ' ');
    if (i < index) li.className = 'done';
    else if (i === index) li.className = 'active';
    list.append(li);
  });

  const note = document.createElement('p');
  note.className = 'phase-note';
  note.textContent = phaseLabel(phase);

  status.append(line, list, note);
}

// The defect ledger: the counters are the product, so they read like a slicer log —
// monospaced, right-aligned, before in oxblood, after in ink. `67 → 2` is the proof.
const LEDGER_ROWS: ReadonlyArray<[label: string, key: keyof ManifoldReport]> = [
  ['Open edges', 'openEdges'],
  ['Flipped edges', 'flippedEdges'],
  ['Complex edges', 'complexEdges'],
  ['Non-manifold total', 'nonManifoldEdges'],
];

function buildLedger(before: ManifoldReport, after: ManifoldReport): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'ledger';
  table.innerHTML = `
    <caption>Defect ledger</caption>
    <thead><tr><th>Defect</th><th>Before</th><th></th><th>After</th></tr></thead>
    <tbody></tbody>`;
  const body = table.querySelector('tbody')!;
  for (const [label, key] of LEDGER_ROWS) {
    const b = before[key] as number;
    const a = after[key] as number;
    const row = document.createElement('tr');
    const afterClass = a === 0 ? 'after zero' : 'after';
    row.innerHTML =
      `<td>${label}</td><td class="before">${b}</td><td class="arrow">→</td><td class="${afterClass}">${a}</td>`;
    body.append(row);
  }
  return table;
}

// The conversion moment: shown only after a passing repair, and phrased as a
// question that segments. A hobbyist reads it and scrolls past; a maker who sells
// stops, because they just read their own problem, from someone who has already
// proven they know the domain.
function buildQualify(): HTMLElement {
  const box = document.createElement('aside');
  box.className = 'qualify';
  const cta = document.createElement('a');
  cta.dataset.testid = 'qualify-cta';
  cta.href = SLICEMARGIN_URL;
  cta.target = '_blank';
  cta.rel = 'noopener noreferrer';
  cta.textContent = 'See what this print actually costs you';
  box.innerHTML =
    '<p class="ask">Printing this one to sell?</p>' +
    '<p>Most makers underprice by forgetting machine wear, failed prints, and their own time. ' +
    'The filament is the cheapest part.</p>';
  box.append(cta);
  return box;
}

function render(state: AppState): void {
  results.replaceChildren();

  if (state.kind === 'idle') { status.replaceChildren(); return; }
  if (state.kind === 'reading') { status.replaceChildren('Reading the file…'); return; }
  if (state.kind === 'repairing') { renderRepairing(state.phase); return; }
  if (state.kind === 'error') { status.replaceChildren(); status.textContent = state.message; return; }

  const summary = summarize(state.result.report);
  status.replaceChildren();
  const headline = document.createElement('h2');
  headline.className = summary.ok ? 'headline' : 'headline failed';
  headline.innerHTML = `<span class="tick">${summary.ok ? '[✓]' : '[!]'}</span>`;
  headline.append(summary.headline);
  status.append(headline);

  results.append(buildLedger(state.result.report.before, state.result.report.after));

  if (summary.fixed.length || summary.remaining.length || summary.notes.length || summary.warnings.length) {
    const lines = document.createElement('ul');
    lines.className = 'fixed-list';
    for (const line of [...summary.fixed, ...summary.remaining, ...summary.notes, ...summary.warnings]) {
      const li = document.createElement('li');
      li.textContent = line;
      lines.append(li);
    }
    results.append(lines);
  }

  const bar = document.createElement('div');
  bar.className = 'actions';
  const toggle = document.createElement('div');
  toggle.className = 'toggle';
  const beforeButton = document.createElement('button');
  beforeButton.textContent = 'Before';
  beforeButton.setAttribute('aria-pressed', 'true');
  const afterButton = document.createElement('button');
  afterButton.textContent = 'After';
  afterButton.setAttribute('aria-pressed', 'false');
  const setView = (which: 'before' | 'after') => {
    viewer?.toggle(which);
    beforeButton.setAttribute('aria-pressed', String(which === 'before'));
    afterButton.setAttribute('aria-pressed', String(which === 'after'));
  };
  beforeButton.addEventListener('click', () => setView('before'));
  afterButton.addEventListener('click', () => setView('after'));
  toggle.append(beforeButton, afterButton);

  const download = document.createElement('button');
  download.className = 'btn btn-primary';
  // Offered even when summary.ok is false: the file is the user's either way.
  download.textContent = downloadLabel(summary.ok);
  download.addEventListener('click', () => downloadStl(state.result.stl, repairedFileName(state.fileName)));

  bar.append(toggle, download);
  results.append(bar);

  if (summary.ok) results.append(buildQualify());
}

async function handleFile(file: File): Promise<void> {
  const mine = ++generation;

  const validation = validateFile(file);
  if ('error' in validation) { render({ kind: 'error', message: validation.error }); return; }
  // Persistent, separate from `status`: render() rewrites status on every state
  // change, so a warning written there would be gone before the user could read
  // it. Cleared when there is no warning so a previous file's does not linger.
  notice.textContent = 'warning' in validation ? validation.warning : '';

  render({ kind: 'reading' });
  let worker: Worker | undefined;

  try {
    // Must read the bytes inside the try: File.arrayBuffer() can reject with a
    // NotReadableError if the file was moved, deleted, or lost permission after
    // being selected. Reading it outside the try let that rejection escape
    // uncaught, leaving the UI stuck on "Reading the file…" forever. Do not
    // "tidy" this back above the try.
    const bytes = await file.arrayBuffer();
    if (mine !== generation) return; // a newer drop has already superseded this one

    worker = createRepairWorker();
    const result: RepairResult = await repairInWorker(worker, bytes, validation.kind, {
      onPhase: (phase) => { if (mine === generation) render({ kind: 'repairing', phase }); },
    });
    if (mine !== generation) return;

    viewer?.dispose();
    // The frame must have a height before createViewer reads host.clientHeight —
    // three.js sizes its WebGL canvas from it at construction. Add the class first.
    viewerHost.classList.add('has-mesh');
    viewer = createViewer(viewerHost);
    viewer.show(result.beforeMesh, result.afterMesh, result.report.before.defectEdges);
    render({ kind: 'done', result, fileName: file.name });
  } catch (error) {
    if (mine !== generation) return;
    render({ kind: 'error', message: errorMessageFor(error) });
  } finally {
    // repairInWorker already terminates on failure; this covers the happy path.
    // terminate() is a no-op on an already-terminated worker. A stale (superseded)
    // repair is still terminated here even though it no longer paints.
    worker?.terminate();
  }
}

render({ kind: 'idle' });
