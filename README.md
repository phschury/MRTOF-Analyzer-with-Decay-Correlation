# MRTOF Analyzer with Decay Correlation

A local browser application for MRTOF spectral fitting, mass analysis, and
correlations with decay-energy list-mode data.

Features include TOF histograms, peak fitting with MPFIT, drift correction,
debouncing, energy calibration, energy and time correlations, and the integrated
UFO Finder / MRTOF Calculator.

## Installation

Install Node.js with npm, Python 3, and a C/C++ build toolchain. The native fitting
module uses node-gyp and C++17. On macOS, install the Xcode Command Line Tools
(`xcode-select --install`). On Windows, use Visual Studio Build Tools with the
Desktop development with C++ workload; on Linux, install your distribution's
compiler and make packages.

```sh
git clone https://github.com/phschury/MRTOF-Analyzer-with-Decay-Correlation.git
cd MRTOF-Analyzer-with-Decay-Correlation
npm ci
npm run build:native
npm start
```

Open http://localhost:3000 in a browser. Stop the application with Ctrl+C in the
terminal. The native fitting module must be compiled on each target computer;
precompiled binaries and installed dependencies are not included.

## Working with data

Use the home page to load your own MRTOF list-mode (`.lst`) files or open the
Energy viewer and UFO Finder. Experimental data are not included in this
repository. Local preferences are stored in `preferences.xml`; generated files
and the saved UFO Finder workspace are stored in `outputs/`. These files are
excluded from version control. Back them up separately when moving computers.

The running server maintains a shared analysis session, so browser windows
connected to the same server share that session.

## Documentation

- [Spectral fitting](FITTING.md)
- [Energy analysis and correlations](ENERGY.md)
- [UFO Finder](calcme2/README.md) (also includes an in-app user manual)

## Tests

After installing dependencies and building the native module, run:

```sh
npm test
```

## Credits and licensing

The package metadata declares MIT for the application. Third-party code and data
retain their respective terms and attribution, including MPFIT (`mpfit.c` and
`mpfit.h`), the NUBASE data files, and the integrated
[UFO Finder / calcme project](https://github.com/phschury/calcme).
The original calcme license reference is preserved in `calcme2/LICENSE.webloc`.
