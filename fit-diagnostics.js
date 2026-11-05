// Assess only free parameters, in dimensionless correlation coordinates.
// Finite positive diagonal entries alone do not establish an invertible fit.
function assessCovariance(covariance, fixed) {
  const free = fixed.map((held, i) => held ? -1 : i).filter(i => i >= 0);
  if (!covariance.flat().every(Number.isFinite) || free.some(i => !(covariance[i][i] > 0))) {
    return { valid: false, condition: null };
  }
  const a = free.map(i => free.map(j => covariance[i][j] / Math.sqrt(covariance[i][i]) / Math.sqrt(covariance[j][j])));
  const n = a.length;
  if (!a.flat().every(Number.isFinite)) return { valid: false, condition: null };
  // Jacobi eigenvalues of the small symmetric correlation matrix (at most 5x5).
  for (let iteration = 0; iteration < 100 * n * n; iteration++) {
    let p = 0, q = 0, largest = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; q = j; }
    }
    if (largest < 1e-14) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(angle), s = Math.sin(angle);
    const pp = a[p][p], qq = a[q][q], pq = a[p][q];
    for (let k = 0; k < n; k++) if (k !== p && k !== q) {
      const kp = a[k][p], kq = a[k][q];
      a[k][p] = a[p][k] = c * kp - s * kq;
      a[k][q] = a[q][k] = s * kp + c * kq;
    }
    a[p][p] = c * c * pp - 2 * s * c * pq + s * s * qq;
    a[q][q] = s * s * pp + 2 * s * c * pq + c * c * qq;
    a[p][q] = a[q][p] = 0;
  }
  const eigenvalues = a.map((row, i) => row[i]);
  const low = Math.min(...eigenvalues), high = Math.max(...eigenvalues);
  // A relative eigenvalue below 1e-10 indicates nearly redundant parameters.
  return { valid: low > high * 1e-10, condition: low > 0 ? high / low : null };
}
module.exports = { assessCovariance };
