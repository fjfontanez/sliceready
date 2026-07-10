import './styles.css';
import { renderPromo } from './promo';
import { mountDropzone } from './dropzone';
import { createRepairWorker, repairInWorker, type RepairResult } from './repair-client';
import { createViewer, type Viewer } from './viewer';
import { summarize } from './report';
import { downloadStl, repairedFileName } from './download';
import { errorMessageFor, phaseLabel, validateFile, type AppState } from './state';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app not found');

renderPromo(root);

const status = document.createElement('p');
status.dataset.testid = 'status';
const viewerHost = document.createElement('div');
viewerHost.className = 'viewer';
const actions = document.createElement('div');
actions.dataset.testid = 'actions';
root.append(status, viewerHost, actions);

let viewer: Viewer | undefined;

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
  download.textContent = 'Download repaired STL';
  download.addEventListener('click', () => downloadStl(state.result.stl, repairedFileName(state.fileName)));

  actions.append(beforeButton, afterButton, download);
}

async function handleFile(file: File): Promise<void> {
  const validation = validateFile(file);
  if ('error' in validation) { render({ kind: 'error', message: validation.error }); return; }
  if ('warning' in validation) status.textContent = validation.warning;

  render({ kind: 'reading' });
  const bytes = await file.arrayBuffer();
  let worker: Worker | undefined;

  try {
    worker = createRepairWorker();
    const result: RepairResult = await repairInWorker(worker, bytes, validation.kind, {
      onPhase: (phase) => render({ kind: 'repairing', phase }),
    });

    viewer?.dispose();
    viewer = createViewer(viewerHost);
    viewer.show(result.beforeMesh, result.afterMesh, result.report.before.defectEdges);
    render({ kind: 'done', result, fileName: file.name });
  } catch (error) {
    render({ kind: 'error', message: errorMessageFor(error) });
  } finally {
    // repairInWorker already terminates on failure; this covers the happy path.
    // terminate() is a no-op on an already-terminated worker.
    worker?.terminate();
  }
}

mountDropzone(root, (file) => { void handleFile(file); });
render({ kind: 'idle' });
