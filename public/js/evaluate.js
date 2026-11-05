/* Evaluation workspace: copies saved fits without changing the source data. */
(() => {
    const dialog = document.getElementById('evaluateDialog');
    const body = document.getElementById('evaluationMeasurements');
    const source = document.getElementById('evaluationSpectrum');
    const status = document.getElementById('evaluationStatus');
    let rows = [], selected = -1;
    const value = x => x === '' || x == null ? '—' : x;
    function cells(row) {
        return ['—', '—', value(row.formula), value(row.charge), value(row.laps),
            fitTimeNanoseconds(row.tof), value(row.mass), '—', '—'];
    }
    function render() {
        body.replaceChildren();
        rows.forEach((row, index) => {
            const tr = document.createElement('tr');
            tr.tabIndex = 0;
            tr.classList.toggle('evaluation-selected', selected === index);
            tr.setAttribute('aria-selected', String(selected === index));
            tr.title = row.sourceName;
            cells(row).forEach(value => {
                const td = document.createElement('td'); td.textContent = value; tr.append(td);
            });
            const select = () => { selected = index; render(); body.children[index]?.focus(); };
            tr.addEventListener('click', select);
            tr.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
            body.append(tr);
        });
        document.getElementById('evaluationDelete').disabled = selected < 0;
        document.getElementById('evaluationRemove').disabled = !rows.length;
        document.getElementById('evaluationExport').disabled = !rows.length;
        status.textContent = `${rows.length} fitted measurement${rows.length === 1 ? '' : 's'}. Mass calculation is not yet configured; unavailable values are shown as —.`;
    }
    function fits(index) {
        const state = loadedFileStates[index];
        return (state?.fits || []).map(fit => ({ ...fit, sourceIndex: index, sourceName: state.displayName }));
    }
    function reload() {
        rows = loadedFileStates.flatMap((_, index) => fits(index)); selected = -1; render();
    }
    document.getElementById('evaluateButton').addEventListener('click', () => { reload(); dialog.showModal(); });
    document.getElementById('evaluateClose').addEventListener('click', () => dialog.close());
    document.getElementById('evaluationReload').addEventListener('click', reload);
    document.getElementById('evaluationRemove').addEventListener('click', () => {
        rows = rows.filter(row => row.sourceIndex !== Number(source.value)); selected = -1; render();
    });
    document.getElementById('evaluationDelete').addEventListener('click', () => {
        if (selected >= 0) rows.splice(selected, 1); selected = -1; render();
    });
    document.getElementById('evaluationExport').addEventListener('click', () => {
        const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
        const headings = [...dialog.querySelector('table').querySelectorAll('th')].map(th => th.textContent);
        const csv = [headings, ...rows.map(cells)].map(row => row.map(quote).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
        const link = document.createElement('a'); link.href = url; link.download = 'fitted-measurements.csv'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
})();
