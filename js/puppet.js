window.PS = window.PS || {};

(function () {
  const { state, MAX_ANGLE, MAX_OFFSET } = PS;

  PS.renderFrame = function (tgt, mouthOpen) {
    if (!state.upperData || !state.lowerData) return;
    const mo = Math.max(0, Math.min(1, mouthOpen));

    if (state.mode === 'side') {
      const angle = mo * MAX_ANGLE * (Math.PI / 180);
      const { x1, y1, x2, y2 } = state.cutLine;
      const px = state.pivot === 'left' ? Math.min(x1, x2) : Math.max(x1, x2);
      const py = state.pivot === 'left' ? (x1 < x2 ? y1 : y2) : (x1 > x2 ? y1 : y2);
      const dir = state.pivot === 'left' ? 1 : -1;

      tgt.drawImage(state.lowerCache, 0, 0);
      tgt.save();
      tgt.translate(px, py);
      tgt.rotate(angle * dir);
      tgt.translate(-px, -py);
      tgt.drawImage(state.upperCache, 0, 0);
      PS.renderBlinks(tgt);
      tgt.restore();
    } else {
      const off = mo * MAX_OFFSET;
      tgt.drawImage(state.upperCache, 0, -off);
      tgt.save();
      tgt.translate(0, -off);
      PS.renderBlinks(tgt);
      tgt.restore();
      tgt.drawImage(state.lowerCache, 0, off);
    }
  };
})();