window.PS = window.PS || {};

PS.$ = (s, d = document) => d.querySelector(s);
PS.$$ = (s, d = document) => [...d.querySelectorAll(s)];

PS.W = 1280;
PS.H = 960;
PS.FPS = 30;
PS.MAX_ANGLE = 14;
PS.MAX_OFFSET = 44;
PS.NOISE_FLOOR = 0.06;
PS.PX_PER_SEC = 160;

PS.state = {
  srcImg: null, upperData: null, lowerData: null, cutLine: null,
  drawing: false, drawStart: null, mode: 'side', pivot: 'left',
  upperCache: null, lowerCache: null,

  eyes: [null, null],
  activeEyeIndex: 0,
  drawMode: null,
  blinkState: [],
  dragEye: null,

  audioBuf: null, audioBlob: null, ampData: null, recState: 'idle',
  mr: null, mrChunks: [], recStartMs: 0, recTimer: null, audioCtx: null,
  animId: null, animating: false, animAudioSrc: null, currentPlayheadTime: 0,

  textImage: null, textImageUrl: null, ocrWords: [], whisperWords: [], syncedWords: [],
  textSyncMode: 'highlight', syncWorker: null, whisperPipe: null, isGeneratingSync: false,

  isLiveHoverSyncing: false, liveHoverWords: [], liveHoverActiveIdx: -1,
  puppetPos: { x: 50, y: 150, scale: 0.85 }, textPos: { x: 650, y: 150, scale: 0.85 },
  textBgColor: '#ffffff', arrangeDrag: null, selectedArrangeElement: null,

  selectedWordIndices: new Set(), primarySelectedIdx: -1, tlDragState: null,
  marqueeState: null, isScrubbingRuler: false
};

PS.setPanel = function (name, on) {
  const p = PS.$(`#pnl-${name}`);
  if (p) p.classList.toggle('disabled', !on);
};

PS.setStep = function (id, done) {
  const el = PS.$(`#stp-${id}`);
  if (!el) return;
  el.classList.toggle('done', done);
  if (!el.dataset.orig) el.dataset.orig = el.textContent;
  el.textContent = done ? '✓' : el.dataset.orig;
};

PS.updateStepIndicators = function () {
  const state = PS.state;
  PS.setStep('upload', Boolean(state.srcImg));
  PS.setStep('cut', Boolean(state.upperData && state.cutLine));
  PS.setStep('eyes', Boolean(state.eyes && state.eyes.some(Boolean)));
  PS.setStep('mode', Boolean(state.upperData));
  PS.setStep('record', Boolean(state.audioBuf));
  PS.setStep('textsync', Boolean(!PS.isSyncEnabled() || (state.syncedWords && state.syncedWords.length > 0)));
  const exp = PS.$('#pnl-export');
  PS.setStep('export', Boolean(exp && !exp.classList.contains('disabled')));
};

PS.unlock = function (upTo) {
  const order = ['cut', 'eyes', 'mode', 'record', 'textsync', 'export'];
  const maxIdx = order.indexOf(upTo);
  for (const o of order) {
    PS.setPanel(o, order.indexOf(o) <= maxIdx);
  }
  PS.updateStepIndicators();
};

PS.autoUnlock = function () {
  const state = PS.state;
  if (!state.upperData) { PS.unlock('cut'); return; }
  if (!state.audioBuf) { PS.unlock('record'); return; }
  if (PS.isSyncEnabled() && !state.syncedWords.length) { PS.unlock('textsync'); return; }
  PS.unlock('export');
  const btnExport = PS.$('#btn-export');
  if (btnExport) btnExport.disabled = false;
};

PS.isSyncEnabled = function () {
  const toggle = PS.$('#sync-enabled-toggle');
  return toggle ? toggle.checked : true;
};

PS.updateSyncButton = function () {
  const state = PS.state;
  const hasInputs = state.textImage && state.audioBlob && PS.isSyncEnabled();
  const btnGen = PS.$('#btn-gen-sync');
  const btnPrev = PS.$('#btn-preview-sync');
  const btnLive = PS.$('#btn-live-hover-sync');

  if (btnGen) btnGen.disabled = !(hasInputs && !state.isGeneratingSync);
  if (btnPrev) btnPrev.disabled = !(PS.isSyncEnabled() && state.syncedWords.length > 0 && state.audioBuf);
  if (btnLive) btnLive.disabled = !(hasInputs && !state.isGeneratingSync);
};

PS.updateSyncUI = function () {
  const state = PS.state;
  const preview = PS.$('#sync-preview');
  const status = PS.$('#sync-status');

  if (state.syncedWords.length > 0) {
    if (preview) {
      preview.style.display = '';
      preview.innerHTML = state.syncedWords.map(w => `<span>${w.word}</span>`).join(' ');
    }
    if (status) status.textContent = `${state.syncedWords.length} words synced.`;
  } else {
    if (preview) {
      preview.style.display = 'none';
      preview.innerHTML = '';
    }
    if (status) status.textContent = state.textImage ? 'Script image loaded.' : 'Load a script image and record audio.';
  }
  PS.updateSyncButton();
  if (typeof PS.renderTimeline === 'function') PS.renderTimeline();
};