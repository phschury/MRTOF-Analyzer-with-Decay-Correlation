const addon = require('./build/Release/fitaddon.node');
const { models, evaluate, fullWidthHalfMaximum } = require('./public/js/fit-models');
const { assessCovariance } = require('./fit-diagnostics');
const FWHM = 2.3548200450309493;

function fitPeak(request) {
  const modelId = request.model || 'gaussianConstant';
  if (!Object.hasOwn(models, modelId)) throw new Error('Unknown fit model.');
  const ORDER = models[modelId].order;
  if (!Array.isArray(request.points) || request.points.length < 6 || request.points.length > 100000) throw new Error('Select an ROI containing 6–100,000 bins.');
  const points = request.points;
  if (!points.every(p => [p.x, p.plotX, p.y].every(Number.isFinite) && p.y >= 0)) throw new Error('ROI must contain finite coordinates and nonnegative counts.');
  const origin = points[0].x;
  const low = Math.min(...points.map(p => p.x));
  const high = Math.max(...points.map(p => p.x));
  const scale = high - low;
  if (!(scale > 0)) throw new Error('ROI needs distinct TOF values.');
  if (!points.some(p => p.y > 0)) throw new Error('ROI contains no events.');
  const state = request.initialFitState;
  if (!state?.params || !ORDER.every(key => Number.isFinite(state.params[key]?.value))) throw new Error('Finite initial fit parameters are required.');
  const values = ORDER.map(key => state.params[key].value);
  const constrained = ORDER.map(key => !!state.params[key].fixed);
  const fixed = ORDER.map((key, i) => {
    const uncertainty = state.params[key].sigma;
    if (constrained[i] && (!Number.isFinite(uncertainty) || uncertainty < 0)) {
      throw new Error(`${key}: enter a nonnegative uncertainty; only (0) holds a parameter exactly.`);
    }
    return constrained[i] && uncertainty === 0 ? 1 : 0;
  });
  if (fixed.every(Boolean)) throw new Error('At least one parameter must be free or have a nonzero constraint range.');
  const transform = ORDER.map(key => ['baseline', 'amplitude'].includes(key) ? 1 : scale);
  const offsets = ORDER.map(key => key === 'center' ? origin : 0);
  const physicalBounds = {
    baseline: [0, 1e20], amplitude: [0, 1e20], sigma: [1e-8, 10],
    center: [(low - origin) / scale, (high - origin) / scale],
    decay: [-1e20, 1e20], leftSwitching: [1e-8, 1e20], rightSwitching: [1e-8, 1e20],
  };
  values.forEach((value, i) => { values[i] = (value - offsets[i]) / transform[i]; });
  const lower = ORDER.map(key => physicalBounds[key][0]);
  const upper = ORDER.map(key => physicalBounds[key][1]);
  if (values.some((value, i) => value < lower[i] || value > upper[i])) throw new Error('Initial parameters must have positive width/switchover distances, nonnegative height/background, and a center inside the ROI.');
  for (let i = 0; i < ORDER.length; i++) {
    if (!constrained[i] || fixed[i]) continue;
    const delta = state.params[ORDER[i]].sigma / transform[i];
    lower[i] = Math.max(lower[i], values[i] - delta);
    upper[i] = Math.min(upper[i], values[i] + delta);
    if (!(upper[i] > lower[i])) throw new Error(`${ORDER[i]}: uncertainty is too small to define a numerical range.`);
  }
  const xs = points.map(p => (p.x - origin) / scale);
  // Approximate count-data chi-square; retain empty bins with a variance floor.
  const errors = points.map(p => Math.sqrt(Math.max(p.y, 1)));
  const unpack = p => Object.fromEntries(ORDER.map((key, i) => [key, p[i]]));
  const model = (x, p) => evaluate(modelId, x, p);
  const result = addon.fit({ initialValues: values, fixed, minValues: lower, maxValues: upper, dataLength: points.length },
    p => { const parameters = unpack(p); return xs.map((x, i) => (points[i].y - model(x, parameters)) / errors[i]); });
  if (result.status < 1 || result.status > 4 || !Number.isFinite(result.chi2)) throw new Error(`MPFIT did not converge (status ${result.status}). Check the ROI and initial values.`);
  const covariance = ORDER.map((_, i) => ORDER.map((_, j) => result.covariance[i * ORDER.length + j] * transform[i] * transform[j]));
  const freeAtBound = result.parameterValues.some((value, i) => !fixed[i] &&
    (value === lower[i] || value === upper[i]));
  const covarianceAssessment = assessCovariance(covariance, fixed);
  const uncertaintiesValid = !freeAtBound && covarianceAssessment.valid && ORDER.every((_, i) => fixed[i] || (Number.isFinite(result.errors[i]) && result.errors[i] > 0));
  const params = {};
  for (let i = 0; i < ORDER.length; i++) {
    params[ORDER[i]] = { value: result.parameterValues[i] * transform[i] + offsets[i],
      sigma: fixed[i] ? 0 : uncertaintiesValid ? result.errors[i] * transform[i] : null,
      fixed: constrained[i], absoluteFixed: !!fixed[i],
      bounds: [lower[i] * transform[i] + offsets[i], upper[i] * transform[i] + offsets[i]] };
  }
  const physical = Object.fromEntries(ORDER.map(key => [key, params[key].value]));
  const widthKeys = modelId === 'gaussianConstant' ? ['sigma'] : modelId === 'exponentialGaussianHybrid' ? ['sigma', 'decay'] : ['sigma', 'leftSwitching', 'rightSwitching'];
  const widthHeld = widthKeys.every(key => params[key].absoluteFixed);
  let widthError = widthHeld ? 0 : null;
  if (!widthHeld && uncertaintiesValid) {
    const gradient = ORDER.map(key => {
      if (!widthKeys.includes(key) || params[key].absoluteFixed) return 0;
      if (modelId === 'gaussianConstant') return FWHM;
      let step = 1e-5 * Math.max(Math.abs(physical[key]), physical.sigma);
      if (key !== 'decay') step = Math.min(step, physical[key] / 2);
      return (fullWidthHalfMaximum(modelId, { ...physical, [key]: physical[key] + step }) -
        fullWidthHalfMaximum(modelId, { ...physical, [key]: physical[key] - step })) / (2 * step);
    });
    const variance = gradient.reduce((sum, g, i) => sum + gradient.reduce((row, h, j) => row + g * covariance[i][j] * h, 0), 0);
    widthError = Number.isFinite(variance) && variance >= 0 ? Math.sqrt(variance) : null;
  }
  params.fwhm = { value: fullWidthHalfMaximum(modelId, physical), sigma: widthError, derived: true,
    fixed: widthKeys.every(key => params[key].fixed), absoluteFixed: widthHeld };
  const plotLow = Math.min(...points.map(p => p.plotX));
  const plotHigh = Math.max(...points.map(p => p.plotX));
  const offset = points[0].x - points[0].plotX;
  const fitted = unpack(result.parameterValues);
  const gaussianCoreBins = modelId === 'dualExpGaussian' ? xs.filter(x =>
    x >= fitted.center - fitted.leftSwitching && x <= fitted.center + fitted.rightSwitching).length : null;
  const fitCurve = Array.from({ length: 400 }, (_, i) => {
    const x = plotLow + (plotHigh - plotLow) * i / 399;
    return { x, tofUs: x + offset, y: model((x + offset - origin) / scale, fitted) };
  });
  return { success: true, model: modelId, modelName: models[modelId].name,
    widthConvention: modelId === 'gaussianConstant' ? 'FWHM = 2.3548200450309493 × sigma above background' : 'FWHM traced between the fitted function’s half-maximum crossings',
    status: result.status, message: 'MPFIT optimization converged; this alone does not establish reliable parameters.', params, fitCurve,
    counts: points.reduce((sum, p) => sum + p.y, 0), chi2: result.chi2,
    reducedChi2: result.dof > 0 ? result.chi2 / result.dof : null,
    dof: result.dof, iterations: result.iterations, covariance: uncertaintiesValid ? covariance : null,
    covarianceOrder: ORDER, uncertaintiesValid, covarianceCondition: covarianceAssessment.condition, gaussianCoreBins,
    weighting: 'sqrt(max(count, 1)); covariance is not rescaled by reduced chi-square',
    warning: !uncertaintiesValid ? (freeAtBound ? 'Uncertainties unavailable: a parameter reached a bound.' :
      'Uncertainties unavailable: the parameters are not independently determined (singular or ill-conditioned covariance). ' +
      (gaussianCoreBins === 0 ? 'No bin centers sample the Gaussian core. Use finer bins, constrain shape parameters using known values, or try a simpler model.' :
        'Try finer bins, constrain shape parameters using known values, or use a simpler model.')) :
      result.dof > 0 && result.chi2 / result.dof > 5 ? 'Large reduced chi-square: the selected model may not describe this peak. Uncertainties are conditional on that model.' : null };
}
function fitGaussianConstant(request) {
  if (request.model && request.model !== 'gaussianConstant') throw new Error('Expected Gaussian + constant model.');
  return fitPeak(request);
}
module.exports = { fitPeak, fitGaussianConstant };
