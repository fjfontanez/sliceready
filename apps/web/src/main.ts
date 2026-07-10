import './styles.css';
import { renderPromo } from './promo';
import { mountDropzone } from './dropzone';
import { createRepairWorker, repairInWorker, type RepairResult } from './repair-client';
import { createViewer, type Viewer } from './viewer';
import { summarize } from './report';
import { downloadStl, repairedFileName } from './download';
import { downloadLabel, errorMessageFor, phaseLabel, validateFile, type AppState } from './state';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app not found');

renderPromo(root);

const status = document.createElement('p');
status.dataset.testid = 'status';
const notice = document.createElement('p');
notice.dataset.testid = 'notice';
const viewerHost = document.createElement('div');
viewerHost.className = 'viewer';
const actions = document.createElement('div');
actions.dataset.testid = 'actions';
root.append(status, notice, viewerHost, actions);

let viewer: Viewer | undefined;

// Each drop invalidates the one before it. Without this, a slow first repair can
// resolve after a second one and paint its mesh and summary over the newer file's.
let generation = 0;

function render(state: AppState): void {
  actions.replaceChildren();

  if (state.kind === 'idle') { status.textContent = ''; return; }
  if (state.kind === 'reading') { status.textContent = 'Reading the file…'; return; }
  if (state.kind === 'repairing') { status.textContent = phaseLabel(state.phase); return; }
  if (state.kind === 'error') { status.textContent = state.message; return; }

  const summary = summarize(state.result.report);
  status.textContent = summary.headline;

  for (const line of [...summary.fixed, ...summary.remaining, ...summary.notes, ...summary.warnings]) {
    const p = document.createElement('p');
    p.textContent = line;
    actions.append(p);
  }

  const beforeButton = document.createElement('button');
  beforeButton.textContent = 'Before';
  beforeButton.addEventListener('click', () => viewer?.toggle('before'));
  const afterButton = document.createElement('button');
  afterButton.textContent = 'After';
  afterButton.addEventListener('click', () => viewer?.toggle('after'));

  const download = document.createElement('button');
  // Offered even when summary.ok is false: the file is the user's either way.
  download.textContent = downloadLabel(summary.ok);
  download.addEventListener('click', () => downloadStl(state.result.stl, repairedFileName(state.fileName)));

  actions.append(beforeButton, afterButton, download);
}

async function handleFile(file: File): Promise<void> {
  const mine = ++generation;

  const validation = validateFile(file);
  if ('error' in validation) { render({ kind: 'error', message: validation.error }); return; }
  // Persistent, separate from `status`: render() overwrites status.textContent on
  // every state change, so a warning written there would be gone before the user
  // could read it. Cleared when there is no warning so a previous file's warning
  // does not linger onto this one.
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

mountDropzone(root, (file) => { void handleFile(file); });
render({ kind: 'idle' });
