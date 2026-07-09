# Frontend Implementation Notes

The frontend is a React/TypeScript Chrome Manifest V3 extension built with Vite.

## Runtime pieces

- Popup: health, page diagnostics, run controls, counters, and recent runs.
- Options/onboarding: Google sign-in, document management, and screening answers.
- Background worker: owns run orchestration and authenticated backend calls.
- Content script: scans Handshake jobs and drives supported application flows.

## Data storage

All user data lives in `chrome.storage.local` — the backend keeps nothing:

- documents and resume text (`shared/localDocuments.ts`),
- Google profile, session token, onboarding state (`shared/onboarding.ts`),
- screening preferences and run history (`shared/localData.ts`).

The backend (`shared/backendApi.ts`) is called only for Google sign-in
verification and AI document generation/PDF rendering.

## Authentication

Chrome Identity obtains the Google access token used only for
`POST /api/users/google`. The backend returns a signed HandShook session token,
which is stored in `chrome.storage.local` and attached to subsequent API calls.
Sign-out clears the local session and Chrome's cached Google authorization —
there is no server-side session to revoke.

## Backend configuration

`VITE_BACKEND_BASE_URL` controls the API base URL:

```text
VITE_BACKEND_BASE_URL=https://example.execute-api.us-east-1.amazonaws.com/Prod
```

The Vite build also adds that API Gateway origin to the generated manifest's
`host_permissions`. Local development falls back to
`http://127.0.0.1:8765`.

## Build

```bash
npm install
npm run typecheck
npm run build          # dev build (includes manifest key + localhost permission)
npm run package:store  # store build → handshook-store.zip (no key, no localhost)
```

Load `frontend/dist` as an unpacked extension. After changing the backend URL or
OAuth configuration, rebuild and reload the extension. See `../PUBLISHING.md`
for the Chrome Web Store flow.

## Ownership boundary

- React UI and CSS stay in `popup/` and `options/`.
- Runtime coordination stays in `background/`.
- Handshake DOM automation stays in `content/`.
- API clients, contracts, auth storage, and common constants stay in `shared/`.
