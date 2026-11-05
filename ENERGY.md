# Energy Histogram Viewer

Open **Energy Histogram Viewer** from the top page. Load File accepts `.lst`, `.dat`, `.csv`, and `.txt`, and supports multiple files or drag-and-drop. Loaded files are kept separate from ToF spectra and can be selected or removed in the file table. New Session clears both viewers.

## Input formats

The record layout is detected from the comma-separated columns, rather than the filename alone.

- **Niki `.dat`**: `module,channel,pulse_height,timestamp[,additional_parameter]`. Pulse heights are ADC channels. Timestamps are 40-bit counters with a default timebase of **10 ns/tick**, as described in the supplied Niki documentation. Rollover is unwrapped, including late records from the preceding counter epoch.
- **Legacy USB-MCA `.lst`**: `timestamp,channel,pulse_height`. These files do not identify a module and are labeled USB-MCA. The timebase is left unspecified because the supplied legacy file has no metadata establishing its units. Enter the correct ns/tick value to enable time filtering.

The Niki detector labels follow the supplied diagram: module 0, channels 0-15 are the Si array. Module 1 contains GAGG center (0), GAGG side (1), MCS trigger (3), elastic-monitor Si (4), and the box Si detectors: bottom (11), right (12), left (13), top (14), center (15).

## Plot controls

Select a module and channel/detector, set Bin Width, and choose linear or logarithmic counts. Drag to zoom, select Pan in the chart toolbar to move, or double-click to reset. Minimum and Maximum optionally restrict the plotted range.

The Y axis automatically fits the visible Energy range after panning, zooming or resetting, including calibrated spectra and Box detector sum. It uses the visible step heights with 10% headroom, matching the ToF viewer. Linear scale starts at zero; log scale uses a positive baseline and ignores zero counts. Empty visible ranges use safe default limits. Y scaling does not reload event data or change the selected ROI.

**Box detector sum** in Channel / detector includes all events on channels 11 through 15, inclusive, within the selected module (or across all modules when All modules is selected). Each event is converted to keV with its own module/channel calibration before combining the counts. All contributing channels need valid calibrations; a missing calibration is reported rather than mixing raw ADC channels with calibrated energies. The Energy axis section is greyed out and disabled while the sum is selected: display is fixed to keV, with individual channel calibrations and an automatic range. Bin Width remains adjustable in keV. Its ROI bounds and correlation selection are also in calibrated keV. Selecting an individual detector restores the Energy axis controls.

The default X axis is raw pulse height in ADC channels unless the selected detector has a calibration, in which case calibrated keV is selected automatically. Calibrated energy uses `energy [keV] = pulse_height * gain [keV/ch] + offset [keV]`. The viewer does not infer calibration parameters from the data.

Niki files automatically receive these module 1 Box Si defaults from the supplied calibration files:

| Channel | Detector | Gain [keV/ch] | Offset [keV] |
| --- | --- | --- | --- |
| 11 | Bottom | 2.188907 | 88.799035 |
| 12 | Right | 2.117418 | 56.663297 |
| 13 | Left | 2.117418 | 50.311042 |
| 14 | Top | 2.288235 | 78.858824 |
| 15 | Center | 2.219234 | 80.503667 |

Elapsed-time filtering uses time since the earliest recorded timestamp. The lower time and pulse-height limits are inclusive, and upper limits are exclusive. Recorded span is the difference between the earliest and latest event, not an independently recorded acquisition live time. Neither input format supplies acquisition dead-time correction.

## Selecting data and calibration files

Load File uses the browser uploader on all operating systems. Select multiple data files and calibration files together, or drag and drop them onto Load File. Calibration filenames must match `BoxSi_ch11_calib` through `BoxSi_ch15_calib` (an optional `.txt` suffix is accepted). They are read as calibration text, never as event data. The `b:` coefficient becomes gain and `a:` becomes offset for the corresponding module 1 detector. Selected calibrations override the defaults, also apply to already loaded Niki spectra, and remain available for later imports in the same session. New Session restores the built-in defaults. Other modules and USB-MCA files do not receive these defaults.

Files that differ only in the final number before their extension, such as `run_001.dat`, `run_002.dat`, and `run_003.dat`, are combined into one spectrum in numeric order. Other filename groups remain separate spectra. Recorded timestamps are retained, including 40-bit wrap across file boundaries. Combined spectra reference the constituent arrays without copying the events into an additional combined buffer.

Niki events on channels 0 and 1, across all modules, are counted but are not stored. Timestamp range and rollover accounting still include those records. Other channels and legacy USB-MCA `.lst` events are retained.

Batch loading reads one file at a time using standard browser `File.slice()` calls, sending one 4 MiB chunk and waiting for its acknowledgement before reading the next. It does not read a whole file into a browser buffer or require native file pickers, shell commands, or OS-specific APIs. The server parses each chunk incrementally, preserving partial records, UTF-8 text, line numbers and timestamp rollover across chunk boundaries. Parsed events remain in reusable typed-array chunks instead of being copied into another full-file array; consecutive-file groups share those chunks. Progress shows the current file and percentage. Network errors identify the file and progress point; malformed records retain filename, line and record diagnostics.

The decoded event dataset still lives in server RAM. Chunked loading reduces temporary browser/upload/text/copy memory and lets the server answer other requests between chunks; it does not provide disk-backed storage or guarantee that every 12.5 GiB acquisition fits available RAM. A single record is limited to 64 KiB to bound the memory used for an unterminated or corrupt line. Batch results become visible after all selected files finish successfully; failed or cancelled imports leave already-loaded spectra unchanged.

## Region of interest

Hold Ctrl and drag across the histogram to select an ROI, in either direction, just as in the ToF viewer. The selected range is shaded and shown below the plot; Clear ROI removes it. Ordinary dragging still zooms. ROIs are kept separately for each loaded file and module/channel selection while the viewer remains open. Individual detector bounds are stored in ADC channels, so switching to keV or changing the calibration keeps the selection on the same pulse-height interval. Box detector sum bounds are stored in calibrated keV. Selecting or clearing an ROI does not change the zoom or reload the event data.

Right-click inside the histogram for Set ROI start here, Set ROI end here, Clear ROI, and Zoom out. Setting bounds in either order completes the ROI; a single bound is retained until the other is set. If the energy spectrum is connected to a ToF spectrum, the menu also shows Correlate, enabled when the ROI is complete. Click elsewhere or press Escape to close the menu.

For **Box detector sum**, select an ROI around a noise peak and choose **Delete region**. The calibrated keV interval (lower bound inclusive, upper bound exclusive) is excluded from the Box sum histogram, its ROI correlations, and correlation-time references, within the selected module and elapsed-time range. Repeat for other noise peaks. Cuts belong to the Energy spectrum and persist across viewer reloads and incremental series imports. They are analysis exclusions; source files and individual detector views retain their original events. **Restore deleted regions** removes all such cuts for that Energy spectrum. Existing derived spectra refresh their saved Box-sum delays when cuts are added or restored, so subsequent exports do not reuse deleted noise.

Set Pre-time and Post-time in seconds, then choose **Correlate** to create and select a new ToF spectrum. It retains each connected ToF event whose acquisition time falls in `[energy event time − Pre-time, energy event time + Post-time]` around any event in the Energy ROI. Both time-window endpoints are inclusive, overlapping windows do not duplicate ToF events, and the energy ROI includes its lower pulse-height bound and excludes its upper bound. The selected energy module/channel and elapsed-time filter apply to the reference events. ADC bounds are retained when displaying calibrated energy. ToF acquisition time is `sweep × sweep period + recorded ToF` (0.1 ns per ToF bin), with energy elapsed zero aligned to sweep zero as described below; a positive energy timebase and ToF sweep period are required. Numbered energy series use their shared, rollover-adjusted timeline.

The result appears in the ToF Histogram Viewer's loaded spectra and can be saved as a listmode file. The source Energy and ToF spectra are preserved. It inherits the connected ToF spectrum's display settings, with fits, ROI and sweep selection cleared. A valid selection with no matches creates an empty spectrum.

For any ToF spectrum connected to an Energy histogram, select a complete ToF ROI and choose **Correlation time** from the histogram's right-click menu. References are all remaining calibrated Box detector sum events on channels 11–15, excluding deleted regions; no Energy ROI is required. The last Box sum module and elapsed-time selection apply (or the current Energy settings if Box sum has not yet been selected). All contributing channels require calibration. The window lets you choose the Energy source if several histograms are connected. This works on the full ToF spectrum without first creating an Energy-correlated subset, and does not apply the Pre-time/Post-time window. A draggable, resizable, non-modal window shows the time in seconds from each ToF implantation to the next remaining Box detector sum decay event at or after it (Energy time − ToF time). Simultaneous events have delay zero. Events without a following qualifying Energy event are excluded and their number is reported.

The selected ToF ROI (lower bound inclusive, upper bound exclusive), TAG, channel, edge and sweep selection apply. Reopen the menu item to use a different ToF selection; Update reads the cleaned Box detector sum references from the connected Energy histogram. The Energy ROI and individual detector selection do not restrict the decay search. The Time scale selector switches the x-axis between Linear and Log. Linear bin width can be adjusted in seconds, or left blank for automatic bins. Log scale uses 100 bins spaced evenly in log time; zero-delay events cannot appear on a log axis and are omitted and counted separately. Energy-correlated spectra also retain this menu without a live connection: while the original Energy spectrum remains loaded, analysis uses its cleaned Box sum references. Without that source, saved calibrated Box-sum delays are used and survive listmode export/reload. Older saved files without both forward-delay and Box-sum provenance must be recreated or connected to an Energy histogram before time analysis; previous single-detector or backward delays are never interpreted as Box-sum decay times.

Hovering a correlation-time bin with exactly one ToF event also shows the calibrated energy in keV and detector name of its matched next Box-sum Energy event. Bins with zero or multiple events show only their time and count. These details are retained with new saved correlated spectra; older saved files without event details retain their timing plots but cannot show this extra hover information unless the Energy source is available.

Numbered series may also be loaded incrementally. For example, load `file_001.dat`, then add `file_002.dat` later; both appear in the same spectrum, retaining its identifier and detector ROI selections. Adding an earlier-numbered file reorders the source parts before rebuilding the shared timestamp timeline. Re-adding a filename already present in that series is rejected to avoid double-counting. Hover over the spectrum name in the file table to see its constituent filenames.

If an import encounters mixed USB-MCA/Niki records or a malformed line, the error identifies the source filename, physical line number, and offending record excerpt. The failed addition does not alter previously imported spectra, so files can be added one at a time to isolate the problem.

Incomplete Niki lines (fewer than four fields or a missing required field) are skipped. The viewer reports the number skipped; up to five file/line examples are retained for diagnosis. A `.dat` filename allows incomplete leading lines to be skipped before the first complete Niki record. The fifth field is optional, so a missing additional parameter does not discard an otherwise complete event. Invalid numbers or out-of-range values in complete records still produce a file/line error. Incomplete records do not affect event counts, timestamps, or histograms.

## Connecting an energy spectrum to ToF

Click **Connect to ToF** with an energy spectrum loaded, select a currently loaded ToF spectrum, and click Connect. The association is kept on the server for that energy spectrum, including after a page reload or incremental additions to its numbered series. It can be changed or disconnected independently for each energy spectrum.

A connected Energy spectrum and its linked ToF spectrum cannot be removed until disconnected. If several Energy spectra link to the same ToF spectrum, disconnect all of them before removing that ToF spectrum. Remove all other spectra is also blocked when its selection includes a connected ToF spectrum; no spectra are removed by a blocked request. Connection changes update the ToF viewer's removal availability. New Session still clears the entire workspace and its connections.

The connection explicitly assumes simultaneous acquisition starts: the energy spectrum's earliest valid timestamp (including channels 0/1 before their events are discarded) is energy elapsed zero and aligns with sweep zero of the selected ToF spectrum. Stored connection metadata includes that energy tick/timebase and the ToF start time/sweep period when available. This is an assumed alignment, not a clock-synchronization measurement or a file-creation-time inference. New Session clears both viewers and their connections.
