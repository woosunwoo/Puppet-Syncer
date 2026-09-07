import { state, $, $$, W, H, PX_PER_SEC } from './state.js';
import { clearEyeLines, rebuildEyePatches, renderBlinks } from './puppet.js';
import { computeAmps, drawWaveform, togglePlay, startAnim, stopAnim } from './audio.js';
import { generateSync, startLiveHoverSync, stopLiveHoverSync } from './sync.js';
import { renderStage, renderTimeline, seekTo, refreshBlockSelectionVisuals, updateInspectorUI, getPuppetRect, getTextRect } from './timeline.js';
import { doExport } from './export.js';

const mainCanvas = $('#main-canvas');
const ctx = mainCanvas.getContext('2d');
mainCanvas.width = W;
mainCanvas.height = H;

export function setPanel(id, on) {
  const p = $(`#${id}`);
  if (p) p.classList.toggle('disabled', !on);
}

export function updateStepIndicators() {
  $('#stp-cut')?.classList.toggle('done', Boolean(state.upperData && state.cutLine));
  $('#stp-eyes')?.classList.toggle('done', Boolean(state.eyes.length > 0));
  $('#stp-mode')?.classList.toggle('done', Boolean(state.upperData));
  $('#stp-record')?.classList.toggle('done', Boolean(state.audioBuf));
  $('#stp-textsync')?.classList.toggle('done', Boolean(!isSyncEnabled() || state.syncedWords.length > 0));
}

export function unlock(upTo) {
  const order = ['cut', 'eyes', 'mode', 'record', 'textsync', 'export'];
  const maxIdx = order.indexOf(upTo);
  for (const o of order) {
    setPanel(o, order.indexOf(o) <= maxIdx);
  }
  updateStepIndicators();
}

export function autoUnlock() {
  if (!state.upperData) { unlock('cut'); return; }
  if (!state.audioBuf) { unlock('record'); return; }
  if (isSyncEnabled() && !state.syncedWords.length) { unlock('textsync'); return; }
  unlock('export');
  const btnExport = $('#btn-export');
  if (btnExport) btnExport.disabled = false;
}

export function isSyncEnabled() {
  return $('#sync-enabled-toggle').checked;
}

export function updateSyncButton() {
  const hasInputs = state.textImage && state.audioBlob && isSyncEnabled();
  $('#btn-gen-sync').disabled = !(hasInputs && !state.isGeneratingSync);
  $('#btn-preview-sync').disabled = !(isSyncEnabled() && state.syncedWords.length > 0 && state.audioBuf && state.upperData);
  $('#btn-live-hover-sync').disabled = !(hasInputs && !state.isGeneratingSync);
}

export function updateSyncUI() {
  if (state.syncedWords.length > 0) {
    $('#sync-preview').style.display = '';
    $('#sync-preview').innerHTML = state.syncedWords.map(w => `<span>${w.word}</span>`).join(' ');
    $('#sync-status').textContent = `${state.syncedWords.length} words synced.`;
  } else {
    $('#sync-preview').style.display = 'none';
    $('#sync-preview').innerHTML = '';
    $('#sync-status').textContent = state.textImage ? 'Script image loaded.' : 'Load a script image and record audio.';
  }
  renderTimeline();
}

function canvasPos(e) {
  const r = mainCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (W / r.width),
    y: (e.clientY - r.top) * (H / r.height),
  };
}

function redrawAll() {
  if (!state.srcImg) {
    ctx.fillStyle = '#141416';
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (state.upperData && state.drawMode === null) {
    renderStage(0);
  } else {
    ctx.fillStyle = '#141416';
    ctx.fillRect(0, 0, W, H);
    const s = Math.min(W / state.srcImg.width, H / state.srcImg.height);
    const iw = state.srcImg.width * s, ih = state.srcImg.height * s;
    ctx.drawImage(state.srcImg, (W - iw) / 2, (H - ih) / 2, iw, ih);

    if (state.cutLine) {
      const { x1, y1, x2, y2 } = state.cutLine;
      ctx.save();
      ctx.strokeStyle = '#e89440'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    }
  }
}

// ── Puppet Cut & Stage Mouse Handlers ──
mainCanvas.addEventListener('mousedown', e => {
  if (!state.srcImg || state.isLiveHoverSyncing) return;
  const pos = canvasPos(e);

  if (state.drawMode === null) {
    const pRect = getPuppetRect(), tRect = getTextRect();
    if (state.textImage && Math.hypot(pos.x - (tRect.x + tRect.w), pos.y - (tRect.y + tRect.h)) < 18) {
      state.arrangeDrag = { element: 'text', action: 'resize', startMouse: { ...pos }, startPos: { ...state.textPos }, startScale: state.textPos.scale, startRect: tRect };
      state.selectedArrangeElement = 'text'; renderStage(0); return;
    }
    if (state.srcImg && Math.hypot(pos.x - (pRect.x + pRect.w), pos.y - (pRect.y + pRect.h)) < 18) {
      state.arrangeDrag = { element: 'puppet', action: 'resize', startMouse: { ...pos }, startPos: { ...state.puppetPos }, startScale: state.puppetPos.scale, startRect: pRect };
      state.selectedArrangeElement = 'puppet'; renderStage(0); return;
    }
    if (state.textImage && pos.x >= tRect.x && pos.x <= tRect.x + tRect.w && pos.y >= tRect.y && pos.y <= tRect.y + tRect.h) {
      state.arrangeDrag = { element: 'text', action: 'move', offset: { x: pos.x - tRect.x, y: pos.y - tRect.y } };
      state.selectedArrangeElement = 'text'; renderStage(0); return;
    }
    if (state.srcImg && pos.x >= pRect.x && pos.x <= pRect.x + pRect.w && pos.y >= pRect.y && pos.y <= pRect.y + pRect.h) {
      state.arrangeDrag = { element: 'puppet', action: 'move', offset: { x: pos.x - pRect.x, y: pos.y - pRect.y } };
      state.selectedArrangeElement = 'puppet'; renderStage(0); return;
    }
    state.selectedArrangeElement = null;
    renderStage(0);
  }

  if (state.drawMode === 'mouth' && state.cutLine) return;
  if (state.drawMode === null) return;
  state.drawing = true;
  state.drawStart = pos;
});

mainCanvas.addEventListener('mousemove', e => {
  const pos = canvasPos(e);

  if (state.isLiveHoverSyncing && state.animating && state.textImage && state.liveHoverWords.length) {
    const baseS = Math.min(W / state.textImage.width, H / state.textImage.height) * 0.7;
    const finalScale = baseS * state.textPos.scale;
    const tx = (pos.x - state.textPos.x) / finalScale;
    const ty = (pos.y - state.textPos.y) / finalScale;

    const hitIdx = state.liveHoverWords.findIndex((w, i) =>
      i > state.liveHoverActiveIdx &&
      tx >= w.x - 4 && tx <= w.x + w.w + 4 &&
      ty >= w.y - 4 && ty <= w.y + w.h + 4
    );

    if (hitIdx >= 0) {
      const curT = state.currentPlayheadTime;
      if (state.liveHoverActiveIdx >= 0 && state.liveHoverWords[state.liveHoverActiveIdx]) {
        state.liveHoverWords[state.liveHoverActiveIdx].end = curT;
      }
      state.liveHoverWords[hitIdx].start = curT;
      state.liveHoverWords[hitIdx].end = curT + 0.2;
      state.liveHoverActiveIdx = hitIdx;
      $('#stage-hint').innerHTML = `<span style="color:#ff4a4a;font-weight:700;">🔴 LIVE SYNC:</span> "${state.liveHoverWords[hitIdx].word}" (${hitIdx + 1}/${state.liveHoverWords.length}) — [Space to pause]`;
    }
    return;
  }

  if (state.arrangeDrag) {
    const targetPos = state.arrangeDrag.element === 'puppet' ? state.puppetPos : state.textPos;
    if (state.arrangeDrag.action === 'move') {
      targetPos.x = pos.x - state.arrangeDrag.offset.x;
      targetPos.y = pos.y - state.arrangeDrag.offset.y;
    } else {
      const dx = pos.x - state.arrangeDrag.startMouse.x;
      const origImage = state.arrangeDrag.element === 'puppet' ? state.srcImg : state.textImage;
      const fitScale = state.arrangeDrag.element === 'puppet'
        ? Math.min(W / origImage.width, H / origImage.height)
        : Math.min(W / origImage.width, H / origImage.height) * 0.7;
      targetPos.scale = Math.max(0.15, (state.arrangeDrag.startRect.w + dx) / (origImage.width * fitScale));
    }
    renderStage(0);
    return;
  }

  if (!state.drawing) return;
  redrawAll();
  ctx.save();
  ctx.strokeStyle = '#e89440'; ctx.lineWidth = 2.5; ctx.setLineDash([7, 4]);
  ctx.beginPath(); ctx.moveTo(state.drawStart.x, state.drawStart.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
  ctx.restore();
});

mainCanvas.addEventListener('mouseup', e => {
  if (state.arrangeDrag) { state.arrangeDrag = null; return; }
  if (!state.drawing) return;
  state.drawing = false;
  const end = canvasPos(e);

  if (state.drawMode === 'mouth') {
    if (Math.hypot(end.x - state.drawStart.x, end.y - state.drawStart.y) < 15) return;
    state.cutLine = { x1: state.drawStart.x, y1: state.drawStart.y, x2: end.x, y2: end.y };
    state.drawMode = null;
    $('#hint-cut').innerHTML = '✅ Cut line set. <a href="#" id="inline-redo" style="color:var(--accent);">Redo</a>';
    $('#inline-redo')?.addEventListener('click', ev => { ev.preventDefault(); resetCut(); });

    // Cut image
    const clean = document.createElement('canvas');
    clean.width = W; clean.height = H;
    const cleanCtx = clean.getContext('2d');
    const s = Math.min(W / state.srcImg.width, H / state.srcImg.height);
    const iw = state.srcImg.width * s, ih = state.srcImg.height * s;
    cleanCtx.drawImage(state.srcImg, (W - iw) / 2, (H - ih) / 2, iw, ih);
    const full = cleanCtx.getImageData(0, 0, W, H);

    const upper = document.createElement('canvas');
    upper.width = W; upper.height = H;
    const uCtx = upper.getContext('2d');
    uCtx.putImageData(full, 0, 0);

    const lo = document.createElement('canvas');
    lo.width = W; lo.height = H;
    const lCtx = lo.getContext('2d');
    lCtx.putImageData(full, 0, 0);

    const uD = uCtx.getImageData(0, 0, W, H);
    const lD = lCtx.getImageData(0, 0, W, H);
    const { x1, y1, x2, y2 } = state.cutLine;
    const dx = x2 - x1, dy = y2 - y1;

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        const side = dx * (py - y1) - dy * (px - x1);
        if (side > 0) uD.data[idx + 3] = 0;
        else lD.data[idx + 3] = 0;
      }
    }
    uCtx.putImageData(uD, 0, 0);
    lCtx.putImageData(lD, 0, 0);
    state.upperData = uD; state.lowerData = lD;
    state.upperCache = upper; state.lowerCache = lo;

    rebuildEyePatches();
    renderStage(0);
    autoUnlock();
  }
});

function resetCut() {
  state.cutLine = null; state.upperData = null; state.lowerData = null;
  state.upperCache = null; state.lowerCache = null;
  state.drawMode = 'mouth';
  redrawAll();
  $('#hint-cut').innerHTML = 'Click &amp; drag across the <strong>mouth</strong> on the stage.';
  unlock('cut');
  stopAnim();
}
$('#btn-redo-cut').addEventListener('click', resetCut);

// Auto-exit eye drawing when interacting with later stages
['pnl-mode', 'pnl-record', 'pnl-textsync', 'pnl-export'].forEach(panelId => {
  $(`#${panelId}`)?.addEventListener('mousedown', () => {
    if (state.drawMode === 'eyes') {
      state.drawMode = null;
      $('#btn-eye-mode').textContent = '✏ Add Eye Lines';
      $('#btn-eye-mode').classList.remove('btn-primary');
      $('#btn-eye-mode').classList.add('btn-ghost');
      $('#hint-eyes').style.display = 'none';
      redrawAll();
      autoUnlock();
    }
  });
});

// Mode segmentation
$$('.seg-btn', $('#seg-mode')).forEach(b => {
  b.addEventListener('click', () => {
    $$('.seg-btn', $('#seg-mode')).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.mode = b.dataset.v;
    $('#pivot-wrap').style.display = state.mode === 'side' ? '' : 'none';
    if (state.cutLine) renderStage(0);
  });
});

$$('.seg-btn', $('#seg-pivot')).forEach(b => {
  b.addEventListener('click', () => {
    $$('.seg-btn', $('#seg-pivot')).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.pivot = b.dataset.v;
    if (state.cutLine) renderStage(0);
  });
});

// ── Voice Recording ──
$('#btn-rec').addEventListener('click', async () => {
  if (state.recState === 'recording') {
    if (state.recTimer) { clearInterval(state.recTimer); state.recTimer = null; }
    state.recState = 'stopping';
    $('#btn-rec').disabled = true;
    $('#btn-rec').textContent = '⏳ Processing…';
    if (state.mr.state !== 'inactive') state.mr.stop();
    return;
  }
  if (state.recState !== 'idle') return;

  state.recState = 'starting';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioCtx = state.audioCtx || new AudioContext({ sampleRate: 44100 });
    state.mrChunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    state.mr = new MediaRecorder(stream, { mimeType: mime });
    state.mr.ondataavailable = e => { if (e.data.size) state.mrChunks.push(e.data); };
    state.mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      state.audioBlob = new Blob(state.mrChunks, { type: mime });
      const buf = await state.audioBlob.arrayBuffer();
      state.audioBuf = await state.audioCtx.decodeAudioData(buf);
      state.ampData = computeAmps(state.audioBuf);
      state.recState = 'done';
      $('#rec-dot').classList.remove('live');
      $('#rec-dot').classList.add('ready');
      $('#btn-rec').disabled = false;
      $('#btn-rec').textContent = '🎤 Record';
      $('#btn-rec').classList.replace('btn-ghost', 'btn-danger');
      $('#btn-play').disabled = false;
      $('#btn-anim').disabled = false;
      drawWaveform();
      state.currentPlayheadTime = 0;
      renderTimeline();
      updateSyncButton();
      if (state.cutLine && state.upperData) {
        autoUnlock();
        $('#btn-export').disabled = false;
      }
    };
    state.mr.start();
    state.recState = 'recording';
    state.recStartMs = Date.now();
    $('#rec-dot').classList.add('live');
    $('#btn-rec').textContent = '⏹ Stop';
    $('#btn-rec').classList.replace('btn-danger', 'btn-ghost');
    state.recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - state.recStartMs) / 1000);
      $('#rec-time').textContent = `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
    }, 200);
  } catch (err) {
    console.error(err);
    state.recState = 'idle';
    alert('Microphone access denied.');
  }
});

// Spacebar Play / Pause
window.addEventListener('keydown', e => {
  if (e.code === 'Space') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    togglePlay();
  }
});

$('#btn-anim').addEventListener('click', togglePlay);
$('#btn-tl-play').addEventListener('click', togglePlay);
$('#btn-preview-sync').addEventListener('click', togglePlay);
$('#btn-gen-sync').addEventListener('click', generateSync);
$('#btn-live-hover-sync').addEventListener('click', () => {
  if (state.isLiveHoverSyncing) stopLiveHoverSync();
  else startLiveHoverSync();
});
$('#btn-export').addEventListener('click', doExport);

// Track Area Click / Scrubbing
$('#tl-track-area').addEventListener('mousedown', e => {
  if (e.target.closest('.tl-word-block')) return;
  const rect = $('#tl-track-area').getBoundingClientRect();
  const x = e.clientX - rect.left;
  const totalDur = state.audioBuf ? state.audioBuf.duration : (state.syncedWords.length ? state.syncedWords[state.syncedWords.length - 1].end : 1);
  seekTo(Math.max(0, Math.min(totalDur, x / PX_PER_SEC)));

  if (e.target === $('#tl-ruler-canvas')) {
    state.isScrubbingRuler = true;
    return;
  }
  if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
    state.selectedWordIndices.clear();
    state.primarySelectedIdx = -1;
    refreshBlockSelectionVisuals();
    updateInspectorUI();
  }
  state.marqueeState = { startX: x, startY: e.clientY - rect.top, hasDragged: false };
  $('#tl-marquee').style.display = 'none';
});

window.addEventListener('mousemove', e => {
  if (state.isScrubbingRuler) {
    const rect = $('#tl-track-area').getBoundingClientRect();
    const totalDur = state.audioBuf ? state.audioBuf.duration : 1;
    seekTo(Math.max(0, Math.min(totalDur, (e.clientX - rect.left) / PX_PER_SEC)));
    return;
  }
  if (state.marqueeState) {
    const rect = $('#tl-track-area').getBoundingClientRect();
    const curX = Math.max(0, e.clientX - rect.left);
    const curY = Math.max(0, e.clientY - rect.top);
    const bw = Math.abs(curX - state.marqueeState.startX);
    const bh = Math.abs(curY - state.marqueeState.startY);

    if (bw > 5 || bh > 5) {
      state.marqueeState.hasDragged = true;
      const m = $('#tl-marquee');
      m.style.display = 'block';
      const bx = Math.min(state.marqueeState.startX, curX);
      m.style.left = `${bx}px`;
      m.style.top = `${Math.min(state.marqueeState.startY, curY)}px`;
      m.style.width = `${bw}px`;
      m.style.height = `${bh}px`;

      state.syncedWords.forEach((w, idx) => {
        if (w.end * PX_PER_SEC >= bx && w.start * PX_PER_SEC <= bx + bw) {
          state.selectedWordIndices.add(idx);
          state.primarySelectedIdx = idx;
        }
      });
      refreshBlockSelectionVisuals();
      updateInspectorUI();
    }
    return;
  }

  if (state.tlDragState) {
    const totalDur = state.audioBuf ? state.audioBuf.duration : 60;
    const dx = e.clientX - state.tlDragState.startX;
    const dt = dx / PX_PER_SEC;

    if (state.tlDragState.mode === 'move') {
      let minStart = Infinity, maxEnd = -Infinity;
      state.tlDragState.items.forEach(it => {
        if (it.origStart < minStart) minStart = it.origStart;
        if (it.origEnd > maxEnd) maxEnd = it.origEnd;
      });
      const clampedDt = Math.max(-minStart, Math.min(totalDur - maxEnd, dt));
      state.tlDragState.items.forEach(it => {
        const w = state.syncedWords[it.idx];
        w.start = it.origStart + clampedDt;
        w.end = it.origEnd + clampedDt;
        const block = $(`#tl-word-${it.idx}`);
        if (block) {
          block.style.left = `${w.start * PX_PER_SEC}px`;
          block.style.width = `${Math.max(18, (w.end - w.start) * PX_PER_SEC)}px`;
        }
      });
      renderStage(0, state.syncedWords[state.tlDragState.pivotIdx].start);
    } else if (state.tlDragState.mode === 'right') {
      const it = state.tlDragState.items[0];
      const w = state.syncedWords[it.idx];
      const newEnd = Math.max(w.start + 0.05, it.origEnd + dt);
      const delta = newEnd - it.origEnd;
      w.end = newEnd;

      const block = $(`#tl-word-${it.idx}`);
      if (block) block.style.width = `${Math.max(18, (w.end - w.start) * PX_PER_SEC)}px`;

      if ($('#tl-ripple-chk').checked && state.tlDragState.origAllDownstream) {
        state.tlDragState.origAllDownstream.forEach(ds => {
          const dw = state.syncedWords[ds.idx];
          dw.start = Math.max(0, ds.origStart + delta);
          dw.end = Math.max(dw.start + 0.05, ds.origEnd + delta);
          const dblock = $(`#tl-word-${ds.idx}`);
          if (dblock) {
            dblock.style.left = `${dw.start * PX_PER_SEC}px`;
            dblock.style.width = `${Math.max(18, (dw.end - dw.start) * PX_PER_SEC)}px`;
          }
        });
      }
      renderStage(0, w.start);
    } else if (state.tlDragState.mode === 'left') {
      const it = state.tlDragState.items[0];
      const w = state.syncedWords[it.idx];
      w.start = Math.max(0, Math.min(w.end - 0.05, it.origStart + dt));
      const block = $(`#tl-word-${it.idx}`);
      if (block) {
        block.style.left = `${w.start * PX_PER_SEC}px`;
        block.style.width = `${Math.max(18, (w.end - w.start) * PX_PER_SEC)}px`;
      }
      renderStage(0, w.start);
    }
    updateInspectorUI();
  }
});

window.addEventListener('mouseup', () => {
  state.isScrubbingRuler = false;
  if (state.marqueeState) {
    state.marqueeState = null;
    $('#tl-marquee').style.display = 'none';
  }
  if (state.tlDragState) {
    state.syncedWords.sort((a, b) => a.start - b.start);
    state.tlDragState = null;
    renderTimeline();
    renderStage(0, state.currentPlayheadTime);
  }
});

// Reset All
$('#btn-reset').addEventListener('click', () => {
  stopAnim();
  if (state.isLiveHoverSyncing) stopLiveHoverSync();
  state.srcImg = null; state.upperData = null; state.lowerData = null;
  state.upperCache = null; state.lowerCache = null;
  state.cutLine = null; state.drawing = false; state.drawStart = null;
  clearEyeLines();
  state.syncedWords = []; state.ocrWords = []; state.whisperWords = [];
  state.selectedWordIndices.clear(); state.primarySelectedIdx = -1;
  state.textImage = null;
  if (state.textImageUrl) { URL.revokeObjectURL(state.textImageUrl); state.textImageUrl = null; }
  if (state.syncWorker) { state.syncWorker.terminate(); state.syncWorker = null; }
  state.whisperPipe = null;
  $('#text-dropzone').classList.remove('filled');
  $('#text-dropzone').innerHTML = '<span class="dz-icon">📝</span><span class="dz-label">Drop script image or click</span>';
  $('#text-file-inp').value = '';
  $('#script-text-input').value = '';
  $('#sync-preview').style.display = 'none';
  $('#sync-status').textContent = 'Load a script image and record audio.';
  $('#btn-gen-sync').textContent = '✨ Generate Sync';
  state.drawMode = 'mouth';
  state.audioBuf = null; state.audioBlob = null; state.ampData = null;
  state.recState = 'idle';
  state.audioCtx?.close().catch(() => {}); state.audioCtx = null;
  state.currentPlayheadTime = 0;
  ctx.fillStyle = '#141416';
  ctx.fillRect(0, 0, W, H);
  $('#dropzone').classList.remove('filled');
  $('#dropzone').innerHTML = '<span class="dz-icon">🖼</span><span class="dz-label">Drop image or click</span>';
  $('#file-inp').value = '';
  ['cut', 'eyes', 'mode', 'record', 'textsync', 'export'].forEach(k => setPanel(k, false));
  $('#rec-dot').classList.remove('live', 'ready');
  $('#rec-time').textContent = '0:00';
  $('#stage-hint').textContent = 'Upload an image to begin';
  $('#hint-cut').innerHTML = 'Click &amp; drag across the <strong>mouth</strong> on the stage.';
  $('#wave-canvas').getContext('2d').clearRect(0, 0, 1000, 38);
  renderTimeline();
});