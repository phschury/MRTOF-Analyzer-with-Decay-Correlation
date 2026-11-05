// fitting.js
//
// UI/controller code for peak fitting.
// This file manages the fit modal and temporary fit preview state.
// All three peak shapes run through the MPFIT worker.

// This is intentionally global so histogram-page.js can include it
// when drawing the chart.
let activeFitPreview = null;
let fitSuccess = false;

let currentFitParams = null;

const defaultFitState = {
  modelName: "Gaussian",

  ion: "",
  charge: 1,
  laps: "",

  params: {
    center: { value: 0, sigma: null, fixed: false },
    fwhm: null,
    sigma: { value: 0, sigma: null, fixed: false },
    amplitude: { value: 0, sigma: null, fixed: false },
    baseline: { value: 0, sigma: null, fixed: false },
    decay: { value: 0, sigma: null, fixed: false },
    leftSwitching: { value: 0, sigma: null, fixed: false },
    rightSwitching: { value: 0, sigma: null, fixed: false },
  },

  counts: 0,
  chi2: null,
  reducedChi2: null,
  roi: null,
  roiData: null,
};

function countEventsInRoi(roiData) {
  return roiData.reduce((sum, p) => sum + p.y, 0);
}

function fitParameterInputs(row = document.querySelector("#fitParamTableBody tr")) {
    if (!row) return {};
    const extra = row.querySelectorAll(".fitExtraParamInput");
    const model = document.getElementById("fitModelSelect").value;
    const widthKey = model === "gaussianConstant" ? "fwhm" : "sigma";
    const inputs = { center: row.querySelector(".fitCenterInput"), [widthKey]: row.querySelector(".fitFwhmInput"), amplitude: extra[0] };
    if (model === "gaussianConstant") inputs.baseline = extra[1];
    else if (model === "exponentialGaussianHybrid") inputs.decay = extra[1];
    else if (model === "dualExpGaussian") { inputs.leftSwitching = extra[1]; inputs.rightSwitching = extra[2]; }
    return inputs;
}

function invalidateFitPreview(message) {
    fitRequestSerial++;
    activeFitPreview = null;
    document.getElementById("fitSaveButton").disabled = true;
    document.getElementById("fitRunButton").disabled = false;
    for (const id of ["fitCountsText", "fitChi2Text", "fitAreaText"]) document.getElementById(id).textContent = "—";
    document.getElementById("fitStatusText").textContent = message;
    drawCombinedChart();
}

function changeFitModel() {
    // Keep all entered values (including invalid text) when switching models.
    const row = document.querySelector("#fitParamTableBody tr");
    if (row) {
        for (const input of row.querySelectorAll("[data-param]")) {
            currentFitParams.entries ||= {};
            currentFitParams.entries[input.dataset.param] = { value: input.value, fixed: input.dataset.fixed === "true" };
            if (["fwhm", "sigma"].includes(input.dataset.param)) {
                const widthKey = document.getElementById("fitModelSelect").value === "gaussianConstant" ? "fwhm" : "sigma";
                const entry = convertFitWidthEntry(input.value, input.dataset.param, widthKey);
                currentFitParams.entries[widthKey] = { value: entry, fixed: input.dataset.fixed === "true" };
                if (widthKey !== input.dataset.param) delete currentFitParams.entries[input.dataset.param];
            }
        }
        currentFitParams.ion = row.querySelector(".fitIonInput").value;
        currentFitParams.charge = row.querySelector(".fitChargeInput").value;
        currentFitParams.laps = row.querySelector(".fitLapsInput").value;
    }
    renderFitParamTable();
    invalidateFitPreview("Model changed. Run Fit again.");
}

function convertFitWidthEntry(text, from, to) {
    if (from === to) return text;
    try {
        const parsed = FitParameters.parse(text);
        const factor = from === "fwhm" ? 1 / 2.3548200450309493 : 2.3548200450309493;
        // Preserve entered precision; display rounding belongs to fitted results.
        return `${parsed.value * factor}(${parsed.uncertainty === null ? "?" : parsed.uncertainty * factor})`;
    } catch { return text; }
}

function validateFitEntry(key, input) {
    let parsed, error = null;
    try { parsed = FitParameters.validate(input.value, key, input.dataset.fixed === "true"); }
    catch (problem) { error = `${key}: ${problem.message}`; }
    const edited = input.value !== input.dataset.cleanValue || (input.dataset.fixed || "false") !== (input.dataset.cleanFixed || "false");
    input.classList.toggle("fitEntryInvalid", !!error);
    input.classList.toggle("fitEntryEdited", !error && edited);
    input.setAttribute("aria-invalid", String(!!error));
    input.setCustomValidity(error || "");
    input.title = error || (input.dataset.fixed === "true" ? "Fixed: value ± uncertainty; (0) holds exactly" : "Free parameter: value(absolute uncertainty)");
    return { parsed, error };
}

function resetFitEntry(key, input) {
    input.dataset.cleanValue = input.value;
    input.dataset.cleanFixed = input.dataset.fixed || "false";
    validateFitEntry(key, input);
}

function initializeFittingUi() {
    const closeButton = document.getElementById("fitModalCloseButton");
    const cancelButton = document.getElementById("fitCancelButton");
    const runButton = document.getElementById("fitRunButton");
    const saveButton = document.getElementById("fitSaveButton");

    if (closeButton) {
        closeButton.addEventListener("click", cancelFitModal);
    }

    if (cancelButton) {
        cancelButton.addEventListener("click", cancelFitModal);
    }

    if (runButton) {
        runButton.addEventListener("click", runFitPreview);
    }

    if (saveButton) {
        saveButton.addEventListener("click", saveFitResult);
        saveButton.disabled = true;
    }

    const peakCountInput = document.getElementById("fitPeakCountInput");

    if (peakCountInput) {
        peakCountInput.addEventListener("change", renderFitParamTable);
    }

    document.getElementById("fitTagSelect").addEventListener("change", () => {
        cancelFitModal();
        openFitModal();
    });
    document.getElementById("fitModelSelect").addEventListener("change", changeFitModel);
    document.getElementById("fitParamTableBody").addEventListener("input", event => {
        if (event.target.matches(".fitCenterInput, .fitFwhmInput, .fitExtraParamInput")) {
            const entry = Object.entries(fitParameterInputs()).find(([, input]) => input === event.target);
            if (entry) validateFitEntry(entry[0], entry[1]);
            fitRequestSerial++;
            activeFitPreview = null;
            document.getElementById("fitSaveButton").disabled = true;
            document.getElementById("fitRunButton").disabled = false;
            document.querySelectorAll(".fitUncertainty").forEach(label => label.remove());
            document.getElementById("fitStatusText").textContent = "Parameters changed. Run Fit again.";
            drawCombinedChart();
        }
    });
    document.getElementById("fitParamTableBody").addEventListener("contextmenu", () => {
        for (const [key, input] of Object.entries(fitParameterInputs())) validateFitEntry(key, input);
        fitRequestSerial++;
        activeFitPreview = null;
        document.getElementById("fitSaveButton").disabled = true;
        document.getElementById("fitRunButton").disabled = false;
        document.querySelectorAll(".fitUncertainty").forEach(label => label.remove());
        document.getElementById("fitStatusText").textContent = "Fixed/free setting changed. Run Fit again.";
        drawCombinedChart();
    });
    initializeFitModalDragging();
}

function openFitModal() {
    if (!roiIsReadyForFit()) {
        return;
    }
    
    fitRequestSerial++;
    activeFitPreview = null;
    document.getElementById("fitRunButton").disabled = false;
    document.getElementById("fitSaveButton").disabled = true;
    for (const id of ["fitCountsText", "fitChi2Text", "fitAreaText"]) document.getElementById(id).textContent = "—";
    populateFitTagSelect();
    const selectedTag =
        Number(document.getElementById("fitTagSelect").value);

    const roiData = extractRoiData(selectedTag);
    
    currentFitParams = makeInitialFitGuess(roiData);

    renderFitParamTable();
    
    const backdrop = document.getElementById("fitModalBackdrop");
    const roiText = document.getElementById("fitModalRoiText");
    const fitStatus = document.getElementById("fitStatusText");

    roiText.textContent =
        currentRoi.lowUs.toFixed(3) +
        " µs → " +
        currentRoi.highUs.toFixed(3) +
        " µs";

    fitStatus.textContent = "Ready to fit ROI.";

    backdrop.classList.remove("hidden");
}

function closeFitModal() {
    document
        .getElementById("fitModalBackdrop")
        .classList.add("hidden");
}

function cancelFitModal() {
    fitRequestSerial++;
    document.getElementById("fitRunButton").disabled = false;
    activeFitPreview = null;

    closeFitModal();

    if (typeof drawCombinedChart === "function") {
        drawCombinedChart();
    }
}

let fitRequestSerial = 0;
async function runFitPreview() {
    const serial = ++fitRequestSerial;
    const fitStatus = document.getElementById("fitStatusText");
    const runButton = document.getElementById("fitRunButton");
    const saveButton = document.getElementById("fitSaveButton");
    saveButton.disabled = true;
    activeFitPreview = null;
    try {
        const model = document.getElementById("fitModelSelect").value;
        if (!Object.hasOwn(FitModels.models, model) || Number(document.getElementById("fitPeakCountInput").value) !== 1) {
            throw new Error("Select one peak and a supported fit model.");
        }
        const inputs = fitParameterInputs();
        const entries = Object.entries(inputs).map(([key, input]) => ({ key, input, ...validateFitEntry(key, input) }));
        const invalid = entries.filter(entry => entry.error);
        if (invalid.length) {
            const message = "Fit not run. Correct the red parameter fields:\n\n" + invalid.map(entry => entry.error).join("\n");
            fitStatus.textContent = message;
            window.alert(message);
            invalid[0].input.focus();
            return;
        }
        for (const { key, input, parsed } of entries) {
            const name = key === "fwhm" ? "sigma" : key;
            const factor = key === "fwhm" ? 2.3548200450309493 : 1;
            currentFitParams.params[name].value = parsed.value / factor;
            currentFitParams.params[name].sigma = parsed.uncertainty === null ? null : parsed.uncertainty / factor;
            currentFitParams.params[name].fixed = input.dataset.fixed === "true";
        }
        runButton.disabled = true;
        fitStatus.textContent = "Fitting with MPFIT…";
        const tag = Number(document.getElementById("fitTagSelect").value);
        const response = await fetch("/api/fit", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, points: extractRoiData(tag), initialFitState: currentFitParams }),
        });
        const result = await response.json();
        if (serial !== fitRequestSerial) return;
        if (!response.ok || !result.ok) throw new Error(result.error || "Fit failed.");
        Object.assign(currentFitParams.params, result.params);
        currentFitParams.modelName = FitModels.models[model].name;
        currentFitParams.chi2 = result.chi2;
        currentFitParams.reducedChi2 = result.reducedChi2;
        for (const [key, input] of Object.entries(inputs)) {
            const p = result.params[key];
            input.value = FitParameters.format(p.value, p.sigma);
            input.title = p.absoluteFixed ? "Held exactly" : p.fixed ? "Constrained to the entered value ± uncertainty" : "Free parameter";
            input.parentElement.querySelector(".fitUncertainty")?.remove();
            resetFitEntry(key, input);
            if (currentFitParams.entries) delete currentFitParams.entries[key];
        }
        activeFitPreview = {
            TAGnum: tag,
            label: `TAG ${tag} ${currentFitParams.modelName} fit`, data: result.fitCurve, borderColor: "#000000", borderWidth: 2,
            fitCenterUs: result.params.center.value, fitCenterSigmaUs: result.params.center.sigma,
            fitFwhmUs: result.params.fwhm.value, countsInRoi: result.counts,
            fitResult: result,
        };
        document.getElementById("fitCountsText").textContent = result.counts.toLocaleString();
        document.getElementById("fitChi2Text").textContent = result.reducedChi2?.toPrecision(6) ?? "—";
        document.getElementById("fitAreaText").textContent = "—";
        fitStatus.textContent = `MPFIT optimization converged in ${result.iterations} iterations. χ² = ${result.chi2.toPrecision(6)}, dof = ${result.dof}.
` +
            (result.warning || "Errors are 1σ, based on sqrt(max(count, 1)) weights; no reduced-χ² rescaling.");
        saveButton.disabled = false;
    } catch (error) {
        if (serial === fitRequestSerial) fitStatus.textContent = error.message;
    } finally {
        if (serial === fitRequestSerial) { runButton.disabled = false; drawCombinedChart(); }
    }
}

let fitIonValidationPending = false;
async function saveFitResult() {
    if (fitIonValidationPending) return;
    if (!validateRequiredFitFields()) {
        document.getElementById("fitStatusText").textContent =
            "Please fill Ion, q, and Laps before saving the fit.";
        return;
    }

    if (!activeFitPreview) {
        document.getElementById("fitStatusText").textContent =
            "No fit preview exists yet. Click Run Fit first.";
        return;
    }

    if (
        typeof loadedFileStates === "undefined" ||
        typeof activeFileStateIndex === "undefined" ||
        activeFileStateIndex < 0
    ) {
        document.getElementById("fitStatusText").textContent =
            "No active dataset is available.";
        return;
    }

    const state = loadedFileStates[activeFileStateIndex];
    const preview = activeFitPreview;
    const serial = fitRequestSerial;
    const fitRows = collectFitTableRows();
    const saveButton = document.getElementById("fitSaveButton");
    fitIonValidationPending = true;
    saveButton.disabled = true;
    try {
        const response = await fetch('/api/ions/validate', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({formulas: fitRows.map(row => row.formula)}),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Could not validate ions against NUBASE.");
        if (activeFitPreview !== preview || fitRequestSerial !== serial || loadedFileStates[activeFileStateIndex] !== state) return;
        if (JSON.stringify(collectFitTableRows()) !== JSON.stringify(fitRows)) {
            document.getElementById("fitStatusText").textContent = "Ion or fit fields changed during validation. Click Save Fit again.";
            return;
        }
        if (!Array.isArray(result.results) || result.results.length !== fitRows.length ||
            result.results.some((entry, index) => entry.formula !== fitRows[index].formula || typeof entry.valid !== 'boolean')) {
            throw new Error("Could not validate ions against NUBASE.");
        }
        const invalid = result.results.filter(entry => !entry.valid);
        const tableRows = [...document.querySelectorAll("#fitParamTableBody tr")];
        result.results.forEach((entry, index) => {
            tableRows[index].querySelector(".fitIonInput")?.classList?.toggle("fitInputMissing", !entry.valid);
        });
        if (invalid.length) {
            document.getElementById("fitStatusText").textContent = "Fit not saved. Ion not found in NUBASE or invalid formula: " +
                invalid.map(entry => entry.formula).join(", ") + ". Use an isotope such as Fr221 or a molecule such as 2C12;3H1;1O16.";
            return;
        }
    } catch (error) {
        document.getElementById("fitStatusText").textContent = error.message;
        return;
    } finally {
        fitIonValidationPending = false;
        saveButton.disabled = !activeFitPreview;
    }

    if (!state.fits) {
        state.fits = [];
    }

    const fitLabel =
        activeFitPreview.fitLabel || "Saved fit";

    const savedDataset = {
        ...activeFitPreview,
        label: fitLabel,
        borderWidth: 2,
        borderDash: [],
    };

    for (const row of fitRows) {
        state.fits.push({
            id: crypto.randomUUID(),
            formula: row.formula,
            charge: row.charge,
            laps: row.laps,

            mass: "",

            tof: row.center !== ""
                ? row.center
                : activeFitPreview.fitCenterUs.toFixed(6),

            dtof: activeFitPreview.fitCenterSigmaUs?.toPrecision(6) ?? "",

            fwhm: String(activeFitPreview.fitFwhmUs),

            counts: activeFitPreview.countsInRoi.toFixed(0),

            roi: {
                lowUs: currentRoi.lowUs,
                highUs: currentRoi.highUs,
            },

            fitResult: activeFitPreview.fitResult,
            chartDataset: savedDataset,
        });
    }

    activeFitPreview = null;
    fitSuccess = true;
    closeFitModal();

    if (typeof renderLoadedFilesList === "function") {
        renderLoadedFilesList();
    }

    if (typeof drawCombinedChart === "function") {
        drawCombinedChart();
    }
}

function estimateRoiMaxCounts(lowUs, highUs) {
    let maxY = 1;

    if (typeof plottedTags === "undefined") {
        return maxY;
    }

    for (const payload of plottedTags.values()) {
        for (const ds of payload.chartData.datasets) {
            for (const p of ds.data) {
                if (
                    p.x >= lowUs &&
                    p.x <= highUs &&
                    Number.isFinite(p.y)
                ) {
                    maxY = Math.max(maxY, p.y);
                }
            }
        }
    }

    return maxY;
}

function extractRoiData(TAG) {
    const wantedTag = Number(TAG);
    const points = [];

    if (!Number.isFinite(wantedTag)) {
        return points;
    }

    if (!roiIsReadyForFit()) {
        return points;
    }

    for (const [tag, payload] of plottedTags.entries()) {
        if (Number(tag) !== wantedTag) {
            continue;
        }

        for (const ds of payload.chartData.datasets) {
            for (const p of ds.data) {
                if (
                    p.x >= currentRoi.lowUs &&
                    p.x <= currentRoi.highUs &&
                    Number.isFinite(p.x) &&
                    Number.isFinite(p.y)
                ) {
                    points.push({
                        x: p.tofUs,
                        plotX: p.x,
                        y: p.y,
                        tag: wantedTag,
                    });
                }
            }
        }
    }

    return points;
}

function populateFitTagSelect() {
    const mainTagSelect = document.getElementById("tag");
    const fitTagSelect = document.getElementById("fitTagSelect");

    if (!mainTagSelect || !fitTagSelect) {
        return;
    }

    const oldValue = fitTagSelect.value;

    fitTagSelect.innerHTML = "";

    for (const option of mainTagSelect.options) {
        const fitOption = document.createElement("option");

        fitOption.value = option.value;
        fitOption.textContent = option.textContent;

        fitTagSelect.appendChild(fitOption);
    }

    if (currentRoi?.tag !== undefined) {
        fitTagSelect.value = String(currentRoi.tag);
    } else if (oldValue !== "") {
        fitTagSelect.value = oldValue;
    } else {
        fitTagSelect.value = mainTagSelect.value;
    }
}

function makeInitialFitGuess(theROIdata) {
    const fitState = structuredClone(defaultFitState);

    fitState.roi = currentRoi ? { ...currentRoi } : null;
    fitState.roiData = theROIdata;
    fitState.counts = countEventsInRoi(theROIdata);

    if (!roiIsReadyForFit() || !theROIdata || theROIdata.length === 0) {
        return fitState;
    }

    let min = Infinity;
    let max = -Infinity;
    let maxIndex = -1;

    for (let i = 0; i < theROIdata.length; i++) {
        const p = theROIdata[i];

        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
            continue;
        }

        if (p.y < min) {
            min = p.y;
        }

        if (p.y > max) {
            max = p.y;
            maxIndex = i;
        }
    }

    if (maxIndex < 0) {
        return fitState;
    }

    const center = theROIdata[maxIndex].x;
    const amplitude = Math.max(max - min, 1);
    const baseline = min;
    const halfMax = baseline + amplitude / 2;

    let fwhmLeft = null;
    let fwhmRight = null;

    for (let i = maxIndex; i >= 0; i--) {
        const p = theROIdata[i];

        if (p.y <= halfMax) {
            fwhmLeft = p.x;
            break;
        }
    }

    for (let i = maxIndex; i < theROIdata.length; i++) {
        const p = theROIdata[i];

        if (p.y <= halfMax) {
            fwhmRight = p.x;
            break;
        }
    }

    let fwhm;

    if (fwhmLeft !== null && fwhmRight !== null) {
        fwhm = Math.abs(fwhmRight - fwhmLeft);
    } else {
        fwhm = Math.max(
            (currentRoi.highUs - currentRoi.lowUs) / 8.0,
            0.001
        );
    }

    fitState.params.center.value = center;
    fitState.params.fwhm = {
        value: fwhm,
        sigma: null,
        fixed: false,
        derived: true,
    };
    fitState.params.sigma.value = fwhm / 2.354820045;
    fitState.params.amplitude.value = amplitude;
    fitState.params.baseline.value = baseline;
    fitState.params.leftSwitching.value = fitState.params.sigma.value;
    fitState.params.rightSwitching.value = fitState.params.sigma.value;
    if (document.getElementById("fitModelSelect").value !== "gaussianConstant") fitState.params.amplitude.value = Math.max(max, 1);

    return fitState;
}

function renderFitParamTable() {
    const tbody = document.getElementById("fitParamTableBody");
    const peakCountInput = document.getElementById("fitPeakCountInput");

    if (!tbody || !peakCountInput) {
        return;
    }

    const nPeaks = Math.max(1, Number(peakCountInput.value || 1));
    const model = document.getElementById("fitModelSelect").value;
    const secondKey = model === "gaussianConstant" ? "baseline" : model === "exponentialGaussianHybrid" ? "decay" : "leftSwitching";
    const second = currentFitParams.params[secondKey];
    const third = currentFitParams.params.rightSwitching;
    document.getElementById("fitParamExtraHeader2").textContent = model === "gaussianConstant" ? "Background" : model === "exponentialGaussianHybrid" ? "Decay λ (µs)" : "Left switch (µs)";
    document.getElementById("fitParamExtraHeader3").textContent = model === "dualExpGaussian" ? "Right switch (µs)" : "Inactive";
    document.getElementById("fitWidthHeader").textContent = model === "gaussianConstant" ? "FWHM (µs)" : "Gaussian σ (µs)";
    document.getElementById("fitModelHint").textContent = model === "gaussianConstant" ? "" :
        " No background term. Gaussian σ is the core standard deviation. Saved FWHM is measured between the fitted curve's half-maximum crossings. " +
        (model === "exponentialGaussianHybrid" ? "Negative λ extends the right tail; positive λ extends the left tail." : "Switch distances are positive offsets from the center; smaller distances give longer tails.");

    tbody.innerHTML = "";

    for (let i = 0; i < nPeaks; i++) {
        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td><input class="fitIonInput" type="text" value=""></td>
            <td><input class="fitChargeInput" type="number" value="1"></td>
            <td><input class="fitLapsInput" type="number" value=""></td>

            <td class="fitCenterCell">
                <input class="fitCenterInput" type="text" value="${FitParameters.format(currentFitParams.params.center.value, currentFitParams.params.center.sigma)}">
            </td>

            <td>
                <input class="fitFwhmInput" type="text" value="${FitParameters.format(currentFitParams.params.fwhm.value, currentFitParams.params.fwhm.sigma)}">
            </td>

            <td>
                <input class="fitExtraParamInput" type="text" value="${FitParameters.format(currentFitParams.params.amplitude.value, currentFitParams.params.amplitude.sigma)}">
            </td>

            <td>
                <input class="fitExtraParamInput" type="text" value="${FitParameters.format(second.value, second.sigma)}">
            </td>

            <td>
                <input class="fitExtraParamInput" type="text" ${model === "dualExpGaussian" ? "" : "disabled"} value="${model === "dualExpGaussian" ? FitParameters.format(third.value, third.sigma) : "—"}">
            </td>
        `;

        const headers = document.querySelectorAll("#fitParamTableHead th");
        Array.from(tr.children).forEach((cell, index) => { cell.dataset.label = headers[index].textContent; });

        // Set user-entered metadata as values so quotes never become markup.
        tr.querySelector(".fitIonInput").value = currentFitParams.ion;
        tr.querySelector(".fitChargeInput").value = currentFitParams.charge;
        tr.querySelector(".fitLapsInput").value = currentFitParams.laps;
        for (const [key, input] of Object.entries(fitParameterInputs(tr))) {
            const saved = currentFitParams.entries?.[key];
            input.dataset.param = key;
            input.value = saved ? saved.value : FitParameters.format(currentFitParams.params[key].value, currentFitParams.params[key].sigma);
            input.dataset.fixed = String(saved ? saved.fixed : currentFitParams.params[key].fixed);
            input.parentElement.classList.toggle("fixed", input.dataset.fixed === "true");
        }

        for (const input of tr.querySelectorAll("input")) {
            input.addEventListener("input", clearMissingFitHighlight);
        }

        const centerCell = tr.querySelector(".fitCenterCell");

        centerCell.addEventListener("contextmenu", (event) => {
            event.preventDefault();

            centerCell.classList.toggle("fixed");

            const input = centerCell.querySelector("input");
            input.dataset.fixed =
                centerCell.classList.contains("fixed") ? "true" : "false";
        });

        const table = document.getElementById("fitParamTable");

        for (let col = 4; col < tr.children.length; col++) {
            const cell = tr.children[col];
            if (cell.querySelector("input").disabled) continue;

            cell.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                toggleFitColumnFixed(table, col);
            });
        }

        tbody.appendChild(tr);
        for (const [key, input] of Object.entries(fitParameterInputs(tr))) resetFitEntry(key, input);
    }
}

function toggleFitColumnFixed(table, columnIndex) {
    const rows = table.querySelectorAll("tbody tr");

    let shouldFix = false;

    for (const row of rows) {
        const cell = row.children[columnIndex];

        if (cell && !cell.classList.contains("fixed")) {
            shouldFix = true;
            break;
        }
    }

    for (const row of rows) {
        const cell = row.children[columnIndex];

        if (!cell) {
            continue;
        }

        cell.classList.toggle("fixed", shouldFix);

        const input = cell.querySelector("input");

        if (input) {
            input.dataset.fixed = shouldFix ? "true" : "false";
        }
    }
}

function initializeFitModalDragging() {
    const modal =
        document.querySelector(".fitModal");

    const header =
        document.querySelector(".fitModalHeader");

    if (!modal || !header) {
        return;
    }

    let dragging = false;

    let startMouseX = 0;
    let startMouseY = 0;

    let startLeft = 0;
    let startTop = 0;

    header.addEventListener("mousedown", (event) => {
        dragging = true;

        startMouseX = event.clientX;
        startMouseY = event.clientY;

        const rect = modal.getBoundingClientRect();

        startLeft = rect.left;
        startTop = rect.top;

        modal.style.position = "absolute";
        modal.style.left = startLeft + "px";
        modal.style.top = startTop + "px";
    });

    document.addEventListener("mousemove", (event) => {
        if (!dragging) {
            return;
        }

        const dx = event.clientX - startMouseX;
        const dy = event.clientY - startMouseY;

        modal.style.left = (startLeft + dx) + "px";
        modal.style.top = (startTop + dy) + "px";
    });

    document.addEventListener("mouseup", () => {
        dragging = false;
    });
}

function validateRequiredFitFields() {
    const rows = document.querySelectorAll("#fitParamTableBody tr");
    let ok = true;

    for (const row of rows) {
        const requiredInputs = [
            row.querySelector(".fitIonInput"),
            row.querySelector(".fitChargeInput"),
            row.querySelector(".fitLapsInput"),
        ];

        for (const input of requiredInputs) {
            if (!input) {
                continue;
            }

            input.classList.remove("fitInputMissing");

            if (input.value.trim() === "") {
                input.classList.add("fitInputMissing");
                ok = false;
            }
        }
    }

    return ok;
}

function clearMissingFitHighlight(event) {
    event.target.classList.remove("fitInputMissing");
}

function collectFitTableRows() {
    const rows = [];

    for (const tr of document.querySelectorAll("#fitParamTableBody tr")) {
        rows.push({
            formula: tr.querySelector(".fitIonInput")?.value.trim() ?? "",
            charge: tr.querySelector(".fitChargeInput")?.value.trim() ?? "",
            laps: tr.querySelector(".fitLapsInput")?.value.trim() ?? "",
            center: String(FitParameters.parse(tr.querySelector(".fitCenterInput").value).value),
        });
    }

    return rows;
}
