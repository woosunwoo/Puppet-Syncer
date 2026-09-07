(function () {
  'use strict';
  const { $, $$, state, W, H, PX_PER_SEC } = PS;

  const mainCanvas = $('#main-canvas');
  if (mainCanvas) {
    mainCanvas.width = W;
    mainCanvas.height = H;
  }
  const ctx = mainCanvas ? mainCanvas.getContext('2d') : null;

  function safeSetText(selector, text) {
    const el = $(selector);
    if (el) el.textContent = text;
  }

  function safeSetHtml(selector, html) {
    const el = $(selector);
    if (el) el.innerHTML = html;
  }

  PS.setPanel = function (name, on) {
    const p = $(`#pnl-${name}`);
    if (p) p.classList.toggle('disabled', !on);
  };

  PS.setStep = function (id, done) {
    const el = $(`#stp-${id}`);
    if (!el) return;
    el.classList.toggle('done', done);
    if (!el.dataset.orig) el.dataset.orig = el.textContent;
    el.textContent = done ? '✓' : el.dataset.orig;
  };

  PS.updateStepIndicators = function () {
    PS.setStep('upload', Boolean(state.srcImg));
    PS.setStep('cut', Boolean(state.upperData && state.cutLine));
    PS.setStep('eyes', Boolean(state.eyes && state.eyes.some(Boolean)));
    PS.setStep('mode', Boolean(state.upperData));
    PS.setStep('record', Boolean(state.audioBuf));
    PS.setStep('textsync', Boolean(!PS.isSyncEnabled() || (state.syncedWords && state.syncedWords.length > 0)));
    const exp = $('#pnl-export');
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
    if (!state.upperData) { PS.unlock('cut'); return; }
    if (!state.audioBuf) { PS.unlock('record'); return; }
    if (PS.isSyncEnabled() && !state.syncedWords.length) { PS.unlock('textsync'); return; }
    PS.unlock('export');
    const btnExport = $('#btn-export');
    if (btnExport) btnExport.disabled = false;
  };

  PS.isSyncEnabled = function () {
    const toggle = $('#sync-enabled-toggle');
    return toggle ? toggle.checked : true;
  };

  PS.updateSyncButton = function () {
    const hasInputs = state.textImage && state.audioBlob && PS.isSyncEnabled();
    const btnGen = $('#btn-gen-sync');
    const btnPrev = $('#btn-preview-sync');
    const btnLive = $('#btn-live-hover-sync');

    if (btnGen) btnGen.disabled = !(hasInputs && !state.isGeneratingSync);
    if (btnPrev) btnPrev.disabled = !(PS.isSyncEnabled() && state.syncedWords.length > 0 && state.audioBuf);
    if (btnLive) btnLive.disabled = !(hasInputs && !state.isGeneratingSync);
  };

  PS.updateSyncUI = function () {
    const preview = $('#sync-preview');
    const status = $('#sync-status');

    if (state.syncedWords && state.syncedWords.length > 0) {
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

  function canvasPos(e) {
    const r = mainCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (W / r.width),
      y: (e.clientY - r.top) * (H / r.height)
    };
  }

  function screenToPuppetCoords(pos) {
    return {
      x: (pos.x - state.puppetPos.x) / state.puppetPos.scale,
      y: (pos.y - state.puppetPos.y) / state.puppetPos.scale
    };
  }

  PS.getPuppetRect = function () {
    if (!state.srcImg) return { x: 0, y: 0, w: 0, h: 0 };
    const baseS = Math.min(W / state.srcImg.width, H / state.srcImg.height);
    const iw = state.srcImg.width * baseS;
    const ih = state.srcImg.height * baseS;
    return {
      x: state.puppetPos.x,
      y: state.puppetPos.y,
      w: iw * state.puppetPos.scale,
      h: ih * state.puppetPos.scale
    };
  };

  PS.getTextRect = function () {
    if (!state.textImage) return { x: 0, y: 0, w: 0, h: 0 };
    const baseS = Math.min(W / state.textImage.width, H / state.textImage.height) * 0.7;
    return {
      x: state.textPos.x,
      y: state.textPos.y,
      w: state.textImage.width * baseS * state.textPos.scale,
      h: state.textImage.height * baseS * state.textPos.scale
    };
  };

  function hitTestArrange(pos) {
    const pRect = PS.getPuppetRect();
    const tRect = PS.getTextRect();

    // Corner handle resize hits (18px radius)
    if (state.textImage) {
      const trHandle = { x: tRect.x + tRect.w, y: tRect.y + tRect.h };
      if (Math.hypot(pos.x - trHandle.x, pos.y - trHandle.y) < 18) {
        return { element: 'text', action: 'resize', startScale: state.textPos.scale, startMouse: { ...pos }, startRect: tRect };
      }
    }
    if (state.upperData && state.srcImg) {
      const prHandle = { x: pRect.x + pRect.w, y: pRect.y + pRect.h };
      if (Math.hypot(pos.x - prHandle.x, pos.y - prHandle.y) < 18) {
        return { element: 'puppet', action: 'resize', startScale: state.puppetPos.scale, startMouse: { ...pos }, startRect: pRect };
      }
    }

    // Body move hits
    if (state.textImage && pos.x >= tRect.x && pos.x <= tRect.x + tRect.w && pos.y >= tRect.y && pos.y <= tRect.y + tRect.h) {
      return { element: 'text', action: 'move', offset: { x: pos.x - tRect.x, y: pos.y - tRect.y } };
    }
    if (state.upperData && state.srcImg && pos.x >= pRect.x && pos.x <= pRect.x + pRect.w && pos.y >= pRect.y && pos.y <= pRect.y + pRect.h) {
      return { element: 'puppet', action: 'move', offset: { x: pos.x - pRect.x, y: pos.y - pRect.y } };
    }
    return null;
  }

  PS.redrawAll = function () {
    if (!ctx) return;
    if (!state.srcImg) {
      ctx.fillStyle = '#141416';
      ctx.fillRect(0, 0, W, H);
      return;
    }

    if (state.upperData) {
      if (typeof PS.renderStage === 'function') PS.renderStage(0);
    } else {
      ctx.fillStyle = '#141416';
      ctx.fillRect(0, 0, W, H);
      const s = Math.min(W / state.srcImg.width, H / state.srcImg.height);
      const iw = state.srcImg.width * s;
      const ih = state.srcImg.height * s;
      const ix = (W - iw) / 2;
      const iy = (H - ih) / 2;
      ctx.drawImage(state.srcImg, ix, iy, iw, ih);

      if (state.cutLine) {
        const { x1, y1, x2, y2 } = state.cutLine;
        ctx.save();
        ctx.strokeStyle = '#e89440'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();
      }
    }
  };

  // ── Image Upload Handling ──
  function setupUploadHandlers() {
    const dropzone = $('#dropzone');
    const fileInp = $('#file-inp');
    const textDropzone = $('#text-dropzone');
    const textFileInp = $('#text-file-inp');

    if (dropzone && fileInp) {
      dropzone.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        fileInp.value = '';
        fileInp.click();
      };
      fileInp.onchange = function (e) {
        if (e.target.files && e.target.files[0]) {
          handlePuppetImageUpload(e.target.files[0]);
        }
      };
      dropzone.ondragover = function (e) {
        e.preventDefault();
        dropzone.classList.add('dragover');
      };
      dropzone.ondragleave = function () {
        dropzone.classList.remove('dragover');
      };
      dropzone.ondrop = function (e) {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handlePuppetImageUpload(e.dataTransfer.files[0]);
        }
      };
    }

    if (textDropzone && textFileInp) {
      textDropzone.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        textFileInp.value = '';
        textFileInp.click();
      };
      textFileInp.onchange = function (e) {
        if (e.target.files && e.target.files[0]) {
          handleScriptImageUpload(e.target.files[0]);
        }
      };
      textDropzone.ondragover = function (e) {
        e.preventDefault();
        textDropzone.classList.add('dragover');
      };
      textDropzone.ondragleave = function () {
        textDropzone.classList.remove('dragover');
      };
      textDropzone.ondrop = function (e) {
        e.preventDefault();
        textDropzone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleScriptImageUpload(e.dataTransfer.files[0]);
        }
      };
    }
  }

  function handlePuppetImageUpload(file) {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        state.srcImg = img;
        state.cutLine = null;
        state.upperData = null;
        state.lowerData = null;
        state.upperCache = null;
        state.lowerCache = null;
        if (typeof PS.clearAllEyes === 'function') PS.clearAllEyes();
        state.syncedWords = [];
        state.selectedWordIndices.clear();
        state.primarySelectedIdx = -1;
        state.drawMode = 'mouth';

        PS.redrawAll();

        const dz = $('#dropzone');
        if (dz) dz.classList.add('filled');
        safeSetHtml('#dropzone-content', `<img src="${ev.target.result}" alt="upload">`);

        PS.unlock('cut');
        safeSetHtml('#hint-cut', 'Click &amp; drag across the <strong>mouth</strong> on the stage.');
        safeSetText('#stage-hint', 'Draw a cut line across the mouth');

        if (typeof PS.stopAnim === 'function') PS.stopAnim();
        if (typeof PS.renderTimeline === 'function') PS.renderTimeline();
        PS.updateSyncUI();
        PS.updateSyncButton();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function handleScriptImageUpload(file) {
    if (state.textImageUrl) URL.revokeObjectURL(state.textImageUrl);
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = async () => {
        state.textImage = img;
        state.textImageUrl = ev.target.result;
        const tdz = $('#text-dropzone');
        if (tdz) tdz.classList.add('filled');
        safeSetHtml('#text-dropzone-content', `<img src="${ev.target.result}" alt="text" style="max-height:80px;">`);
        detectTextBgColor();

        const baseS = Math.min(W / img.width, H / img.height) * 0.7;
        state.textPos = { x: W - img.width * baseS - 60, y: (H - img.height * baseS) / 2, scale: 1.0 };
        PS.updateSyncButton();
        safeSetText('#sync-status', 'Script image loaded. Running OCR…');
        if (state.upperData) PS.renderStage(0);
        if (typeof PS.renderTimeline === 'function') PS.renderTimeline();
        await runBackgroundOCR();
        PS.autoUnlock();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function runBackgroundOCR() {
    if (!state.textImageUrl) return;
    try {
      if (!state.syncWorker) {
        state.syncWorker = await Tesseract.createWorker('eng', 1, {
          logger: m => {
            if (m.status === 'recognizing text') safeSetText('#sync-status', `OCR: ${Math.round(m.progress * 100)}%`);
          }
        });
      }
      const ocrResult = await state.syncWorker.recognize(state.textImageUrl);
      const rawWords = ocrResult.data.words.map(w => ({
        word: w.text.trim(), clean: PS.cleanWord(w.text),
        x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0
      })).filter(w => w.clean.length > 0 && w.h > 0);

      rawWords.sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
      const lineGroups = [];
      let curLine = null, curCenter = 0, curH = 0;
      for (const w of rawWords) {
        const cy = w.y + w.h / 2;
        if (!curLine || Math.abs(cy - curCenter) > Math.max(curH, w.h) * 0.6) {
          if (curLine) lineGroups.push(curLine);
          curLine = [w]; curCenter = cy; curH = w.h;
        } else {
          curLine.push(w);
          curCenter = curLine.reduce((s, x) => s + x.y + x.h / 2, 0) / curLine.length;
          curH = Math.max(...curLine.map(x => x.h));
        }
      }
      if (curLine) lineGroups.push(curLine);
      state.ocrWords = lineGroups.flatMap((grp, li) => grp.sort((a, b) => a.x - b.x).map(w => ({ ...w, line: li })));

      const scriptInput = $('#script-text-input');
      if (scriptInput && !scriptInput.value.trim() && state.ocrWords.length > 0) {
        scriptInput.value = state.ocrWords.map(w => w.word).join(' ');
      }
      safeSetText('#sync-status', `OCR ready: ${state.ocrWords.length} words found.`);
      PS.updateSyncButton();
    } catch (err) {
      console.error(err);
      safeSetText('#sync-status', 'OCR extraction failed.');
    }
  }

  const ocrResetBtn = $('#btn-ocr-reset');
  if (ocrResetBtn) {
    ocrResetBtn.addEventListener('click', () => {
      const scriptInput = $('#script-text-input');
      if (scriptInput && state.ocrWords.length > 0) {
        scriptInput.value = state.ocrWords.map(w => w.word).join(' ');
      }
    });
  }

  function detectTextBgColor() {
    if (!state.textImage) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 16; canvas.height = 16;
      const cctx = canvas.getContext('2d');
      cctx.drawImage(state.textImage, 0, 0, 16, 16);
      const data = cctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
      }
      state.textBgColor = `rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})`;
    } catch (e) {
      state.textBgColor = '#ffffff';
    }
  }

  // ── Unified Stage Mouse Events ──
  mainCanvas.addEventListener('mousedown', e => {
    if (!state.srcImg || state.isLiveHoverSyncing) return;
    const pos = canvasPos(e);

    // Eye setup mode
    if (state.drawMode === 'eyes') {
      const p = screenToPuppetCoords(pos);
      const hit = PS.hitTestEye(p);
      if (hit) {
        state.activeEyeIndex = hit.idx;
        if (typeof PS.updateEyeUI === 'function') PS.updateEyeUI();
        state.drawing = false;
        state.dragEye = {
          idx: hit.idx, mode: hit.mode, corner: hit.corner,
          startOval: { ...state.eyes[hit.idx] }, mouseX: p.x, mouseY: p.y
        };
      } else {
        state.drawing = true;
        state.drawStart = p;
      }
      return;
    }

    // Arrange mode: Move & Resize
    if (state.drawMode === null) {
      const hit = hitTestArrange(pos);
      if (hit) {
        state.arrangeDrag = {
          element: hit.element,
          action: hit.action,
          startMouse: { ...pos },
          startPos: hit.element === 'puppet' ? { ...state.puppetPos } : { ...state.textPos },
          startScale: hit.element === 'puppet' ? state.puppetPos.scale : state.textPos.scale,
          offset: hit.offset,
          startRect: hit.startRect
        };
        state.selectedArrangeElement = hit.element;
        PS.renderStage(0);
        e.preventDefault();
        return;
      } else {
        state.selectedArrangeElement = null;
        PS.renderStage(0);
      }
    }

    // Mouth cutting mode
    if (state.drawMode === 'mouth' && state.cutLine) return;
    state.drawing = true;
    state.drawStart = pos;
  });

  mainCanvas.addEventListener('mousemove', e => {
    const pos = canvasPos(e);

    // Dynamic cursor feedback in arrange mode
    if (state.drawMode === null && !state.isLiveHoverSyncing && !state.arrangeDrag) {
      const hit = hitTestArrange(pos);
      mainCanvas.style.cursor = hit ? (hit.action === 'resize' ? 'nwse-resize' : 'move') : 'default';
    }

    // Eye moving / resizing
    if (state.dragEye) {
      const p = screenToPuppetCoords(pos);
      const e2 = state.eyes[state.dragEye.idx];
      const s = state.dragEye.startOval;
      if (state.dragEye.mode === 'move') {
        e2.cx = s.cx + (p.x - state.dragEye.mouseX);
        e2.cy = s.cy + (p.y - state.dragEye.mouseY);
      } else if (state.dragEye.mode === 'resize') {
        if (state.dragEye.corner === 'nw' || state.dragEye.corner === 'sw') {
          e2.rx = Math.max(4, Math.abs(s.cx + s.rx - p.x) / 2);
          e2.cx = (p.x + s.cx + s.rx) / 2;
        } else {
          e2.rx = Math.max(4, Math.abs(p.x - (s.cx - s.rx)) / 2);
          e2.cx = (p.x + s.cx - s.rx) / 2;
        }
        if (state.dragEye.corner === 'nw' || state.dragEye.corner === 'ne') {
          e2.ry = Math.max(4, Math.abs(s.cy + s.ry - p.y) / 2);
          e2.cy = (p.y + s.cy + s.ry) / 2;
        } else {
          e2.ry = Math.max(4, Math.abs(p.y - (s.cy - s.ry)) / 2);
          e2.cy = (p.y + s.cy - s.ry) / 2;
        }
      }
      PS.redrawAll();
      return;
    }

    // Live preview drawing eye oval
    if (state.drawing && state.drawMode === 'eyes') {
      PS.redrawAll();
      const p = screenToPuppetCoords(pos);
      const cx = (state.drawStart.x + p.x) / 2;
      const cy = (state.drawStart.y + p.y) / 2;
      const rx = Math.abs(p.x - state.drawStart.x) / 2;
      const ry = Math.abs(p.y - state.drawStart.y) / 2;

      ctx.save();
      ctx.translate(state.puppetPos.x, state.puppetPos.y);
      ctx.scale(state.puppetPos.scale, state.puppetPos.scale);
      ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.setLineDash([4, 2]);
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255, 215, 0, 0.3)'; ctx.fill();
      ctx.restore();
      return;
    }

    // Moving and Resizing Elements in Arrange Mode
    if (state.arrangeDrag) {
      const targetPos = state.arrangeDrag.element === 'puppet' ? state.puppetPos : state.textPos;
      if (state.arrangeDrag.action === 'move') {
        targetPos.x = pos.x - state.arrangeDrag.offset.x;
        targetPos.y = pos.y - state.arrangeDrag.offset.y;
      } else if (state.arrangeDrag.action === 'resize') {
        const dx = pos.x - state.arrangeDrag.startMouse.x;
        const newW = state.arrangeDrag.startRect.w + dx;
        const origImage = state.arrangeDrag.element === 'puppet' ? state.srcImg : state.textImage;
        if (origImage) {
          const fitScale = state.arrangeDrag.element === 'puppet'
            ? Math.min(W / origImage.width, H / origImage.height)
            : Math.min(W / origImage.width, H / origImage.height) * 0.7;
          targetPos.scale = Math.max(0.15, newW / (origImage.width * fitScale));
        }
      }
      PS.renderStage(0);
      return;
    }

    // Live hover sync sweep
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
        safeSetHtml('#stage-hint', `<span style="color:#ff4a4a;font-weight:700;">🔴 LIVE SYNC:</span> "${state.liveHoverWords[hitIdx].word}" (${hitIdx + 1}/${state.liveHoverWords.length})`);
      }
      return;
    }

    // Mouth cutting line
    if (!state.drawing) return;
    PS.redrawAll();
    ctx.save();
    ctx.strokeStyle = '#e89440'; ctx.lineWidth = 2.5; ctx.setLineDash([7, 4]);
    ctx.beginPath(); ctx.moveTo(state.drawStart.x, state.drawStart.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
    ctx.restore();
  });

  mainCanvas.addEventListener('mouseup', e => {
    if (state.arrangeDrag) {
      state.arrangeDrag = null;
      mainCanvas.style.cursor = 'default';
      return;
    }

    if (state.dragEye) {
      const eye = state.eyes[state.dragEye.idx];
      if (eye && typeof PS.buildEyePatch === 'function') {
        eye.patch = PS.buildEyePatch(eye.cx, eye.cy, eye.rx, eye.ry);
      }
      state.dragEye = null;
      if (typeof PS.updateEyeUI === 'function') PS.updateEyeUI();
      PS.redrawAll();
      return;
    }

    if (!state.drawing) return;
    state.drawing = false;
    const end = canvasPos(e);

    if (state.drawMode === 'mouth') {
      if (Math.hypot(end.x - state.drawStart.x, end.y - state.drawStart.y) < 15) return;
      state.cutLine = { x1: state.drawStart.x, y1: state.drawStart.y, x2: end.x, y2: end.y };
      state.drawMode = null; // Enters Arrange mode immediately

      safeSetHtml('#hint-cut', '✅ Cut line set. <a href="#" id="inline-redo" style="color:var(--accent);">Redo</a>');
      const redo = $('#inline-redo');
      if (redo) {
        redo.addEventListener('click', ev => { ev.preventDefault(); resetCut(); });
      }

      // Slice puppet into upper and lower halves
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

      if (typeof PS.rebuildEyePatches === 'function') PS.rebuildEyePatches();

      PS.autoUnlock();
      safeSetText('#stage-hint', 'Arrange Mode: Drag elements to position, or drag corner handles to resize.');
      PS.renderStage(0);
    } else if (state.drawMode === 'eyes') {
      const p = screenToPuppetCoords(end);
      const rx = Math.abs(p.x - state.drawStart.x) / 2;
      const ry = Math.abs(p.y - state.drawStart.y) / 2;
      if (rx > 3 && ry > 3) {
        const cx = (state.drawStart.x + p.x) / 2;
        const cy = (state.drawStart.y + p.y) / 2;
        if (typeof PS.setEyeOval === 'function') {
          PS.setEyeOval(state.activeEyeIndex, cx, cy, rx, ry);
        }
        if (state.activeEyeIndex === 0 && !state.eyes[1]) {
          state.activeEyeIndex = 1;
          safeSetText('#stage-hint', 'Eye 1 set! Now drag an oval around Eye 2 (Right Eye)…');
        } else {
          safeSetText('#stage-hint', 'Eyes placed! Click "Done with Eyes" in sidebar to return to Arrange Mode.');
        }
      }
      state.drawStart = null;
      if (typeof PS.updateEyeUI === 'function') PS.updateEyeUI();
      PS.redrawAll();
    }
  });

  function resetCut() {
    state.cutLine = null; state.upperData = null; state.lowerData = null;
    state.upperCache = null; state.lowerCache = null;
    state.drawMode = 'mouth';
    PS.redrawAll();
    safeSetHtml('#hint-cut', 'Click &amp; drag across the <strong>mouth</strong> on the stage.');
    PS.unlock('cut');
    if (typeof PS.stopAnim === 'function') PS.stopAnim();
  }

  const btnRedoCut = $('#btn-redo-cut');
  if (btnRedoCut) btnRedoCut.addEventListener('click', resetCut);

  // Auto-exit eye drawing when interacting with any other sidebar panel
  ['pnl-mode', 'pnl-record', 'pnl-textsync', 'pnl-export'].forEach(panelId => {
    $(`#${panelId}`)?.addEventListener('mousedown', () => {
      if (state.drawMode === 'eyes') {
        state.drawMode = null;
        if (typeof PS.updateEyeUI === 'function') PS.updateEyeUI();
        safeSetText('#stage-hint', 'Arrange Mode: Drag elements to move, or drag bottom-right corner to resize.');
        PS.redrawAll();
      }
    });
  });

  // ── Mode Segments ──
  const segMode = $('#seg-mode');
  if (segMode) {
    $$('.seg-btn', segMode).forEach(b => {
      b.addEventListener('click', () => {
        $$('.seg-btn', segMode).forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        state.mode = b.dataset.v;
        const wrap = $('#pivot-wrap');
        if (wrap) wrap.style.display = state.mode === 'side' ? '' : 'none';
        if (state.cutLine) PS.renderStage(0);
      });
    });
  }

  const segPivot = $('#seg-pivot');
  if (segPivot) {
    $$('.seg-btn', segPivot).forEach(b => {
      b.addEventListener('click', () => {
        $$('.seg-btn', segPivot).forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        state.pivot = b.dataset.v;
        if (state.cutLine) PS.renderStage(0);
      });
    });
  }

  // ── Voice Recording ──
  const btnRec = $('#btn-rec');
  if (btnRec) {
    btnRec.addEventListener('click', async () => {
      if (state.recState === 'recording') {
        if (state.recTimer) { clearInterval(state.recTimer); state.recTimer = null; }
        state.recState = 'stopping';
        btnRec.disabled = true;
        btnRec.textContent = '⏳ Processing…';
        if (state.mr && state.mr.state !== 'inactive') state.mr.stop();
        return;
      }
      if (state.recState === 'starting' || state.recState === 'stopping') return;

      if (typeof PS.stopAnim === 'function') PS.stopAnim();
      state.recState = 'starting';

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.audioCtx = state.audioCtx || new AudioContext({ sampleRate: 44100 });
        if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();

        state.mrChunks = [];
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        state.mr = new MediaRecorder(stream, { mimeType: mime });
        state.mr.ondataavailable = e => { if (e.data.size) state.mrChunks.push(e.data); };
        state.mr.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          state.audioBlob = new Blob(state.mrChunks, { type: mime });
          const buf = await state.audioBlob.arrayBuffer();
          state.audioBuf = await state.audioCtx.decodeAudioData(buf);
          state.ampData = PS.computeAmps(state.audioBuf);

          state.recState = 'idle';
          const dot = $('#rec-dot');
          if (dot) {
            dot.classList.remove('live');
            dot.classList.add('ready');
          }
          btnRec.disabled = false;
          btnRec.textContent = '🎤 Record';
          btnRec.classList.replace('btn-ghost', 'btn-danger');

          const btnPlay = $('#btn-play');
          const btnAnim = $('#btn-anim');
          if (btnPlay) btnPlay.disabled = false;
          if (btnAnim) btnAnim.disabled = false;

          if (typeof PS.drawWaveform === 'function') PS.drawWaveform();
          state.currentPlayheadTime = 0;
          if (typeof PS.renderTimeline === 'function') PS.renderTimeline();
          PS.updateSyncButton();
          PS.autoUnlock();
        };

        state.mr.start();
        state.recState = 'recording';
        state.recStartMs = Date.now();
        const dot = $('#rec-dot');
        if (dot) dot.classList.add('live');
        btnRec.textContent = '⏹ Stop';
        btnRec.classList.replace('btn-danger', 'btn-ghost');
        state.recTimer = setInterval(() => {
          const s = Math.floor((Date.now() - state.recStartMs) / 1000);
          safeSetText('#rec-time', `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`);
        }, 200);
      } catch (err) {
        console.error(err);
        state.recState = 'idle';
        btnRec.disabled = false;
        btnRec.textContent = '🎤 Record';
        btnRec.classList.replace('btn-ghost', 'btn-danger');
        alert('Microphone access denied.');
      }
    });
  }

  const btnPlay = $('#btn-play');
  if (btnPlay) {
    btnPlay.addEventListener('click', () => {
      if (!state.audioBuf) return;
      if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
      try { state.animAudioSrc?.stop(); } catch {}
      const src = state.audioCtx.createBufferSource();
      src.buffer = state.audioBuf;
      src.connect(state.audioCtx.destination);
      src.onended = () => { state.animAudioSrc = null; };
      state.animAudioSrc = src;
      src.start();
    });
  }

  // ── Timeline Controls ──
  const durInput = $('#tl-dur-input');
  if (durInput) {
    durInput.addEventListener('change', () => {
      if (state.primarySelectedIdx < 0 || state.primarySelectedIdx >= state.syncedWords.length) return;
      const newDur = Math.max(0.05, parseFloat(durInput.value) || 0.1);
      const w = state.syncedWords[state.primarySelectedIdx];
      const oldEnd = w.end;
      const newEnd = w.start + newDur;
      const delta = newEnd - oldEnd;
      w.end = newEnd;

      const rippleChk = $('#tl-ripple-chk');
      if (rippleChk && rippleChk.checked) {
        for (let i = state.primarySelectedIdx + 1; i < state.syncedWords.length; i++) {
          state.syncedWords[i].start += delta;
          state.syncedWords[i].end += delta;
        }
      } else {
        if (state.primarySelectedIdx + 1 < state.syncedWords.length && state.syncedWords[state.primarySelectedIdx + 1].start < w.end) {
          state.syncedWords[state.primarySelectedIdx + 1].start = w.end;
          if (state.syncedWords[state.primarySelectedIdx + 1].end <= state.syncedWords[state.primarySelectedIdx + 1].start) {
            state.syncedWords[state.primarySelectedIdx + 1].end = state.syncedWords[state.primarySelectedIdx + 1].start + 0.08;
          }
        }
      }
      PS.renderTimeline();
      PS.renderStage(0, w.start);
    });
  }

  const btnDistribute = $('#btn-tl-distribute');
  if (btnDistribute) {
    btnDistribute.addEventListener('click', () => {
      if (!state.syncedWords.length) return;
      const totalDur = state.audioBuf ? state.audioBuf.duration : (state.syncedWords[state.syncedWords.length - 1].end || 5);
      const step = totalDur / state.syncedWords.length;
      state.syncedWords.forEach((w, idx) => {
        w.start = idx * step;
        w.end = (idx + 1) * step;
      });
      PS.renderTimeline();
      safeSetText('#sync-status', 'All words distributed evenly.');
    });
  }

  const trackArea = $('#tl-track-area');
  if (trackArea) {
    trackArea.addEventListener('mousedown', e => {
      if (e.target.closest('.tl-word-block')) return;
      const rect = trackArea.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const totalDur = state.audioBuf ? state.audioBuf.duration : (state.syncedWords.length ? state.syncedWords[state.syncedWords.length - 1].end : 1);
      PS.seekTo(Math.max(0, Math.min(totalDur, x / PX_PER_SEC)));

      if (e.target === $('#tl-ruler-canvas')) {
        state.isScrubbingRuler = true;
        return;
      }
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
        state.selectedWordIndices.clear();
        state.primarySelectedIdx = -1;
        PS.refreshBlockSelectionVisuals();
        PS.updateInspectorUI();
      }
      state.marqueeState = { startX: x, startY: e.clientY - rect.top, hasDragged: false };
      const m = $('#tl-marquee');
      if (m) m.style.display = 'none';
    });
  }

  window.addEventListener('mousemove', e => {
    if (state.isScrubbingRuler) {
      const area = $('#tl-track-area');
      if (!area) return;
      const rect = area.getBoundingClientRect();
      const totalDur = state.audioBuf ? state.audioBuf.duration : 1;
      PS.seekTo(Math.max(0, Math.min(totalDur, (e.clientX - rect.left) / PX_PER_SEC)));
      return;
    }
    if (state.marqueeState) {
      const area = $('#tl-track-area');
      if (!area) return;
      const rect = area.getBoundingClientRect();
      const curX = Math.max(0, e.clientX - rect.left);
      const curY = Math.max(0, e.clientY - rect.top);
      const bw = Math.abs(curX - state.marqueeState.startX);
      const bh = Math.abs(curY - state.marqueeState.startY);

      if (bw > 5 || bh > 5) {
        state.marqueeState.hasDragged = true;
        const m = $('#tl-marquee');
        if (m) {
          m.style.display = 'block';
          const bx = Math.min(state.marqueeState.startX, curX);
          m.style.left = `${bx}px`;
          m.style.top = `${Math.min(state.marqueeState.startY, curY)}px`;
          m.style.width = `${bw}px`;
          m.style.height = `${bh}px`;
        }

        const bx = Math.min(state.marqueeState.startX, curX);
        state.syncedWords.forEach((w, idx) => {
          if (w.end * PX_PER_SEC >= bx && w.start * PX_PER_SEC <= bx + bw) {
            state.selectedWordIndices.add(idx);
            state.primarySelectedIdx = idx;
          }
        });
        PS.refreshBlockSelectionVisuals();
        PS.updateInspectorUI();
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
        PS.renderStage(0, state.syncedWords[state.tlDragState.pivotIdx].start);
      } else if (state.tlDragState.mode === 'right') {
        const it = state.tlDragState.items[0];
        const w = state.syncedWords[it.idx];
        const newEnd = Math.max(w.start + 0.05, it.origEnd + dt);
        const delta = newEnd - it.origEnd;
        w.end = newEnd;

        const block = $(`#tl-word-${it.idx}`);
        if (block) block.style.width = `${Math.max(18, (w.end - w.start) * PX_PER_SEC)}px`;

        const rippleChk = $('#tl-ripple-chk');
        if (rippleChk && rippleChk.checked && state.tlDragState.origAllDownstream) {
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
        PS.renderStage(0, w.start);
      } else if (state.tlDragState.mode === 'left') {
        const it = state.tlDragState.items[0];
        const w = state.syncedWords[it.idx];
        w.start = Math.max(0, Math.min(w.end - 0.05, it.origStart + dt));
        const block = $(`#tl-word-${it.idx}`);
        if (block) {
          block.style.left = `${w.start * PX_PER_SEC}px`;
          block.style.width = `${Math.max(18, (w.end - w.start) * PX_PER_SEC)}px`;
        }
        PS.renderStage(0, w.start);
      }
      PS.updateInspectorUI();
    }
  });

  window.addEventListener('mouseup', () => {
    state.isScrubbingRuler = false;
    if (state.marqueeState) {
      state.marqueeState = null;
      const m = $('#tl-marquee');
      if (m) m.style.display = 'none';
    }
    if (state.tlDragState) {
      state.syncedWords.sort((a, b) => a.start - b.start);
      state.tlDragState = null;
      PS.renderTimeline();
      PS.renderStage(0, state.currentPlayheadTime);
    }
  });

  // Spacebar Play / Pause
  window.addEventListener('keydown', e => {
    if (e.code === 'Space') {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      PS.togglePlay();
    }
  });

  const btnAnim = $('#btn-anim');
  if (btnAnim) btnAnim.addEventListener('click', () => PS.togglePlay());

  const btnTlPlay = $('#btn-tl-play');
  if (btnTlPlay) btnTlPlay.addEventListener('click', () => PS.togglePlay());

  const btnPrevSync = $('#btn-preview-sync');
  if (btnPrevSync) btnPrevSync.addEventListener('click', () => PS.togglePlay());

  const btnGenSync = $('#btn-gen-sync');
  if (btnGenSync) btnGenSync.addEventListener('click', () => PS.generateSync());

  const btnLiveHover = $('#btn-live-hover-sync');
  if (btnLiveHover) {
    btnLiveHover.addEventListener('click', () => {
      if (state.isLiveHoverSyncing) PS.stopLiveHoverSync();
      else PS.startLiveHoverSync();
    });
  }

  const btnExp = $('#btn-export');
  if (btnExp) btnExp.addEventListener('click', () => PS.doExport());

  const btnReset = $('#btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (typeof PS.stopAnim === 'function') PS.stopAnim();
      if (state.isLiveHoverSyncing && typeof PS.stopLiveHoverSync === 'function') PS.stopLiveHoverSync();
      state.srcImg = null; state.upperData = null; state.lowerData = null;
      state.upperCache = null; state.lowerCache = null;
      state.cutLine = null; state.drawing = false; state.drawStart = null;
      if (typeof PS.clearAllEyes === 'function') PS.clearAllEyes();
      state.syncedWords = []; state.ocrWords = []; state.whisperWords = [];
      state.selectedWordIndices.clear(); state.primarySelectedIdx = -1;
      state.textImage = null;
      if (state.textImageUrl) { URL.revokeObjectURL(state.textImageUrl); state.textImageUrl = null; }
      if (state.syncWorker) { state.syncWorker.terminate(); state.syncWorker = null; }
      state.whisperPipe = null;
      const tdz = $('#text-dropzone');
      if (tdz) tdz.classList.remove('filled');
      safeSetHtml('#text-dropzone-content', '<span class="dz-icon">📝</span><span class="dz-label">Drop script image or click</span>');
      const tfi = $('#text-file-inp');
      if (tfi) tfi.value = '';
      const sti = $('#script-text-input');
      if (sti) sti.value = '';
      const sp = $('#sync-preview');
      if (sp) sp.style.display = 'none';
      safeSetText('#sync-status', 'Load a script image and record audio.');
      safeSetText('#btn-gen-sync', '✨ Generate Sync');
      state.drawMode = 'mouth';
      state.audioBuf = null; state.audioBlob = null; state.ampData = null;
      state.recState = 'idle';
      state.audioCtx?.close().catch(() => {}); state.audioCtx = null;
      state.currentPlayheadTime = 0;

      ctx.fillStyle = '#141416'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#34343a'; ctx.font = '16px "Inter", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Upload an image to begin', W / 2, H / 2);

      const dz = $('#dropzone');
      if (dz) dz.classList.remove('filled');
      safeSetHtml('#dropzone-content', '<span class="dz-icon">🖼</span><span class="dz-label">Drop image or click</span>');
      const fi = $('#file-inp');
      if (fi) fi.value = '';
      ['cut', 'eyes', 'mode', 'record', 'textsync', 'export'].forEach(k => PS.setPanel(k, false));
      const dot = $('#rec-dot');
      if (dot) dot.classList.remove('live', 'ready');
      safeSetText('#rec-time', '0:00');
      safeSetText('#stage-hint', 'Upload an image to begin');
      safeSetHtml('#hint-cut', 'Click &amp; drag across the <strong>mouth</strong> on the stage.');
      const wc = $('#wave-canvas');
      if (wc) wc.getContext('2d').clearRect(0, 0, 1000, 38);
      if (typeof PS.renderTimeline === 'function') PS.renderTimeline();
    });
  }

  setupUploadHandlers();
})();