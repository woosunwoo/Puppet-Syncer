window.PS = window.PS || {};

(function () {
  const { $, state, W, H } = PS;

  function on(selector, event, handler) {
    const el = $(selector);
    if (el) el.addEventListener(event, handler);
  }

  PS.randomBlinkInterval = function () {
    const r = Math.random();
    if (r < 0.30) return 0.6 + Math.random() * 1.0;
    if (r < 0.75) return 1.0 + Math.random() * 2.0;
    if (r < 0.92) return 2.5 + Math.random() * 2.5;
    return 4.0 + Math.random() * 3.0;
  };

  PS.randomBlinkDuration = function () {
    return 0.07 + Math.random() * 0.12;
  };

  PS.resetBlinkTimers = function () {
    const t = performance.now() / 1000;
    state.blinkState = [0, 1].map(() => ({
      stage: 'idle',
      nextAt: t + PS.randomBlinkInterval(),
      duration: 0,
      pairedWith: -1,
      doubleChance: Math.random()
    }));
  };

  PS.buildEyePatch = function (cx, cy, rx, ry) {
    const w = Math.max(2, Math.ceil(rx * 2));
    const h = Math.max(2, Math.ceil(ry * 2));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cctx = c.getContext('2d');

    if (state.upperCache) {
      const uCtx = state.upperCache.getContext('2d');
      const fullData = uCtx.getImageData(0, 0, W, H).data;
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      const ringRx = rx + 3, ringRy = ry + 3;
      const steps = 64;
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const sx = Math.round(cx + Math.cos(angle) * ringRx);
        const sy = Math.round(cy + Math.sin(angle) * ringRy);
        if (sx >= 0 && sx < W && sy >= 0 && sy < H) {
          const idx = (sy * W + sx) * 4;
          if (fullData[idx + 3] > 128) {
            rSum += fullData[idx]; gSum += fullData[idx + 1]; bSum += fullData[idx + 2]; count++;
          }
        }
      }
      const r = count > 0 ? Math.round(rSum / count) : 212;
      const g = count > 0 ? Math.round(gSum / count) : 184;
      const b = count > 0 ? Math.round(bSum / count) : 150;

      const grad = cctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgb(${r}, ${g}, ${b})`);
      grad.addColorStop(0.5, `rgb(${Math.max(0, r - 12)}, ${Math.max(0, g - 12)}, ${Math.max(0, b - 12)})`);
      grad.addColorStop(1, `rgb(${r}, ${g}, ${b})`);
      cctx.fillStyle = grad;
      cctx.fillRect(0, 0, w, h);
    } else {
      cctx.fillStyle = '#d4b896';
      cctx.fillRect(0, 0, w, h);
    }
    return c;
  };

  PS.rebuildEyePatches = function () {
    if (!state.upperCache) return;
    state.eyes = state.eyes.map(el => el ? ({ ...el, patch: PS.buildEyePatch(el.cx, el.cy, el.rx, el.ry) }) : null);
  };

  PS.setEyeOval = function (index, cx, cy, rx, ry) {
    const patch = PS.buildEyePatch(cx, cy, rx, ry);
    state.eyes[index] = { cx, cy, rx, ry, patch };
    PS.resetBlinkTimers();
    PS.updateEyeUI();
  };

  PS.clearEye = function (index) {
    state.eyes[index] = null;
    PS.updateEyeUI();
  };

  PS.clearAllEyes = function () {
    state.eyes = [null, null];
    PS.updateEyeUI();
  };

  PS.updateEyeUI = function () {
    [0, 1].forEach(idx => {
      const eye = state.eyes[idx];
      const badge = $(`#eye-status-${idx}`);
      const card = $(`#eye-card-${idx}`);
      if (badge) {
        if (eye) {
          badge.textContent = `(${Math.round(eye.cx)}, ${Math.round(eye.cy)})`;
          badge.classList.add('placed');
        } else {
          badge.textContent = 'Not Set';
          badge.classList.remove('placed');
        }
      }
      if (card) {
        card.classList.toggle('selected', state.activeEyeIndex === idx && state.drawMode === 'eyes');
      }
    });

    $('#btn-tab-eye1')?.classList.toggle('active', state.activeEyeIndex === 0);
    $('#btn-tab-eye2')?.classList.toggle('active', state.activeEyeIndex === 1);

    const btnMode = $('#btn-eye-mode');
    if (btnMode) {
      if (state.drawMode === 'eyes') {
        btnMode.textContent = '✓ Done with Eyes';
        btnMode.classList.add('btn-primary');
        btnMode.classList.remove('btn-ghost');
      } else {
        btnMode.textContent = '✏ Add Eye Lines';
        btnMode.classList.remove('btn-primary');
        btnMode.classList.add('btn-ghost');
      }
    }

    if (typeof PS.updateStepIndicators === 'function') PS.updateStepIndicators();
  };

  PS.hitTestEye = function (p) {
    const HANDLE_R = 9;
    for (let i = 1; i >= 0; i--) {
      const e = state.eyes[i];
      if (!e) continue;
      const corners = [
        { name: 'nw', x: e.cx - e.rx, y: e.cy - e.ry },
        { name: 'ne', x: e.cx + e.rx, y: e.cy - e.ry },
        { name: 'sw', x: e.cx - e.rx, y: e.cy + e.ry },
        { name: 'se', x: e.cx + e.rx, y: e.cy + e.ry },
      ];
      for (const c of corners) {
        if (Math.hypot(p.x - c.x, p.y - c.y) < HANDLE_R) {
          return { idx: i, mode: 'resize', corner: c.name };
        }
      }
      const nx = (p.x - e.cx) / Math.max(e.rx, 1);
      const ny = (p.y - e.cy) / Math.max(e.ry, 1);
      if (nx * nx + ny * ny <= 1) return { idx: i, mode: 'move', corner: null };
    }
    return null;
  };

  PS.drawEyeOverlays = function (targetCtx) {
    state.eyes.forEach((el, i) => {
      if (!el) return;
      const isSelected = state.drawMode === 'eyes' && state.activeEyeIndex === i;

      targetCtx.save();
      targetCtx.strokeStyle = isSelected ? '#ffd700' : '#55c0e0';
      targetCtx.lineWidth = isSelected ? 2 : 1.5;
      targetCtx.setLineDash([4, 2]);
      targetCtx.beginPath();
      targetCtx.ellipse(el.cx, el.cy, el.rx, el.ry, 0, 0, Math.PI * 2);
      targetCtx.stroke();
      targetCtx.setLineDash([]);

      targetCtx.fillStyle = isSelected ? 'rgba(255, 215, 0, 0.25)' : 'rgba(85, 192, 224, 0.2)';
      targetCtx.beginPath();
      targetCtx.ellipse(el.cx, el.cy, el.rx, el.ry, 0, 0, Math.PI * 2);
      targetCtx.fill();

      targetCtx.fillStyle = isSelected ? '#ffd700' : '#55c0e0';
      targetCtx.font = '600 11px sans-serif';
      targetCtx.textAlign = 'center';
      targetCtx.fillText(i === 0 ? 'Eye 1 (Left)' : 'Eye 2 (Right)', el.cx, el.cy - el.ry - 8);

      if (state.drawMode === 'eyes') {
        const corners = [
          [el.cx - el.rx, el.cy - el.ry],
          [el.cx + el.rx, el.cy - el.ry],
          [el.cx - el.rx, el.cy + el.ry],
          [el.cx + el.rx, el.cy + el.ry],
        ];
        corners.forEach(([hx, hy]) => {
          targetCtx.fillStyle = isSelected ? '#ffd700' : '#55c0e0';
          targetCtx.beginPath(); targetCtx.arc(hx, hy, 4.5, 0, Math.PI * 2); targetCtx.fill();
          targetCtx.strokeStyle = '#1a1a1c'; targetCtx.lineWidth = 1;
          targetCtx.beginPath(); targetCtx.arc(hx, hy, 4.5, 0, Math.PI * 2); targetCtx.stroke();
        });
      }
      targetCtx.restore();
    });
  };

  PS.renderBlinks = function (tgt) {
    const now = performance.now() / 1000;
    [0, 1].forEach(i => {
      const el = state.eyes[i];
      if (!el) return;
      if (!state.blinkState[i]) {
        state.blinkState[i] = { stage: 'idle', nextAt: now + PS.randomBlinkInterval(), duration: 0 };
      }
      const bs = state.blinkState[i];

      if (bs.stage === 'idle' && now >= bs.nextAt) {
        bs.stage = 'blinking'; bs.since = now; bs.duration = PS.randomBlinkDuration();
      }
      if (bs.stage === 'blinking' && (now - bs.since >= bs.duration)) {
        bs.stage = 'idle'; bs.nextAt = now + PS.randomBlinkInterval();
      }
      let phase = 0;
      if (bs.stage === 'blinking') {
        const t = Math.max(0, Math.min(1, (now - bs.since) / bs.duration));
        if (t < 0.45) phase = (t / 0.45) ** 0.55;
        else if (t < 0.55) phase = 1;
        else phase = 1 - ((t - 0.55) / 0.45) ** 1.7;
      }
      if (phase > 0.01) {
        const minX = Math.floor(el.cx - el.rx);
        const w = Math.ceil(el.rx * 2), h = Math.ceil(el.ry * 2);
        const drawH = h * phase;
        const drawY = el.cy - drawH / 2;
        tgt.save();
        tgt.beginPath();
        tgt.ellipse(el.cx, el.cy, el.rx, el.ry, 0, 0, Math.PI * 2);
        tgt.clip();
        tgt.drawImage(el.patch, minX, drawY, w, Math.max(1, drawH));
        tgt.restore();
      }
    });
  };

  // ── Tab & Button Listeners ──
  on('#btn-tab-eye1', 'click', () => {
    state.activeEyeIndex = 0;
    state.drawMode = 'eyes';
    PS.updateEyeUI();
    PS.redrawAll();
  });

  on('#btn-tab-eye2', 'click', () => {
    state.activeEyeIndex = 1;
    state.drawMode = 'eyes';
    PS.updateEyeUI();
    PS.redrawAll();
  });

  on('#btn-draw-eye-0', 'click', () => {
    state.activeEyeIndex = 0;
    state.drawMode = 'eyes';
    const hint = $('#stage-hint');
    if (hint) hint.textContent = 'Drag an oval around Eye 1 (Left Eye) on stage…';
    PS.updateEyeUI();
    PS.redrawAll();
  });

  on('#btn-draw-eye-1', 'click', () => {
    state.activeEyeIndex = 1;
    state.drawMode = 'eyes';
    const hint = $('#stage-hint');
    if (hint) hint.textContent = 'Drag an oval around Eye 2 (Right Eye) on stage…';
    PS.updateEyeUI();
    PS.redrawAll();
  });

  on('#btn-clear-eye-0', 'click', () => {
    PS.clearEye(0);
    PS.redrawAll();
  });

  on('#btn-clear-eye-1', 'click', () => {
    PS.clearEye(1);
    PS.redrawAll();
  });

  on('#btn-eye-mode', 'click', () => {
    if (state.drawMode === 'eyes') {
      state.drawMode = null; // Exits to Arrange mode
      const hint = $('#stage-hint');
      if (hint) hint.textContent = 'Arrange Mode: Drag elements to move, or drag bottom-right corner to resize.';
      PS.updateEyeUI();
      PS.redrawAll();
      PS.autoUnlock();
    } else {
      state.drawMode = 'eyes';
      const hint = $('#stage-hint');
      if (hint) hint.textContent = `Drawing ${state.activeEyeIndex === 0 ? 'Eye 1 (Left)' : 'Eye 2 (Right)'}…`;
      PS.updateEyeUI();
      PS.redrawAll();
    }
  });

  on('#btn-eye-clear', 'click', () => {
    PS.clearAllEyes();
    PS.redrawAll();
  });

  let testBlinkJob = null;
  on('#btn-eye-test', 'click', () => {
    if (!state.eyes.some(Boolean) || !state.upperData) return;
    if (testBlinkJob) cancelAnimationFrame(testBlinkJob);
    PS.resetBlinkTimers();
    const t0 = performance.now() / 1000;
    state.blinkState.forEach((bs) => { if (bs) bs.nextAt = t0 + 0.15; });
    const btnTest = $('#btn-eye-test');
    if (btnTest) btnTest.disabled = true;
    const endAt = t0 + 3.2;
    function run() {
      PS.redrawAll();
      if (performance.now() / 1000 < endAt) {
        testBlinkJob = requestAnimationFrame(run);
      } else {
        PS.resetBlinkTimers();
        PS.redrawAll();
        if (btnTest) btnTest.disabled = false;
        testBlinkJob = null;
      }
    }
    requestAnimationFrame(run);
  });
})();