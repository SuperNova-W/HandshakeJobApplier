# Publishing HandShook to the Chrome Web Store

End-to-end runbook: deploy the backend to AWS Lambda, package the extension,
and publish the listing. Written for the current architecture — a stateless AI
backend (no database) with all user data in `chrome.storage.local`.

The Chrome Web Store item **already exists** (that's where
`GOOGLE_EXTENSION_PUBLIC_KEY` in `frontend/.env` came from), so the extension
ID `eacnhbojhiplfeaddmnfmhihkabajodb` — and therefore the Google OAuth redirect
URI — survives publishing unchanged. Always upload new versions to that same
item.

---

## 0. One-time prerequisites

- **Chrome Web Store developer account** — register at
  https://chrome.google.com/webstore/devconsole with the Google account that
  owns the existing HandShook item ($5 one-time fee, already paid if the item
  exists).
- **AWS CLI + SAM CLI**:
  ```bash
  brew install aws-sam-cli   # aws cli is already installed
  aws configure              # or: aws login
  ```
- **OpenAI spend cap** — in https://platform.openai.com/settings limits, set a
  monthly budget (e.g. $10–20). This is your real protection if the public
  endpoint gets abused; the app's per-user hourly limit and API Gateway
  throttle only slow abuse down.
- **Secrets in `backend/.env`**:
  ```bash
  # AUTH_TOKEN_SECRET is REQUIRED for Lambda — containers must share the
  # signing key or they reject each other's session tokens.
  openssl rand -base64 48   # → AUTH_TOKEN_SECRET=<paste>
  ```
  Also set `GOOGLE_OAUTH_CLIENT_ID` and `OPENAI_API_KEY`, and (recommended)
  `ALLOWED_EXTENSION_ORIGIN=chrome-extension://eacnhbojhiplfeaddmnfmhihkabajodb`
  to pin CORS to the published extension.

## 1. Deploy the backend

```bash
cd backend
./deploy.sh
```

This builds the Lambda zip (`mvn -Plambda clean package`) and deploys the
`handshook-backend` SAM stack: API Gateway (throttled 10 rps / burst 25) →
Lambda `java21` with SnapStart. Copy the **ApiUrl** output.

Smoke test:

```bash
curl -s https://<api-id>.execute-api.<region>.amazonaws.com/Prod/api/health
# → {"status":"UP","version":"0.1.0"}
```

Notes:
- First request after an idle period restores a SnapStart snapshot (~1–3 s);
  warm requests are fast.
- API Gateway caps requests at 29 s. AI generations normally finish well under
  that; if one times out, the extension surfaces the error and the user retries.
- Logs: CloudWatch → log group `/aws/lambda/handshook-backend`.

## 2. Publish the Google OAuth consent screen

In Google Cloud Console → APIs & Services → OAuth consent screen:

1. Fill **App homepage** (`https://handshook.netlify.app`) and **Privacy policy**
   (`https://handshook.netlify.app/privacy.html`).
2. Move the app from **Testing** to **In production** (Publish app). The
   requested scopes (openid, email, profile) are non-sensitive, so no
   verification audit is required — without this step, only allow-listed test
   accounts can sign in to the published extension.

The OAuth client itself needs no changes: the redirect URI
`https://eacnhbojhiplfeaddmnfmhihkabajodb.chromiumapp.org/` still matches
because the extension ID is stable.

## 3. Deploy the privacy policy

`landing/privacy.html` must be live at
`https://handshook.netlify.app/privacy.html` before review — redeploy the
`landing/` folder to Netlify (drag-and-drop in the Netlify UI, or `netlify
deploy --prod --dir landing` if the CLI is set up).

## 4. Build the store package

```bash
cd frontend
# In .env, set VITE_BACKEND_BASE_URL to the ApiUrl from step 1 first!
npm run package:store        # → frontend/handshook-store.zip
```

The store build differs from the dev build on purpose:
- no `key` field (the Web Store rejects zips that contain one; the item already
  owns the ID),
- no `http://127.0.0.1:8765/*` host permission,
- the deployed API origin added to `host_permissions`.

To ship an update later: bump `"version"` in `frontend/public/manifest.json`,
rebuild, re-upload.

## 5. Fill in the store listing

In the developer console, open the existing HandShook item → upload
`handshook-store.zip`.

**Category:** Workflow & Planning (or Productivity → Tools).

**Description draft:**

> HandShook auto-applies to eligible one-click jobs on Handshake from your own
> logged-in browser session — you click Start, it works through the job list,
> answers your saved screening questions, attaches your documents, and logs
> what it applied to and what it skipped.
>
> • Applies only to native "quick apply" postings — never external sites, never
> ambiguous multi-step forms.
> • Generates tailored cover letters and employer-requested documents with AI,
> for your review before anything is submitted.
> • Local-first privacy: your resume, documents, preferences, and history stay
> in your browser. Our server keeps no user data — it has no database.
> • Never sees or stores your Handshake password. You sign in to Handshake
> yourself; HandShook works in that tab, and only when you press Start.
>
> Requires a (free) Google sign-in and a Handshake account.

**Single purpose statement (Privacy tab):**

> Automates submitting eligible one-click job applications on Handshake from
> the user's own session, including generating application documents the user
> reviews before use.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` / `unlimitedStorage` | All user data (resume PDFs, documents, preferences, run history) is stored locally in extension storage instead of on a server; documents exceed the default quota. |
| `activeTab` / `tabs` | To detect whether the active tab is a supported Handshake page and message the automation content script in that tab. |
| `identity` / `identity.email` | Google sign-in via `launchWebAuthFlow`; the email identifies the user's session to our stateless API. |
| Host: `*.joinhandshake.com`, `*.handshake.com` | The content script that scans job cards and fills application forms runs only on Handshake pages. |
| Host: `https://<api-id>.execute-api…` | The extension's own backend API (sign-in verification and AI document generation). |
| Remote code | None — all code is packaged in the extension. |

**Data-use disclosures (check exactly these):**
- *Personally identifiable information* (name, email — from Google sign-in) and
  *Authentication information* (OAuth token, verified then discarded).
- *Website content* (job-posting text sent for AI generation when the user
  requests it) and *User activity* only if the reviewer asks about run counters
  (they are stored locally, not transmitted).
- Certify: data is **not sold**, **not used for unrelated purposes**, **not
  used for creditworthiness**. Transferred to service providers (OpenAI) only
  as part of the extension's single purpose.

**Privacy policy URL:** `https://handshook.netlify.app/privacy.html`

**Graphics you must produce by hand:**
- At least one screenshot, 1280×800 (popup open on a Handshake page; options
  page; a generated cover-letter review are good candidates).
- Small promo tile 440×280 (required for some surfaces; reuse brand assets in
  `landing/brand/`).

**Reviewer notes (paste into the "Notes for reviewer" box):**

> Testing requires a Handshake (joinhandshake.com) student account, which is
> gated to university students. Without one: install, sign in with any Google
> account, and open the options page to see the document/preferences flows.
> The automation only acts on handshake.com job pages after the user clicks
> Start in the popup, and stops via the Stop button. Nothing runs in the
> background on install; no data leaves the browser except the AI generation
> requests described in the privacy policy.

## 6. Submit

Visibility: **Public** → Submit for review. Reviews typically take a few days;
automation-heavy extensions sometimes get a closer look. If rejected, the
rejection email cites the policy — reply through the appeal link with the
reviewer notes above; the single-purpose statement and local-first privacy
design are the strongest arguments.

**Heads-up on policy risk:** HandShook automates a third-party site. That is
allowed on the Web Store (many job-application autofillers exist), but it
likely violates Handshake's own Terms of Service — accounts that hammer the
site could be actioned by Handshake. The manual Start, per-action delays, and
skip guardrails are the mitigations; keep them.

## 7. After it's live

- Install from the store link, sign in, and run the full flow once.
- Watch CloudWatch logs and the OpenAI usage dashboard for the first days.
- The unpacked dev workflow is unchanged: `npm run build`, load `dist/`,
  backend via `backend/run.sh` — the dev build still talks to
  `http://127.0.0.1:8765` when `VITE_BACKEND_BASE_URL` is unset.

## Cost summary

| Item | Cost |
| --- | --- |
| Chrome Web Store registration | $5 once (already paid) |
| Lambda + API Gateway | ~$0 idle; pennies at portfolio traffic (SnapStart is free for Java) |
| OpenAI API | Usage-based — set the monthly cap |
| Netlify landing | Free tier |
