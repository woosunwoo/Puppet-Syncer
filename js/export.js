window.PS = window.PS || {};

(function () {
  const { $, state, W, H, FPS } = PS;

  PS.doExport = async function () {
    if (!state.ampData || !state.upperData || !state.audioBuf) {
      alert('Please make sure you have cut the mouth and recorded voice before exporting.');
      return;
    }

    const btnExport = $('#btn-export');
    btnExport.disabled = true;
    btnExport.textContent = '⏳ Preparing export…';

    // Reset blink timers for clean export
    if (typeof PS.resetBlinkTimers === 'function') PS.resetBlinkTimers();

    const expCanvas = document.createElement('canvas');
    expCanvas.width = W;
    expCanvas.height = H;
    const expCtx = expCanvas.getContext('2d');

    // Pre-paint initial frame at t=0 so the capture stream doesn't grab a black buffer
    expCtx.fillStyle = '#00ff00';
    expCtx.fillRect(0, 0, W, H);
    expCtx.save();
    expCtx.translate(state.puppetPos.x, state.puppetPos.y);
    expCtx.scale(state.puppetPos.scale, state.puppetPos.scale);
    PS.renderFrame(expCtx, (state.ampData && state.ampData[0]) || 0);
    expCtx.restore();

    if (state.textImage) {
      const baseS = Math.min(W / state.textImage.width, H / state.textImage.height) * 0.7;
      const finalScale = baseS * state.textPos.scale;
      expCtx.save();
      expCtx.translate(state.textPos.x, state.textPos.y);
      expCtx.scale(finalScale, finalScale);
      expCtx.drawImage(state.textImage, 0, 0);
      PS.renderTextOverlayOnImage(expCtx, 0);
      expCtx.restore();
    }

    const videoStream = expCanvas.captureStream(FPS);
    const videoTrack = videoStream.getVideoTracks()[0];

    // Setup dedicated AudioContext for real-time capture
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') {
      await actx.resume();
    }

    const dest = actx.createMediaStreamDestination();
    const src = actx.createBufferSource();
    src.buffer = state.audioBuf;
    src.connect(dest);

    const combinedStream = new MediaStream([videoTrack, dest.stream.getAudioTracks()[0]]);

    let vmime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(combinedStream, {
      mimeType: vmime,
      videoBitsPerSecond: 24000000
    });

    const finalChunks = [];
    recorder.ondataavailable = e => {
      if (e.data && e.data.size) finalChunks.push(e.data);
    };

    const exportPromise = new Promise(resolve => {
      recorder.onstop = () => {
        actx.close().catch(() => {});
        const vBlob = new Blob(finalChunks, { type: vmime });
        const url = URL.createObjectURL(vBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `puppet-greenscreen-${Date.now()}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        btnExport.disabled = false;
        btnExport.textContent = '⬇ Export Green‑Screen Video';
        resolve();
      };
    });

    // Start recorder FIRST, then immediately trigger audio and record its exact start time
    recorder.start();
    src.start(0);
    const audioStartTime = actx.currentTime;
    const totalDur = state.audioBuf.duration;

    // Render loop driven by the audio playback clock (eliminates drift completely)
    await new Promise(resolve => {
      function renderLoop() {
        const elapsed = actx.currentTime - audioStartTime;

        if (elapsed >= totalDur) {
          resolve();
          return;
        }

        const frameIdx = Math.floor(elapsed * FPS);
        const mouthOpen = (state.ampData && frameIdx < state.ampData.length) ? state.ampData[frameIdx] : 0;

        // 1. Chroma Green Backdrop
        expCtx.fillStyle = '#00ff00';
        expCtx.fillRect(0, 0, W, H);

        // 2. Puppet Face
        expCtx.save();
        expCtx.translate(state.puppetPos.x, state.puppetPos.y);
        expCtx.scale(state.puppetPos.scale, state.puppetPos.scale);
        PS.renderFrame(expCtx, mouthOpen);
        expCtx.restore();

        // 3. Script / Text Highlights
        if (state.textImage) {
          const baseS = Math.min(W / state.textImage.width, H / state.textImage.height) * 0.7;
          const finalScale = baseS * state.textPos.scale;
          expCtx.save();
          expCtx.translate(state.textPos.x, state.textPos.y);
          expCtx.scale(finalScale, finalScale);
          expCtx.drawImage(state.textImage, 0, 0);
          PS.renderTextOverlayOnImage(expCtx, elapsed);
          expCtx.restore();
        }

        if (typeof videoTrack.requestFrame === 'function') {
          videoTrack.requestFrame();
        }

        const pct = Math.min(99, Math.round((elapsed / totalDur) * 100));
        btnExport.textContent = `⏳ Rendering ${pct}%…`;

        requestAnimationFrame(renderLoop);
      }

      requestAnimationFrame(renderLoop);
    });

    btnExport.textContent = '⏳ Finalizing video…';
    await new Promise(r => setTimeout(r, 200));
    recorder.stop();
    await exportPromise;
  };
})();