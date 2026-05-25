# Frontend Implementation Notes

This is the living implementation document for the Chrome extension frontend. It tracks the current structure of the extension workspace, what is already implemented, and what should be built next.

## Current Status

- Status: frontend scaffold created
- Build system: Vite + React + TypeScript
- Extension target: Chrome Manifest V3
- Current scope: popup shell, manifest wiring, placeholder background state, content-script bootstrap, shared contracts
- Not implemented yet: backend integration, real run orchestration, Handshake automation

## Stack

- React 19
- TypeScript 5
- Vite 6
- Chrome Extension APIs via `@types/chrome`

## Directory Structure

```text
frontend/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── popup.html
├── public/
│   └── manifest.json
└── src/
    ├── background/
    │   └── index.ts
    ├── content/
    │   └── index.ts
    ├── popup/
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── styles.css
    └── shared/
        ├── constants.ts
        ├── contracts.ts
        └── handshake.ts
```

## File Responsibilities

### Root Files

#### `package.json`
- Defines frontend dependencies and scripts
- Current scripts:
  - `npm run dev`
  - `npm run build`
  - `npm run typecheck`

#### `tsconfig.json`
- TypeScript config for the extension workspace
- Includes Chrome types and Vite client types

#### `vite.config.ts`
- Builds the extension bundle
- Declares three entrypoints:
  - popup
  - background worker
  - content script
- Outputs build artifacts into `frontend/dist`

#### `popup.html`
- HTML shell for the extension popup
- Mount point for the React app

## Extension Runtime Structure

### `public/manifest.json`
- Manifest V3 definition
- Registers:
  - popup page
  - background service worker
  - content script
- Declares current permissions:
  - `storage`
  - `activeTab`
  - `tabs`
- Declares host permissions for:
  - Handshake domains
  - local backend at `http://127.0.0.1:8765/*`

### `src/popup/`

#### `main.tsx`
- React entrypoint
- Mounts the popup app into `#root`

#### `App.tsx`
- Main popup component
- Current responsibilities:
  - fetch placeholder runtime state from background
  - inspect active tab URL
  - classify current page as supported or unsupported
  - render placeholder start/stop controls
  - display placeholder backend panel, run panel, and active-page panel
- Current buttons:
  - `Start`
  - `Stop`
  - `Sync State`
  - `Refresh Page`

#### `styles.css`
- Popup styling
- Defines current visual system for cards, buttons, status badges, and layout

### `src/background/`

#### `index.ts`
- Background service worker scaffold
- Holds in-memory runtime state for the extension
- Handles current placeholder messages:
  - `runtime/get`
  - `runtime/start-placeholder`
  - `runtime/stop-placeholder`
- No backend API calls yet
- No persistent storage yet

### `src/content/`

#### `index.ts`
- Content-script bootstrap
- Runs on supported Handshake domains
- Currently only logs page URL and inferred support status
- No DOM scraping or apply logic yet

### `src/shared/`

#### `contracts.ts`
- Shared frontend types
- Defines:
  - backend health state
  - page support state
  - popup run state
  - runtime state shape
  - popup/background message types

#### `constants.ts`
- Shared constants
- Includes:
  - backend base URL
  - initial runtime state factory

#### `handshake.ts`
- Shared Handshake-specific helpers
- Currently contains page support inference based on URL hostname

## Current Behavior

The frontend currently supports these flows:

1. Load the popup in Chrome
2. Query the background worker for placeholder runtime state
3. Inspect the current active tab URL
4. Mark the page as `supported`, `unsupported`, or `unknown`
5. Start a placeholder run if the active tab is on a supported Handshake domain
6. Stop that placeholder run
7. Re-sync popup state from the background worker

This is intentionally only a frontend skeleton. It proves the extension wiring, popup rendering, message passing, and active-tab inspection.

## Not Implemented Yet

- `GET /api/health` integration
- `GET /api/settings` and `PUT /api/settings`
- run creation through backend
- run finalization through backend
- recent run history UI
- persisted settings UI
- content-script DOM detection for job listings
- apply-button detection
- skip-reason classification
- pagination
- duplicate checks against backend
- real stop orchestration

## Local Run Commands

From the repo root:

```bash
cd /Users/yashponnaganti/Documents/dev/handshakeProject/frontend
npm install
npm run build
```

Load this folder in Chrome:

```text
/Users/yashponnaganti/Documents/dev/handshakeProject/frontend/dist
```

For watch builds:

```bash
cd /Users/yashponnaganti/Documents/dev/handshakeProject/frontend
npx vite build --watch
```

## Implementation Order

The next frontend increments should happen in this order:

### 1. Backend Health and Settings
- Add a small API client under `src/shared/` or `src/popup/`
- Wire:
  - `GET /api/health`
  - `GET /api/settings`
  - `PUT /api/settings`
- Replace the placeholder backend panel with live data

### 2. Background Run Orchestration
- Replace placeholder runtime messages with real messages
- Store:
  - `runId`
  - `isRunning`
  - `isStopping`
  - counts
  - last error
- Add start preflight checks before beginning a run

### 3. Content Script Page Intelligence
- Detect supported Handshake page types
- Extract current job page context
- Send structured page events back to background

### 4. Apply Loop Hooks
- Introduce message contracts for:
  - scan jobs
  - inspect job detail
  - attempt apply
  - stop
- Keep all per-job reporting structured from the start

### 5. Popup Expansion
- Add recent run history
- Add settings form
- Add better run/error states

## Design Rules for Future Frontend Work

- Keep popup state thin; background should own canonical run state
- Keep Handshake DOM logic out of React components
- Put shared contracts in `src/shared/` first, then use them across popup/background/content
- Prefer explicit status enums over ad hoc booleans
- Do not let the popup talk directly to the page DOM
- Keep backend URLs centralized in one place

## Current Gaps to Watch

- The popup currently uses placeholder start/stop messages only
- The background state is in-memory only and resets with service worker lifecycle
- The content script currently proves injection only; it does not communicate back yet
- Hostname support detection is broad and does not yet distinguish listing pages from unsupported Handshake pages

## Ownership Boundary

Frontend in this project means:

- Chrome extension manifest
- popup UI
- background service worker
- content script
- shared frontend contracts and utilities

It does not include:

- Spring Boot backend implementation
- SQLite schema implementation
- backend persistence logic

## Update Policy

This file should be updated whenever one of these changes:

- a new frontend directory or entrypoint is added
- message contracts change
- popup behavior changes
- backend integration is wired
- a new implementation phase starts or finishes
