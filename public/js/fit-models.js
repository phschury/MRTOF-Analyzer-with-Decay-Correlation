// Peak shapes ported from objFit.m: gaussfuncM, EGH, and twoTailGauss.
(function (root) {
  const models = {
    gaussianConstant: { name: 'Gaussian + constant', order: ['baseline', 'sigma', 'amplitude', 'center'] },
    exponentialGaussianHybrid: { name: 'Exponential–Gaussian hybrid (EGH)', order: ['decay', 'sigma', 'amplitude', 'center'] },
    dualExpGaussian: { name: 'Dual exponential Gaussian (DEG)', order: ['rightSwitching', 'leftSwitching', 'sigma', 'amplitude', 'center'] },
  };
  function evaluate(model, x, p) {
    const d = x - p.center;
    const sig2 = p.sigma * p.sigma;
    if (model === 'gaussianConstant') return p.baseline + p.amplitude * Math.exp(-0.5 * d * d / sig2);
    if (model === 'exponentialGaussianHybrid') {
      const denominator = 2 * sig2 - p.decay * d;
      return denominator > 0 ? p.amplitude * Math.exp(-d * d / denominator) : 0;
    }
    if (model === 'dualExpGaussian') {
      if (d > p.rightSwitching) return p.amplitude * Math.exp(0.5 * p.rightSwitching * (p.rightSwitching - 2 * d) / sig2);
      if (d < -p.leftSwitching) return p.amplitude * Math.exp(0.5 * p.leftSwitching * (p.leftSwitching + 2 * d) / sig2);
      return p.amplitude * Math.exp(-0.5 * d * d / sig2);
    }
    throw new Error('Unknown fit model.');
  }
  function fullWidthHalfMaximum(model, p) {
    if (!Object.hasOwn(models, model)) throw new Error('Unknown fit model.');
    if (model === 'gaussianConstant') return 2.3548200450309493 * p.sigma;
    // Trace the peak alone, in units of sigma, to avoid absolute-TOF
    // cancellation and amplitude underflow. Both hybrid peaks peak at center.
    const normalized = { center: 0, amplitude: 1, sigma: 1,
      decay: p.decay / p.sigma, leftSwitching: p.leftSwitching / p.sigma,
      rightSwitching: p.rightSwitching / p.sigma };
    function crossing(direction) {
      let inside = 0, outside = 1;
      while (evaluate(model, direction * outside, normalized) > 0.5) {
        outside *= 2;
        if (!Number.isFinite(outside)) throw new Error('Could not bracket the half-maximum crossing.');
      }
      // Bracket independently on each side; crossings may be outside the ROI.
      for (let i = 0; i < 160; i++) {
        const midpoint = inside + (outside - inside) / 2;
        if (midpoint === inside || midpoint === outside) break;
        if (evaluate(model, direction * midpoint, normalized) > 0.5) inside = midpoint;
        else outside = midpoint;
      }
      return inside + (outside - inside) / 2;
    }
    return (crossing(-1) + crossing(1)) * p.sigma;
  }
  const api = { models, evaluate, fullWidthHalfMaximum };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitModels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
