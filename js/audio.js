window.PS = window.PS || {};

(function () {
  const { $, state, FPS, NOISE_FLOOR, PX_PER_SEC } = PS;

  PS.computeAmps = function (buffer) {
    const raw = buffer.getChannelData(0);
    const spf = Math.floor(buffer.sampleRate / FPS);
    const nFrames = Math.floor(raw.length / spf);
    const amps = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) {
      let sum = 0, base = i * spf;
      for (let j = 0; j < spf; j++) sum += Math.abs(raw[base + j]);
      amps[i] = sum / spf;
    }
    const peak = Math.max(...amps, 0.0001);
    for (let i = 0; i < amps.length; i++) amps[i] = Math.min(amps[i] / (peak * 0.65), 1);
    const out = new Float32Array(amps.length);
    for (let i = 0; i < amps.length; i++) {
      const prev = i > 0 ? out[i - 1] : 0;
      const rawVal = amps[i] < NOISE_FLOOR ? 0 : amps[i];
      out[i] = prev * 0.7 + rawVal * 0.3;
    }
    return out;
  };

  PS.drawWaveform = function () {
    const waveCanvas = $('#wave-canvas');
    const wfCtx = waveCanvas.getContext('2d');
    if (!state.ampData) return;
    const w = waveCanvas.parentElement.clientWidth;
    waveCanvas.width = w; waveCanvas.height = 38;
    wfCtx.clearRect(0, 0, w, 38);
    const barW = w / state.ampData.length;
    wfCtx.fillStyle = '#e89440';
    for (let i = 0; i < state.ampData.length; i++) {
      const barH = state.ampData[i] * 38 * 0.85;
      wfCtx.fillRect(i * barW, (38 - barH) / 2, Math.max(1, barW - 1), barH);
    }
  };

  PS.togglePlay = function () {
    if (!state.audioBuf) return;
    if (state.isLiveHoverSyncing) {
      if (state.animating) {
        PS.stopAnim(false, false);
        if (state.liveHoverActiveIdx >= 0 && state.liveHoverWords[state.liveHoverActiveIdx]) {
          state.liveHoverWords[state.liveHoverActiveIdx].end = state.currentPlayheadTime;
        }
        $('#stage-hint').innerHTML = '<span style="color:#e89440;font-weight:700;">⏸️ PAUSED:</span> Hover disabled. Move mouse to next line, then press Space to resume.';
      } else {
        if (state.currentPlayheadTime >= state.audioBuf.duration - 0.05) {
          PS.stopLiveHoverSync(); return;
        }
        PS.startAnim(true, state.currentPlayheadTime);
        $('#stage-hint').innerHTML = '<span style="color:#ff4a4a;font-weight:700;">🔴 LIVE SYNC ACTIVE:</span> Hover over words on beat! (Press Space to pause)';
      }
      return;
    }

    if (state.animating) {
      PS.stopAnim(false, false);
    } else {
      const totalDur = state.audioBuf.duration;
      if (state.currentPlayheadTime >= totalDur - 0.05) state.currentPlayheadTime = 0;
      PS.startAnim(true, state.currentPlayheadTime);
    }
  };

  PS.startAnim = function (withAudio = false, offsetSec = 0) {
    PS.stopAnim(false, false);
    state.animating = true;
    $('#btn-anim').textContent = '⏹ Stop';
    $('#btn-tl-play').textContent = '⏹ Stop';

    const t0 = performance.now();
    let audioStartTime = null;

    if (withAudio && state.audioBuf) {
      if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
      try { state.animAudioSrc?.stop(); } catch {}
      state.animAudioSrc = state.audioCtx.createBufferSource();
      state.animAudioSrc.buffer = state.audioBuf;
      state.animAudioSrc.connect(state.audioCtx.destination);
      state.animAudioSrc.onended = () => { state.animAudioSrc = null; };
      const safeOffset = Math.max(0, Math.min(state.audioBuf.duration - 0.001, offsetSec));
      state.animAudioSrc.start(0, safeOffset);
      audioStartTime = state.audioCtx.currentTime;
    }

    function loop() {
      if (!state.animating) return;
      const elapsed = audioStartTime !== null
        ? offsetSec + Math.max(0, state.audioCtx.currentTime - audioStartTime)
        : offsetSec + (performance.now() - t0) / 1000;

      state.currentPlayheadTime = elapsed;
      const idx = Math.floor(elapsed * FPS);
      PS.updatePlayhead(elapsed);

      const tlScrollWrap = $('#tl-scroll-wrap');
      const px = elapsed * PX_PER_SEC;
      if (px > tlScrollWrap.scrollLeft + tlScrollWrap.clientWidth - 40) {
        tlScrollWrap.scrollLeft = px - 80;
      }

      const totalDur = state.audioBuf ? state.audioBuf.duration : (state.syncedWords.length ? state.syncedWords[state.syncedWords.length - 1].end : 0);
      if (state.ampData && idx < state.ampData.length) {
        PS.renderStage(state.ampData[idx], elapsed);
      } else if (elapsed >= totalDur) {
        PS.renderStage(0, totalDur);
        state.currentPlayheadTime = totalDur;
        if (state.isLiveHoverSyncing) PS.stopLiveHoverSync();
        else PS.stopAnim(true, false);
        return;
      } else {
        PS.renderStage(0, elapsed);
      }
      state.animId = requestAnimationFrame(loop);
    }
    state.animId = requestAnimationFrame(loop);
  };

  PS.stopAnim = function (keepCompletedState = false, resetToZero = false) {
    state.animating = false;
    if (state.animId) cancelAnimationFrame(state.animId);
    state.animId = null;
    try { state.animAudioSrc?.stop(); } catch {}
    state.animAudioSrc = null;
    $('#btn-anim').textContent = '🎬 Preview';
    $('#btn-tl-play').textContent = '▶ Play';

    if (resetToZero) state.currentPlayheadTime = 0;
    if (state.upperData) {
      const finalTime = keepCompletedState && state.audioBuf ? state.audioBuf.duration : state.currentPlayheadTime;
      PS.renderStage(0, finalTime);
      PS.updatePlayhead(finalTime);
    }
  };
})();