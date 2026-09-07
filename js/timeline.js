window.PS = window.PS || {};

(function () {
  const { $, state, W, H, PX_PER_SEC } = PS;

  // Cached DOM elements
  let domPlayhead = null;
  let domTimeDisp = null;
  let domActiveWord = null;
  let domScrollWrap = null;
  let domTrackArea = null;
  let domRulerCanvas = null;
  let domWaveCanvas = null;
  let domBlocksContainer = null;

  function cacheDOM() {
    domPlayhead = domPlayhead || $('#tl-playhead');
    domTimeDisp = domTimeDisp || $('#tl-time-disp');
    domActiveWord = domActiveWord || $('#tl-active-word');
    domScrollWrap = domScrollWrap || $('#tl-scroll-wrap');
    domTrackArea = domTrackArea || $('#tl-track-area');
    domRulerCanvas = domRulerCanvas || $('#tl-ruler-canvas');
    domWaveCanvas = domWaveCanvas || $('#tl-wave-canvas');
    domBlocksContainer = domBlocksContainer || $('#tl-blocks');
  }

  // Cache word block elements to avoid document.querySelector inside animation loop
  let blockElements = [];
  let currentActiveWordIdx = -1;
  let lastTimeDispSec = -1;

  // Memoized line grouping to prevent array allocations and .sort() every frame
  let cachedWordsRef = null;
  let cachedLines = [];
  let lastHoverActiveIdx = -1;

  function getLineGroups(words) {
    const isLive = state.isLiveHoverSyncing;
    if (!isLive && words === cachedWordsRef && cachedLines.length > 0) {
      return cachedLines;
    }
    if (isLive && words === cachedWordsRef && state.liveHoverActiveIdx === lastHoverActiveIdx && cachedLines.length > 0) {
      return cachedLines;
    }

    cachedWordsRef = words;
    lastHoverActiveIdx = state.liveHoverActiveIdx;

    const lineMap = new Map();
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.start < 0 && !isLive) continue;
      const line = w.line ?? 0;
      if (!lineMap.has(line)) lineMap.set(line, []);
      lineMap.get(line).push(w);
    }

    cachedLines = [];
    lineMap.forEach(group => {
      group.sort((a, b) => a.x - b.x);
      cachedLines.push(group);
    });

    return cachedLines;
  }

  PS.renderStage = function (mouthOpen, currentTime = 0) {
    const mainCanvas = $('#main-canvas');
    if (!mainCanvas) return;
    const ctx = mainCanvas.getContext('2d');
    ctx.fillStyle = '#141416';
    ctx.fillRect(0, 0, W, H);

    // If mouth hasn't been cut yet, draw base unscaled image
    if (!state.upperData) {
      if (state.srcImg) {
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
      return;
    }

    // 1. Puppet Face
    ctx.save();
    ctx.translate(state.puppetPos.x, state.puppetPos.y);
    ctx.scale(state.puppetPos.scale, state.puppetPos.scale);
    PS.renderFrame(ctx, mouthOpen);
    ctx.restore();

    // 2. Script Image
    if (state.textImage) {
      const baseS = Math.min(W / state.textImage.width, H / state.textImage.height) * 0.7;
      const finalScale = baseS * state.textPos.scale;
      ctx.save();
      ctx.translate(state.textPos.x, state.textPos.y);
      ctx.scale(finalScale, finalScale);
      ctx.drawImage(state.textImage, 0, 0);
      PS.renderTextOverlayOnImage(ctx, currentTime);
      ctx.restore();
    }

    // 3. Eye overlays (when editing eyes)
    if (state.drawMode === 'eyes') {
      ctx.save();
      ctx.translate(state.puppetPos.x, state.puppetPos.y);
      ctx.scale(state.puppetPos.scale, state.puppetPos.scale);
      PS.drawEyeOverlays(ctx);
      ctx.restore();
    }

    // 4. Arrange Mode Handles (Face & Script Image)
    if (state.drawMode === null) {
      const pRect = PS.getPuppetRect();
      const tRect = PS.getTextRect();

      const drawEditBounds = (rect, label, isSelected) => {
        ctx.save();
        ctx.strokeStyle = isSelected ? '#55c0e0' : 'rgba(255,255,255,0.3)';
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.setLineDash(isSelected ? [] : [5, 4]);
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.setLineDash([]);

        ctx.fillStyle = isSelected ? '#55c0e0' : 'rgba(255,255,255,0.2)';
        ctx.fillRect(rect.x, rect.y - 20, ctx.measureText(label).width + 12, 20);
        ctx.fillStyle = isSelected ? '#111' : '#fff';
        ctx.font = '600 11px sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(label, rect.x + 6, rect.y - 17);

        // Bottom-Right Corner Resize Anchor
        const hx = rect.x + rect.w, hy = rect.y + rect.h;
        ctx.fillStyle = isSelected ? '#e89440' : 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.arc(hx, hy, 8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#1a1a1c'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(hx, hy, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      };

      if (state.srcImg) drawEditBounds(pRect, 'Puppet Face', state.selectedArrangeElement === 'puppet');
      if (state.textImage) drawEditBounds(tRect, 'Script Image', state.selectedArrangeElement === 'text');
    }
  };

  PS.renderTextOverlayOnImage = function (tgt, currentTime) {
    if (!state.textImage) return;
    const wordsToRender = state.isLiveHoverSyncing ? state.liveHoverWords : state.syncedWords;
    if (!wordsToRender.length) return;

    // Use zero-allocation cached groups
    const lineGroups = getLineGroups(wordsToRender);

    tgt.save();
    for (let g = 0; g < lineGroups.length; g++) {
      const words = lineGroups[g];
      if (words.length === 0) continue;

      if (state.isLiveHoverSyncing) {
        for (let i = 0; i < words.length; i++) {
          const w = words[i];
          if (w.start >= 0) {
            tgt.fillStyle = 'rgba(255, 215, 0, 0.45)';
            tgt.fillRect(w.x - 1, w.y - 1, w.w + 2, w.h + 2);
          } else {
            tgt.strokeStyle = 'rgba(85, 192, 224, 0.5)';
            tgt.lineWidth = 1; tgt.setLineDash([3, 2]);
            tgt.strokeRect(w.x, w.y, w.w, w.h);
          }
        }
        continue;
      }

      let activeIdx = -1;
      let lastStartedIdx = -1;
      for (let i = words.length - 1; i >= 0; i--) {
        const w = words[i];
        if (activeIdx === -1 && currentTime >= w.start && currentTime < w.end) {
          activeIdx = i;
        }
        if (lastStartedIdx === -1 && currentTime >= w.start) {
          lastStartedIdx = i;
        }
        if (activeIdx !== -1 && lastStartedIdx !== -1) break;
      }

      if (state.textSyncMode === 'reveal') {
        for (let i = lastStartedIdx + 1; i < words.length; i++) {
          const w = words[i];
          tgt.fillStyle = state.textBgColor;
          tgt.fillRect(w.x - 1, w.y - 1, w.w + 2, w.h + 2);
        }
        if (activeIdx >= 0) {
          const w = words[activeIdx];
          tgt.fillStyle = 'rgba(255, 215, 0, 0.5)';
          tgt.fillRect(w.x - 2, w.y - 2, w.w + 4, w.h + 4);
        }
      } else {
        if (lastStartedIdx >= 0) {
          const firstW = words[0];
          const lastStartedW = words[lastStartedIdx];
          let barRight;
          if (activeIdx >= 0) {
            const w = words[activeIdx];
            const isAtAudioEnd = state.audioBuf && currentTime >= state.audioBuf.duration - 0.08;
            const frac = isAtAudioEnd ? 1.0 : Math.max(0, Math.min(1, (currentTime - w.start) / Math.max(0.001, w.end - w.start)));
            const prevX = activeIdx > 0 ? words[activeIdx - 1].x + words[activeIdx - 1].w : w.x;
            barRight = Math.max(prevX + (w.x + w.w - prevX) * frac, prevX, w.x);
          } else {
            barRight = lastStartedW.x + lastStartedW.w;
          }
          tgt.fillStyle = 'rgba(255, 215, 0, 0.45)';
          tgt.fillRect(firstW.x, firstW.y - 2, barRight - firstW.x, firstW.h + 4);
        }
      }
    }
    tgt.restore();
  };

  PS.renderTimeline = function () {
    cacheDOM();
    const totalDur = state.audioBuf ? state.audioBuf.duration : (state.syncedWords.length ? state.syncedWords[state.syncedWords.length - 1].end + 1 : 5);
    const trackWidth = Math.max(domScrollWrap ? domScrollWrap.clientWidth : 800, Math.ceil(totalDur * PX_PER_SEC) + 120);

    if (domTrackArea) domTrackArea.style.width = trackWidth + 'px';
    if (domRulerCanvas) {
      domRulerCanvas.width = trackWidth;
      domRulerCanvas.height = 22;
      const tlRulerCtx = domRulerCanvas.getContext('2d');
      tlRulerCtx.clearRect(0, 0, trackWidth, 22);
      tlRulerCtx.fillStyle = '#6e6a60';
      tlRulerCtx.font = '10px "JetBrains Mono", monospace';
      tlRulerCtx.strokeStyle = '#34343a';
      tlRulerCtx.lineWidth = 1;

      for (let s = 0; s <= Math.ceil(totalDur) + 1; s++) {
        const x = Math.round(s * PX_PER_SEC);
        tlRulerCtx.beginPath(); tlRulerCtx.moveTo(x, 12); tlRulerCtx.lineTo(x, 22); tlRulerCtx.stroke();
        const min = Math.floor(s / 60);
        const sec = (s % 60).toString().padStart(2, '0');
        tlRulerCtx.fillText(`${min}:${sec}`, x + 4, 16);
        const hx = Math.round((s + 0.5) * PX_PER_SEC);
        tlRulerCtx.beginPath(); tlRulerCtx.moveTo(hx, 17); tlRulerCtx.lineTo(hx, 22); tlRulerCtx.stroke();
      }
    }

    if (domWaveCanvas) {
      domWaveCanvas.width = trackWidth;
      domWaveCanvas.height = 42;
      const tlWaveCtx = domWaveCanvas.getContext('2d');
      tlWaveCtx.clearRect(0, 0, trackWidth, 42);
      if (state.ampData) {
        tlWaveCtx.fillStyle = '#e89440';
        const nFrames = state.ampData.length;
        for (let i = 0; i < nFrames; i++) {
          const t = i / PS.FPS;
          const x = t * PX_PER_SEC;
          const barH = state.ampData[i] * 38;
          tlWaveCtx.fillRect(x, (42 - barH) / 2, Math.max(1, (PX_PER_SEC / PS.FPS) - 0.5), barH);
        }
      }
    }

    // Invalidate cached line groups whenever timeline rebuilds
    cachedWordsRef = null;
    cachedLines = [];

    PS.renderWordBlocks();
    PS.updatePlayhead(state.currentPlayheadTime);
    PS.updateInspectorUI();
  };

  PS.renderWordBlocks = function () {
    cacheDOM();
    if (!domBlocksContainer) return;
    domBlocksContainer.innerHTML = '';
    blockElements = [];
    currentActiveWordIdx = -1;

    state.syncedWords.forEach((w, idx) => {
      const left = w.start * PX_PER_SEC;
      const width = Math.max(18, (w.end - w.start) * PX_PER_SEC);

      const el = document.createElement('div');
      el.className = 'tl-word-block';
      if (state.selectedWordIndices.has(idx)) el.classList.add('selected');
      el.id = `tl-word-${idx}`;
      el.style.left = `${left}px`;
      el.style.width = `${width}px`;
      el.title = `${w.word} (${w.start.toFixed(2)}s - ${w.end.toFixed(2)}s)`;
      el.innerHTML = `
        <div class="tl-handle left" data-mode="left" data-idx="${idx}"></div>
        <span style="pointer-events:none;padding:0 4px;">${w.word}</span>
        <div class="tl-handle right" data-mode="right" data-idx="${idx}"></div>
      `;

      el.addEventListener('mousedown', e => {
        e.stopPropagation();
        const handle = e.target.closest('.tl-handle');
        const mode = handle ? handle.dataset.mode : 'move';

        if (!handle) {
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            if (state.selectedWordIndices.has(idx)) state.selectedWordIndices.delete(idx);
            else { state.selectedWordIndices.add(idx); state.primarySelectedIdx = idx; }
          } else {
            if (!state.selectedWordIndices.has(idx)) {
              state.selectedWordIndices.clear();
              state.selectedWordIndices.add(idx);
              state.primarySelectedIdx = idx;
            } else {
              state.primarySelectedIdx = idx;
            }
          }
        } else {
          if (!state.selectedWordIndices.has(idx)) {
            state.selectedWordIndices.clear();
            state.selectedWordIndices.add(idx);
            state.primarySelectedIdx = idx;
          }
        }

        PS.refreshBlockSelectionVisuals();
        PS.updateInspectorUI();

        const itemsToDrag = [];
        if (mode === 'move') {
          state.selectedWordIndices.forEach(si => {
            itemsToDrag.push({ idx: si, origStart: state.syncedWords[si].start, origEnd: state.syncedWords[si].end });
          });
        } else {
          itemsToDrag.push({ idx, origStart: state.syncedWords[idx].start, origEnd: state.syncedWords[idx].end });
        }

        state.tlDragState = {
          mode,
          startX: e.clientX,
          items: itemsToDrag,
          pivotIdx: idx,
          origAllDownstream: state.syncedWords.slice(idx + 1).map((dw, i) => ({
            idx: idx + 1 + i, origStart: dw.start, origEnd: dw.end
          }))
        };

        PS.seekTo(w.start);
      });

      domBlocksContainer.appendChild(el);
      blockElements[idx] = el;
    });
  };

  PS.refreshBlockSelectionVisuals = function () {
    for (let idx = 0; idx < state.syncedWords.length; idx++) {
      const el = blockElements[idx];
      if (el) el.classList.toggle('selected', state.selectedWordIndices.has(idx));
    }
  };

  PS.updateInspectorUI = function () {
    const tlInspectorWord = $('#tl-inspector-word');
    const tlDurInput = $('#tl-dur-input');
    if (!tlInspectorWord || !tlDurInput) return;

    if (state.primarySelectedIdx >= 0 && state.primarySelectedIdx < state.syncedWords.length && state.selectedWordIndices.has(state.primarySelectedIdx)) {
      const w = state.syncedWords[state.primarySelectedIdx];
      tlInspectorWord.textContent = `Word: "${w.word}"`;
      tlDurInput.disabled = false;
      tlDurInput.value = (w.end - w.start).toFixed(2);
    } else if (state.selectedWordIndices.size > 0) {
      tlInspectorWord.textContent = `${state.selectedWordIndices.size} words selected`;
      tlDurInput.disabled = true;
      tlDurInput.value = '';
    } else {
      tlInspectorWord.textContent = 'Select Word';
      tlDurInput.disabled = true;
      tlDurInput.value = '';
    }
  };

  PS.seekTo = function (timeSec) {
    const wasPlaying = state.animating;
    if (state.animating) PS.stopAnim(false, false);
    const totalDur = state.audioBuf ? state.audioBuf.duration : (state.syncedWords.length ? state.syncedWords[state.syncedWords.length - 1].end : 60);
    state.currentPlayheadTime = Math.max(0, Math.min(totalDur, timeSec));
    PS.updatePlayhead(state.currentPlayheadTime);
    PS.renderStage(0, state.currentPlayheadTime);
    if (wasPlaying) PS.startAnim(true, state.currentPlayheadTime);
  };

  // High-performance playhead updater: 0 querySelector calls, 0 allocation, O(1) DOM updates
  PS.updatePlayhead = function (timeSec) {
    cacheDOM();
    if (domPlayhead) {
      domPlayhead.style.left = `${timeSec * PX_PER_SEC}px`;
    }

    // Throttle time string formatting to 10Hz to prevent forced style recalculations
    const secRounded = Math.floor(timeSec * 10);
    if (secRounded !== lastTimeDispSec && domTimeDisp) {
      lastTimeDispSec = secRounded;
      const totalDur = state.audioBuf ? state.audioBuf.duration : 0;
      const m = Math.floor(timeSec / 60);
      const s = (timeSec % 60).toFixed(2).padStart(5, '0');
      const tm = Math.floor(totalDur / 60);
      const ts = (totalDur % 60).toFixed(2).padStart(5, '0');
      domTimeDisp.textContent = `${m}:${s} / ${tm}:${ts}`;
    }

    // Find active word with pure memory iteration
    let newActiveIdx = -1;
    for (let i = 0; i < state.syncedWords.length; i++) {
      const w = state.syncedWords[i];
      if (timeSec >= w.start && timeSec < w.end) {
        newActiveIdx = i;
        break;
      }
    }

    // Only mutate DOM when the active word state actually transitions
    if (newActiveIdx !== currentActiveWordIdx) {
      if (currentActiveWordIdx >= 0 && blockElements[currentActiveWordIdx]) {
        blockElements[currentActiveWordIdx].classList.remove('active');
      }
      if (newActiveIdx >= 0 && blockElements[newActiveIdx]) {
        blockElements[newActiveIdx].classList.add('active');
        if (domActiveWord) domActiveWord.textContent = `[${state.syncedWords[newActiveIdx].word}]`;
      } else {
        if (domActiveWord) domActiveWord.textContent = '—';
      }
      currentActiveWordIdx = newActiveIdx;
    }
  };
})();