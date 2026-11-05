(function (root) {
  const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
  const pattern = new RegExp('^\\s*(' + number + ')\\s*(?:\\(\\s*(' + number + '|\\?)\\s*\\))?\\s*$');
  function parse(text) {
    const match = String(text).match(pattern);
    if (!match) throw new Error('Use value(uncertainty), for example 123(2.1).');
    const value = Number(match[1]);
    const uncertainty = match[2] === undefined || match[2] === '?' ? null : Number(match[2]);
    if (!Number.isFinite(value) || (uncertainty !== null && (!Number.isFinite(uncertainty) || uncertainty < 0))) {
      throw new Error('Enter a finite value and a nonnegative uncertainty.');
    }
    return { value, uncertainty };
  }
  function format(value, uncertainty) {
    const display = x => String(Number(x.toPrecision(15)));
    if (uncertainty === null || uncertainty === undefined) return `${display(value)}(?)`;
    if (uncertainty === 0) return `${display(value)}(0)`;
    // Two significant uncertainty digits; round the value to the same place.
    const places = 1 - Math.floor(Math.log10(uncertainty));
    const rounded = x => places >= 0 && places <= 100 ? Number(x.toFixed(places)) : Number((Math.round(x / 10 ** -places) * 10 ** -places).toPrecision(15));
    // The inputs are reused by the next fit: never round a positive parameter
    // to zero or destroy its scale when its uncertainty exceeds its value.
    const shownValue = uncertainty >= Math.abs(value) ? value : rounded(value);
    return `${display(shownValue)}(${display(Number(uncertainty.toPrecision(2)))})`;
  }
  function validate(text, key, constrained) {
    const parsed = parse(text);
    if (constrained && parsed.uncertainty === null) throw new Error('Enter an uncertainty; use (0) to hold the value exactly.');
    if (key === 'fwhm' && parsed.value <= 0) throw new Error('FWHM must be greater than zero.');
    if (key === 'sigma' && parsed.value <= 0) throw new Error('Gaussian σ must be greater than zero.');
    if (['leftSwitching', 'rightSwitching'].includes(key) && parsed.value <= 0) throw new Error('Switchover distance must be greater than zero.');
    if (['center', 'amplitude', 'baseline'].includes(key) && parsed.value < 0) throw new Error('The value must be nonnegative.');
    return parsed;
  }
  const api = { parse, format, validate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitParameters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
