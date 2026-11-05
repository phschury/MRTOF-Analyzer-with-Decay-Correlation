self.onmessage = function(event){
  const msg = event.data;
  if(!msg || msg.type !== "start") return;

  try{
    runSearch(msg);
  }
  catch(error){
    self.postMessage({ type: "error", message: error.message || String(error) });
  }
};

function runSearch(msg){
  const isotopeInfo = msg.isotopeInfo;
  const maxElements = msg.maxElements;
  const maxAtoms = msg.maxAtoms;
  const maxNumRI = msg.maxNumRI;
  const q_SCM = msg.q_SCM;
  const ukeV = msg.ukeV;
  const eMasskeV = msg.eMasskeV;
  const job = msg.job;

  const batch = [];
  const batchSize = 50;
  const progressEvery = 20000;
  let visited = 0;
  let visitedSinceLast = 0;

  function flushBatch(){
    if(batch.length > 0){
      self.postMessage({ type: "batch", results: batch.splice(0) });
    }
  }

  function postProgress(){
    self.postMessage({
      type: "progress",
      lapsThis: job.lapsThis,
      visitedSinceLast
    });
    visitedSinceLast = 0;
  }

  function testCandidate(parts, neutralMassKeV, numRI){
    if(parts.length == 0) return;

    const chargedMassU = (neutralMassKeV - q_SCM * eMasskeV) / ukeV;
    const m_dif = job.m_SCM - chargedMassU;

    if(Math.abs(m_dif) < job.massToleranceU){
      batch.push({
        name: parts.join(";"),
        mass: chargedMassU,
        sigma: Math.abs(m_dif) / job.dm_SCM,
        mdevKeV: m_dif * ukeV,
        numRI: numRI,
        laps: job.lapsThis
      });

      if(batch.length >= batchSize) flushBatch();
    }
  }

  function search(startIndex, parts, neutralMassKeV, numRI){
    visited++;
    visitedSinceLast++;

    if(visited % progressEvery === 0) postProgress();

    if(numRI > maxNumRI) return;
    if(neutralMassKeV > job.upperNeutralMassKeV) return;

    testCandidate(parts, neutralMassKeV, numRI);

    if(parts.length >= maxElements) return;

    for(let i = startIndex; i < isotopeInfo.length; i++){
      const iso = isotopeInfo[i];

      for(let n = 1; n <= maxAtoms; n++){
        const nextMassKeV = neutralMassKeV + n * iso.neutralMassKeV;
        if(nextMassKeV > job.upperNeutralMassKeV) break;

        const nextRI = numRI + (iso.isRadioactive ? n : 0);
        if(nextRI > maxNumRI) break;

        const nextParts = parts.concat(String(n) + iso.nuclide);
        search(i + 1, nextParts, nextMassKeV, nextRI);
      }
    }
  }

  search(0, [], 0, 0);
  flushBatch();

  if(visitedSinceLast > 0) postProgress();

  self.postMessage({
    type: "done",
    lapsThis: job.lapsThis,
    visited
  });
}
