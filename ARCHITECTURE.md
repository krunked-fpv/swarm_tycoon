# Swarm Tycoon: Silicon Foundry — System Architecture

## 1. Overview & Zero-Backend Design
**Swarm Tycoon: Silicon Foundry** (`swarm_tycoon // IDEA-00438`) is a 100% client-side, zero-backend isometric semiconductor cleanroom & autonomous AI-startup idle simulator built with native ES Modules, HTML5/CSS3, procedural Web Audio API synthesis, and a vendored Phaser 3 WebGL runtime (`./vendor/phaser.min.js`).

It deploys directly as static assets to GitHub Pages (`https://krunked-fpv.github.io/swarm_tycoon/`) using exclusively subpath-safe relative (`./`) URLs so any subpath slug works identically without server rewrites.

## 2. Layered Module Boundaries (Zero Circular Dependencies)

```
+-------------------------------------------------------------------+
|  UI Command Deck & App Boot (index.html, src/main.js, src/ui/*)   |
|  - Decoupled 10Hz sim accumulator + 60fps Phaser render loop      |
|  - Daily Challenge isolation & #blueprint= URL hash handling      |
+-------+----------------+-------------------+--------------+-------+
        |                |                   |              |
        v                v                   v              v
+---------------+ +--------------+ +-----------------+ +------------+
| src/sim/*     | | src/economy/*| | src/persistence/*| | src/audio/*|
| 10Hz Grid,    | | BigSilicon,  | | krunked-cookie- | | Procedural |
| Belts, Cryo,  | | 6 Tiers,     | | vault-v1,       | | WebAudio   |
| Power, FOUP,  | | Prestige,    | | Offline Solver, | | DSP Synth  |
| Daily Seeds   | | AI & Crises  | | BP1_ URL Codec  | |            |
+-------+-------+ +--------------+ +-----------------+ +------------+
        ^
        | read-only TypedArray & snapshot state
+-------+-----------------------------------------------------------+
|  Isometric WebGL Renderer (vendor/phaser.min.js, src/render/*)    |
|  - 2:1 Iso projection, Wafer Iridescence & 3-Mode Heatmap PostFX  |
+-------------------------------------------------------------------+
```

### Strict Dependency Direction
1. **`src/sim/*`**: Pure deterministic JavaScript using flat `TypedArray`s. Imports ONLY sibling files inside `src/sim/`. Zero DOM, Phaser, or storage dependencies.
2. **`src/economy/*`**: Pure deterministic JavaScript (`BigSilicon` `{ m, e }` arithmetic, tiers, prestige, AI directors, crises). Imports ONLY sibling files inside `src/economy/`. Zero DOM or Phaser dependencies.
3. **`src/persistence/*`**: Pure storage, cryptography/checksums (`FNV-1a`), RLE `#blueprint=` codec, and analytical offline catch-up solver. Uses plain-object contracts (`{ m, e }` and layout snapshots) with zero imports from `src/sim/`, `src/economy/`, `src/render/`, or `src/ui/`. Supports injectable storage adapters for deterministic Node testing.
4. **`src/render/*`**: Consumes read-only simulation & economy getters passed via `hooks` at scene construction; references `globalThis.Phaser` loaded via `./vendor/phaser.min.js`. Never mutates simulation arrays directly.
5. **`src/audio/*`**: Pure native Web Audio API procedural DSP synthesizer driven by telemetry snapshots and UI/sim events. Zero external media assets.
6. **`src/ui/*` & `src/main.js`**: Orchestrator binding `sim`, `economy`, `persistence`, `render`, and `audio`, managing fixed-timestep tick loops, isolated Daily Challenge sessions, PWA `beforeinstallprompt`, and `./sw.js` registration.

## 3. Dual-Engine Timing Model
- **Simulation Clock**: Fixed `TICK_MS = 100` (10Hz deterministic step). Accumulated via `dt` clamped to `<= 250ms` per frame to prevent tab-switch spiral of death (long gaps are routed through `offlineCatchupSolver.js` when exceeding `5000ms`).
- **Render Clock**: Uncapped `requestAnimationFrame` Phaser 3 loop (target locked 60fps, monitored via a rolling 120-frame `#fps-telemetry-pill`) interpolating wafer positions along belt vectors (`slotProgress`), animating FOUP shuttles, LN2 frost particles, and GLSL PostFX shaders.

## 4. Bidirectional Persistence & Subpath PWA Architecture
- **Primary Storage**: `localStorage["swarm_tycoon_save_v1"]` mirrored asynchronously to IndexedDB (`swarm_tycoon_idb_v1`).
- **Shadow Cookie Vault**: `document.cookie` key `krunked-cookie-vault-v1` storing a compact, FNV-1a signed, Base64URL-encoded payload (`< 3800` bytes) embedding `BP1_` blueprint compression of the active cleanroom grid.
- **Self-Healing Guarantee**: Deleting `localStorage` + IndexedDB auto-heals from `krunked-cookie-vault-v1` on next hydration; deleting cookies auto-regenerates `krunked-cookie-vault-v1` from `localStorage`. `beforeunload` / `visibilitychange` flush skips overwriting when either store is missing, and `blueprintModal.js` surfaces live diagnostics plus reload wipe drills.
- **Offline PWA**: `./manifest.json` (`display: "standalone"`, `start_url: "./"`, `scope: "./"`) + `./sw.js` (`swarm-tycoon-cache-v1`) with network-first dynamic fetch for HTML/JS/CSS, cache cleanup on `activate`, and live `#sw-telemetry-pill` status.

## 5. Exclusive Module Ownership Map
- `src/sim/*`, `tests/sim.test.js` -> `@fab-grid-physicist`
- `vendor/phaser.min.js`, `src/render/*` -> `@litho-shader-artisan`
- `src/economy/*`, `tests/economy.test.js` -> `@yield-chaos-economist`
- `src/persistence/*`, `tests/vault.test.js` -> `@vault-blueprint-cryptographer`
- `src/audio/*` -> `@cleanroom-dsp-synthesist`
- `index.html`, `src/main.js`, `src/ui/*`, `styles/cleanroom.css` -> `@command-deck-ergonomist`
- `manifest.json`, `sw.js`, `icons/*`, `package.json`, `.github/workflows/deploy-pages.yml` -> `@pwa-release-quartermaster`
- `tests/redteam-audit.test.js` -> `@redteam-sre-auditor`
- `ARCHITECTURE.md`, `SPEC.md`, `HANDOFF.md`, `.agents/agents/*.md` -> `@chief-foundry-architect`
