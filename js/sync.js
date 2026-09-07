window.PS = window.PS || {};

(function () {
  const { $, state } = PS;

  PS.cleanWord = function (w) {
    return w.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  };

  PS.levenshtein = function (a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const dp = Array.from({ length: m + 1 }, (_, i) => i);
    for (let j = 1; j <= n; j++) {
      let prev = dp[0];
      dp[0] = j;
      for (let i = 1; i <= m; i++) {
        const temp = dp[i];
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + cost);
        prev = temp;
      }
    }
    return dp[m];
  };

  PS.mapTargetWordsToOCRBoxes = function (tokens, ocr) {
    if (!ocr.length) {
      return tokens.map((t, idx) => ({
        word: t, clean: PS.cleanWord(t),
        x: 20 + (idx % 10) * 80, y: 40 + Math.floor(idx / 10) * 35, w: 70, h: 25, line: Math.floor(idx / 10)
      }));
    }
    const out = [];
    let ocrCursor = 0;

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const tokClean = PS.cleanWord(tok);
      let bestMatchIdx = -1, bestDist = Infinity;
      const searchLimit = Math.min(ocr.length, ocrCursor + 14);

      for (let j = ocrCursor; j < searchLimit; j++) {
        const d = PS.levenshtein(tokClean, ocr[j].clean) / Math.max(tokClean.length, ocr[j].clean.length, 1);
        if (d < bestDist) { bestDist = d; bestMatchIdx = j; }
        if (d === 0) break;
      }

      if (bestMatchIdx >= 0 && bestDist <= 0.45) {
        const found = ocr[bestMatchIdx];
        out.push({ word: tok, clean: tokClean, x: found.x, y: found.y, w: found.w, h: found.h, line: found.line ?? 0 });
        ocrCursor = bestMatchIdx + 1;
      } else {
        const prevBox = out[out.length - 1] || ocr[Math.max(0, ocrCursor - 1)];
        const estW = Math.max(30, tok.length * 9);
        out.push({ word: tok, clean: tokClean, x: prevBox.x + prevBox.w + 6, y: prevBox.y, w: estW, h: prevBox.h, line: prevBox.line ?? 0 });
      }
    }
    return out;
  };

  PS.alignWordLists = function (targets, whisper) {
    if (!targets.length) return [];
    const totalDur = state.audioBuf ? state.audioBuf.duration : 1.0;
    if (!whisper.length) {
      const step = totalDur / targets.length;
      return targets.map((w, idx) => ({ ...w, start: idx * step, end: (idx + 1) * step }));
    }

    const n = targets.length, m = whisper.length;
    const normDist = (a, b) => {
      const maxL = Math.max(a.length, b.length, 1);
      if (Math.abs(a.length - b.length) / maxL > 0.45) return 1;
      return PS.levenshtein(a, b) / maxL;
    };

    const GAP = 0.7, MATCH_MAX = 0.45;
    const dp = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
    for (let i = 0; i <= n; i++) dp[i][0] = i * GAP;
    for (let j = 0; j <= m; j++) dp[0][j] = j * GAP;

    for (let i = 1; i <= n; i++) {
      const o = targets[i - 1].clean;
      for (let j = 1; j <= m; j++) {
        const d = normDist(o, whisper[j - 1].clean);
        dp[i][j] = Math.min(
          dp[i - 1][j - 1] + (d <= MATCH_MAX ? d : 1.2),
          dp[i - 1][j] + GAP,
          dp[i][j - 1] + GAP
        );
      }
    }

    let i = n, j = m;
    const matches = new Map();
    while (i > 0 && j > 0) {
      const d = normDist(targets[i - 1].clean, whisper[j - 1].clean);
      const diag = dp[i - 1][j - 1] + (d <= MATCH_MAX ? d : 1.2);
      const up = dp[i - 1][j] + GAP;
      if (Math.abs(dp[i][j] - diag) < 1e-4) {
        if (d <= MATCH_MAX) matches.set(i - 1, j - 1);
        i--; j--;
      } else if (Math.abs(dp[i][j] - up) < 1e-4) {
        i--;
      } else {
        j--;
      }
    }

    const out = targets.map(w => ({ ...w, start: -1, end: -1 }));
    const matchedIndices = [...matches.keys()].sort((a, b) => a - b);

    if (matchedIndices.length === 0) {
      const step = totalDur / n;
      return targets.map((w, idx) => ({ ...w, start: idx * step, end: (idx + 1) * step }));
    }

    for (const oi of matchedIndices) {
      const wi = matches.get(oi);
      out[oi].start = whisper[wi].start;
      out[oi].end = whisper[wi].end;
    }

    if (matchedIndices[0] > 0) {
      const step = out[matchedIndices[0]].start / (matchedIndices[0] + 1);
      for (let r = 0; r < matchedIndices[0]; r++) {
        out[r].start = r * step; out[r].end = (r + 1) * step;
      }
    }

    for (let k = 0; k < matchedIndices.length - 1; k++) {
      const a = matchedIndices[k], b = matchedIndices[k + 1];
      const gap = b - a - 1;
      if (gap > 0) {
        const step = Math.max(0, out[b].start - out[a].end) / (gap + 1);
        for (let g = 1; g <= gap; g++) {
          out[a + g].start = out[a].end + (g - 1) * step;
          out[a + g].end = out[a].end + g * step;
        }
      }
    }

    const lastMatched = matchedIndices[matchedIndices.length - 1];
    if (lastMatched < out.length - 1) {
      const remaining = out.length - 1 - lastMatched;
      const step = Math.max(0.08, (totalDur - out[lastMatched].end) / remaining);
      for (let r = 1; r <= remaining; r++) {
        out[lastMatched + r].start = out[lastMatched].end + (r - 1) * step;
        out[lastMatched + r].end = out[lastMatched].end + r * step;
      }
    }

    let prev = 0;
    for (const w of out) {
      if (w.start < prev) w.start = prev;
      if (w.end <= w.start) w.end = w.start + 0.12;
      prev = w.end;
    }
    return out;
  };

  PS.generateSync = async function () {
    if (!PS.isSyncEnabled() || !state.textImage || !state.audioBlob || state.isGeneratingSync) return;
    state.isGeneratingSync = true;
    PS.updateSyncButton();
    $('#btn-gen-sync').textContent = '⏳ Processing…';
    $('#sync-status').textContent = 'Preparing transcript and boxes…';

    try {
      if (!state.ocrWords.length) await PS.runBackgroundOCR();

      let scriptText = $('#script-text-input').value.trim();
      if (!scriptText && state.ocrWords.length > 0) {
        scriptText = state.ocrWords.map(w => w.word).join(' ');
        $('#script-text-input').value = scriptText;
      }
      const targetTokens = scriptText.split(/\s+/).filter(Boolean);
      if (!targetTokens.length) throw new Error('Please type or paste script text.');

      const mappedTargetBoxes = PS.mapTargetWordsToOCRBoxes(targetTokens, state.ocrWords);

      if (!state.whisperPipe) {
        $('#sync-status').textContent = 'Loading Whisper…';
        const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
        state.whisperPipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', { dtype: 'fp32' });
      }
      $('#sync-status').textContent = 'Whisper transcribing speech…';
      const audioUrl = URL.createObjectURL(state.audioBlob);
      const asr = await state.whisperPipe(audioUrl, { return_timestamps: 'word' });
      URL.revokeObjectURL(audioUrl);

      const totalAudioDur = state.audioBuf ? state.audioBuf.duration : 1.0;
      state.whisperWords = [];
      if (asr.chunks) {
        asr.chunks.forEach(c => {
          let t0 = (c.timestamp && Number.isFinite(c.timestamp[0])) ? c.timestamp[0] : 0;
          let t1 = (c.timestamp && Number.isFinite(c.timestamp[1])) ? c.timestamp[1] : (totalAudioDur > t0 ? totalAudioDur : t0 + 0.5);
          if (t1 <= t0) t1 = totalAudioDur > t0 ? totalAudioDur : t0 + 0.5;

          if (c.words && c.words.length > 0) {
            c.words.forEach(w => {
              let ws = (w.timestamp && Number.isFinite(w.timestamp[0])) ? w.timestamp[0] : t0;
              let we = (w.timestamp && Number.isFinite(w.timestamp[1])) ? w.timestamp[1] : (ws + 0.25 <= totalAudioDur ? ws + 0.25 : totalAudioDur);
              if (we <= ws) we = ws + 0.2;
              state.whisperWords.push({ word: w.word, clean: PS.cleanWord(w.word), start: ws, end: we });
            });
          } else {
            const words = c.text.split(/\s+/).filter(Boolean);
            const dur = t1 - t0;
            words.forEach((w, i) => {
              state.whisperWords.push({ word: w, clean: PS.cleanWord(w), start: t0 + (dur * i / words.length), end: t0 + (dur * (i + 1) / words.length) });
            });
          }
        });
      }

      state.syncedWords = PS.alignWordLists(mappedTargetBoxes, state.whisperWords);
      state.selectedWordIndices.clear();
      state.primarySelectedIdx = -1;
      PS.updateInspectorUI();

      $('#btn-gen-sync').textContent = '✅ Sync Generated';
      $('#sync-status').textContent = `Aligned ${state.syncedWords.length} target words to timeline.`;
      PS.updateSyncUI();
      if (state.upperData) PS.renderStage(0);
      PS.autoUnlock();
    } catch (err) {
      console.error(err);
      $('#sync-status').textContent = 'Error: ' + (err.message || err);
      $('#btn-gen-sync').textContent = 'Retry Sync';
    } finally {
      state.isGeneratingSync = false;
      PS.updateSyncButton();
    }
  };

  PS.startLiveHoverSync = function () {
    if (!state.audioBuf || !state.textImage) return;

    let scriptText = $('#script-text-input').value.trim();
    if (!scriptText && state.ocrWords.length > 0) {
      scriptText = state.ocrWords.map(w => w.word).join(' ');
      $('#script-text-input').value = scriptText;
    }
    const targetTokens = scriptText.split(/\s+/).filter(Boolean);
    if (!targetTokens.length) {
      alert('Please enter or reset script text first.');
      return;
    }

    state.liveHoverWords = PS.mapTargetWordsToOCRBoxes(targetTokens, state.ocrWords).map(w => ({ ...w, start: -1, end: -1 }));
    state.liveHoverActiveIdx = -1;
    state.isLiveHoverSyncing = true;

    $('#btn-live-hover-sync').textContent = '⏹ Finish Live Sync';
    $('#btn-live-hover-sync').classList.replace('btn-ghost', 'btn-danger');
    $('#stage-hint').innerHTML = '<span style="color:#ff4a4a;font-weight:700;">🔴 LIVE SYNC ACTIVE:</span> Hover over words on beat! (Press Space to pause)';

    state.currentPlayheadTime = 0;
    PS.startAnim(true, 0);
  };

  PS.stopLiveHoverSync = function () {
    if (!state.isLiveHoverSyncing) return;
    state.isLiveHoverSyncing = false;
    $('#btn-live-hover-sync').textContent = '🎙️ Live Hover Sync';
    $('#btn-live-hover-sync').classList.replace('btn-danger', 'btn-ghost');
    PS.stopAnim(false, false);

    const totalDur = state.audioBuf ? state.audioBuf.duration : 1.0;
    if (state.liveHoverActiveIdx >= 0 && state.liveHoverWords[state.liveHoverActiveIdx]) {
      state.liveHoverWords[state.liveHoverActiveIdx].end = Math.min(totalDur, Math.max(state.liveHoverWords[state.liveHoverActiveIdx].start + 0.1, state.currentPlayheadTime));
    }

    let prevEnd = 0;
    for (let i = 0; i < state.liveHoverWords.length; i++) {
      const w = state.liveHoverWords[i];
      if (w.start < 0) { w.start = prevEnd; w.end = prevEnd + 0.2; }
      if (w.start < prevEnd) w.start = prevEnd;
      if (w.end <= w.start) w.end = w.start + 0.12;
      prevEnd = w.end;
    }

    state.syncedWords = [...state.liveHoverWords];
    $('#stage-hint').textContent = `Live Hover Sync complete! ${state.syncedWords.length} words mapped to timeline.`;
    $('#sync-status').textContent = `Applied ${state.syncedWords.length} live hover words.`;
    state.selectedWordIndices.clear();
    state.primarySelectedIdx = -1;

    PS.updateSyncUI();
    PS.updateSyncButton();
    PS.renderTimeline();
    PS.renderStage(0, 0);
    PS.autoUnlock();
  };
})();