# Voiceflow API

The backend for Voiceflow, an app where customers record a short voice note and admins review what they said. Each recording is transcribed in its original language and in English, and analysed for sentiment.

It is a REST API built with Express 5 and TypeScript. Audio never passes through the API: the browser uploads straight to object storage, and a background job (Inngest) does the transcription and analysis.

- App: https://voiceflow.mayurgadakh.dev
- API: https://api.voiceflow.mayurgadakh.dev
- Architecture, diagrams and design decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Contents

- [Stack](#stack)
- [How it works](#how-it-works)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Testing](#testing)
- [Project structure](#project-structure)
- [API reference](#api-reference)
- [Authentication and access control](#authentication-and-access-control)
- [Storage](#storage)
- [Database](#database)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)

## Stack

| Area | Choice |
| --- | --- |
| Runtime | Node.js 22 or newer, ESM |
| Framework | Express 5, TypeScript |
| Auth | Better Auth (email and password, `admin` plugin) |
| Database | PostgreSQL through Prisma 7 with the `pg` adapter |
| Audio storage | Any S3-compatible service (AWS S3, Supabase Storage, Cloudflare R2, MinIO) |
| Speech to text | Sarvam `saaras:v3` (Indian languages and English) |
| Sentiment | Vercel AI SDK with OpenRouter, default model `openai/gpt-4o-mini` |
| Background jobs | Inngest, served from Express at `/api/inngest` |
| Email | Resend |
| Validation | zod |
| Logging | pino |

## How it works

```text
Browser ──/api──> Express ──> PostgreSQL (Prisma)
   │                 │
   │                 └──> Inngest  (event: feedback/uploaded)
   │                         │
   │                         v
   │               /api/inngest runs the steps:
   │               claim ─> speech (Sarvam x2) ─> sentiment (LLM) ─> PostgreSQL
   │
   └── audio, signed upload URL ──> S3-compatible storage
```

1. **Register.** `POST /api/feedback` validates the request (type, size, length, consent), creates a `Feedback` row in `UPLOADING`, and returns a signed upload URL. The server builds the storage path itself (`{userId}/{feedbackId}.{ext}`).
2. **Upload.** The browser `PUT`s the audio straight to storage. The signed URL fixes the content type and exact size.
3. **Confirm.** `POST /api/feedback/:id/complete` checks the file exists with the right size, moves the row to `UPLOADED` with one conditional update (a second confirm gets 409), and sends the `feedback/uploaded` event.
4. **Process.** The `process-feedback` Inngest function runs three steps, each retried on its own:
   - `claim` sets `PROCESSING`. A duplicate or stale event finds the row already handled and stops.
   - `speech` downloads the audio, calls Sarvam twice in parallel (original language and English), and saves the transcript. It skips itself if a transcript already exists.
   - `sentiment` analyses the English text, then saves the result and sets `COMPLETED` in one transaction.
5. **Read.** Customers poll `GET /api/feedback/:id` and see the transcript. Admins see everything, including sentiment and the audio.
6. **Clean up.** A scheduled function (`housekeeping`) runs every 10 minutes. See [Scheduled cleanup](#scheduled-cleanup).

The transcript is saved before sentiment runs, so a sentiment failure never repeats the paid speech calls.

### Statuses

| Status | Meaning | Moves to |
| --- | --- | --- |
| `UPLOADING` | Row created, audio not confirmed | `UPLOADED` |
| `UPLOADED` | Confirmed and queued | `PROCESSING` |
| `PROCESSING` | The pipeline is running | `COMPLETED` or `FAILED` |
| `COMPLETED` | Transcript and analysis saved | Admin can reprocess |
| `FAILED` | The pipeline gave up, `errorCode` says why | Admin can reprocess |
| `EXPIRED` | The upload was never confirmed within 15 minutes | Final |

### Pipeline error codes

| Code | Cause | Retried |
| --- | --- | --- |
| `NO_SPEECH` | Sarvam returned an empty transcript | No |
| `SPEECH_REJECTED` | Sarvam answered 400, 403 or 422 | No |
| `ANALYSIS_INVALID` | The model's output did not match the schema | No |
| `PROCESSING_FAILED` | Retries ran out on a temporary error (timeout, 5xx, rate limit) | Up to 3 times |
| `UPLOAD_EXPIRED` | Set on `EXPIRED` items: the upload was never confirmed | No |

### Scheduled cleanup

The `housekeeping` Inngest function (`src/inngest/housekeeping.ts`) runs every 10 minutes. Each task is its own step, and the logic is in `src/services/housekeeping.service.ts`.

| Task | Rule | Why |
| --- | --- | --- |
| Expire abandoned uploads | `UPLOADING` for more than 15 minutes becomes `EXPIRED` with `UPLOAD_EXPIRED` | A closed tab or lost connection leaves a row that would otherwise sit there forever. It is one conditional update, so it cannot race with a customer confirming at the same moment |
| Queue stuck recordings again | `UPLOADED` and unchanged for more than 5 minutes gets the processing event sent again | Covers a confirm that saved the row but could not reach the queue |
| Delete unneeded audio | Files from `EXPIRED` items, and everything older than 30 days, are deleted and the row is marked `audioDeletedAt` | Keeps the privacy promise. Transcripts and analysis stay, and the admin page shows "audio removed" |

Each run handles at most 100 rows per task, and the rest wait for the next run. A file is only marked deleted after the delete succeeds, so a failure is retried on the next run. Running a task twice is harmless.

The processing function allows one run per recording at a time (`concurrency` keyed on the feedback id), so a re-sent event can never run beside the original. The second one waits, finds the item already handled, and stops.

## Getting started

### Requirements

- Node.js 22 or newer
- A PostgreSQL database
- An S3-compatible bucket
- Accounts and API keys for Resend, Sarvam and OpenRouter

### Setup

```bash
npm install                      # also runs prisma generate
cp .env.example .env             # then fill in the values
npx prisma migrate deploy        # apply the migrations
```

Run the API and the Inngest dev server in two terminals:

```bash
INNGEST_DEV=1 npm run dev                              # http://localhost:3000
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest   # dashboard at http://127.0.0.1:8288
```

Without `INNGEST_DEV=1`, Inngest assumes cloud mode and `/api/inngest` returns a 500 about a missing signing key. You can put `INNGEST_DEV=1` in `.env`.

The frontend (see `../Frontend`) proxies `/api` to port 3000, so cookies stay same-origin in development.

### Create the first admin

There is no admin signup route. Sign up through the app, verify the email, then promote the account:

```bash
npm run make-admin -- you@example.com
```

The script uses whichever database `DATABASE_URL` points at. Role changes apply on the next request, because the session cookie cache is off.

## Environment variables

Validated with zod at startup in `src/config/env.ts`. The app refuses to start if a required value is missing.

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | No | `development` (default), `production` or `test` |
| `PORT` | No | Port to listen on, default `3000` |
| `DATABASE_URL` | Yes | PostgreSQL connection string. On Supabase use the session pooler string |
| `BETTER_AUTH_SECRET` | Yes | At least 32 characters. Use a different value per environment |
| `BETTER_AUTH_URL` | Yes | The public origin users see. In dev it is the frontend origin, because Vite proxies `/api` |
| `CLIENT_URL` | Yes | The frontend origin, used for CORS and trusted origins |
| `RESEND_API_KEY` | Yes | Resend API key for verification and reset emails |
| `EMAIL_FROM` | Yes | Sender, for example `Voiceflow <hi@your-domain.com>`. The domain must be verified in Resend |
| `S3_ENDPOINT` | No | Leave empty for AWS S3. Set it for Supabase, R2 or MinIO |
| `S3_REGION` | No | Default `us-east-1` |
| `S3_BUCKET` | Yes | Bucket name, for example `feedback-audio` |
| `S3_ACCESS_KEY_ID` | Yes | Access key |
| `S3_SECRET_ACCESS_KEY` | Yes | Secret key |
| `S3_FORCE_PATH_STYLE` | No | `true` for Supabase and MinIO. Without it the signed URL points at a host that does not exist |
| `SARVAM_API_KEY` | Yes | Sarvam speech-to-text key |
| `OPENROUTER_API_KEY` | Yes | OpenRouter key |
| `SENTIMENT_MODEL` | No | Default `openai/gpt-4o-mini` |
| `INNGEST_DEV` | Dev only | `1` to talk to the local Inngest dev server |
| `INNGEST_EVENT_KEY` | Production | From the Inngest dashboard |
| `INNGEST_SIGNING_KEY` | Production | From the Inngest dashboard |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the API with file watching (`tsx watch`) |
| `npm run build` | Generate the Prisma client and compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Re-run tests when files change |
| `npm run typecheck` | Type-check without emitting |
| `npm run make-admin -- <email>` | Promote an existing user to admin |
| `npm run generate-schema` | Regenerate the Better Auth tables in `schema.prisma` after changing auth plugins |

## Testing

```bash
npm test
```

The suite runs in under a second. It uses [Vitest](https://vitest.dev) (same `describe`, `it` and `expect` as Jest) and plain `fetch`: the tests start the real Express app on a random port and make real HTTP requests to it. There are no extra test servers, databases or API keys to set up, and the tests never read your `.env`.

What is replaced with a fake: the database (Prisma), object storage, the Inngest queue, email, and the Sarvam and OpenRouter calls. Everything else is the real code, including the middleware, validation, error handling, routes and services.

| File | What it checks |
| --- | --- |
| `tests/access-control.test.ts` | Anonymous visitors get 401 on every protected route. Customers get 403 on every admin route. Admins get 403 on the customer routes. Malformed and oversized request bodies are handled |
| `tests/feedback.test.ts` | Registering a recording: accepted types and limits (30.5 seconds, 2 MB), consent, language list, and the server-built storage path. Confirming: 404 for other people's recordings, 409 for a double confirm or a race, a missing or wrong-size upload, and the event sent to the queue. The customer list and detail never include sentiment |
| `tests/admin.test.ts` | Admin filters, pagination and validation, audio links and the "audio removed" case, reprocess rules and the new event id, a failing queue, and the stats summary |
| `tests/process-feedback.test.ts` | The pipeline: the happy path, duplicate events, reusing a saved transcript, keeping the transcript when sentiment fails, and recording the right error code when it gives up |
| `tests/housekeeping.test.ts` | The cleanup job: the 15 minute and 5 minute rules, 30 day retention, new event ids when queuing again, deleting before marking, retrying after a failure, and the 10 minute schedule |
| `tests/speech.service.test.ts` | Sarvam handling: two calls per recording, language choice and auto-detect, which failures are retried and which are not (400, 403, 422, 429, 5xx, network errors, empty transcripts) |
| `tests/sentiment.service.test.ts` | Score and label always agree, the transcript is wrapped as data against prompt injection, only text is sent to the model, invalid output versus provider outages |
| `tests/auth.test.ts` | The real auth configuration on an in-memory store: signup cannot set a role, login is blocked until the email is verified, passwords are not stored in plain text |

The fake database means the tests check how the code uses the database, not the SQL itself. Filters, aggregates and migrations are not exercised against a real Postgres. To confirm that the tests really guard the rules, break one deliberately, for example let `requireAdmin` through, and a group of tests fails.

Shared fakes are in `tests/helpers/mocks.ts` and are wired in once in `tests/setup.ts`. To test a new route, start the app with `startServer()` from `tests/helpers/http.ts`, call `loginAs(...)` to choose who is logged in, and set what the fake database returns.

## Project structure

```text
src/
  app.ts                  Express app: middleware, routes, error handling
  server.ts               Starts the server, handles shutdown (not used on Vercel)
  config/                 env, auth, prisma, storage client, logger
  routes/                 URL to controller mapping, plus the guards each route needs
  controllers/            Thin HTTP layer: read the request, call a service, send the response
  services/               Business logic: feedback, admin, storage, speech, sentiment, email
  middleware/             requireUser, requireAdmin, requireCustomer, validate, error handler
  validators/             zod schemas for request bodies, params and queries
  inngest/                Inngest client and the process-feedback function
  utils/                  AppError
prisma/
  schema.prisma           Data model
  migrations/             SQL migrations, including row level security
scripts/
  make-admin.ts           Promote a user
tests/                    Vitest tests, fakes in helpers/
docs/
  ARCHITECTURE.md         Diagrams and design decisions
```

Requests flow `routes -> controllers -> services`. Controllers do not touch the database, and services do not know about Express.

## API reference

All routes are under `/api` unless noted. Errors always use one shape:

```json
{ "error": { "code": "NOT_FOUND", "message": "Recording not found" } }
```

| Status | Used for |
| --- | --- |
| 400 | Validation failed, or the upload is missing (`UPLOAD_MISSING`) |
| 401 | No session (`UNAUTHORIZED`) |
| 403 | Wrong role (`FORBIDDEN`) |
| 404 | Missing, or someone else's recording. The two look identical on purpose |
| 409 | Wrong state, for example confirming twice (`INVALID_STATE`) |
| 502 | The job queue could not be reached (`QUEUE_UNAVAILABLE`) |

### Customer routes

Require a session. Admins get 403 on these routes. Every query is scoped to the logged-in user.

| Method and path | Description | Success |
| --- | --- | --- |
| `POST /api/feedback` | Register a recording. Body: `mimeType`, `sizeBytes`, `durationMs`, `consent: true`, optional `languageHint` | 201 `{ id, uploadUrl }` |
| `POST /api/feedback/:id/complete` | Confirm the upload and queue processing | 202 `{ status }` |
| `GET /api/feedback` | Your submissions, newest first. Query: `cursor` | 200 `{ items, nextCursor }` |
| `GET /api/feedback/:id` | One submission with the transcript when ready. Never includes sentiment | 200 |

Limits: up to 30.5 seconds, 2 MB, `audio/webm`, `audio/mp4` or `audio/ogg`. `languageHint` must be one of Sarvam's language codes (see `SPEECH_LANGUAGES` in `src/validators/feedback.schema.ts`).

### Admin routes

Require the `admin` role.

| Method and path | Description | Success |
| --- | --- | --- |
| `GET /api/admin/stats` | Totals, status and sentiment counts, languages, daily volume, top topics, urgent count | 200 |
| `GET /api/admin/feedback` | All feedback. Filters: `status`, `sentiment`, `language`, `from`, `to`, `cursor` | 200 `{ items, nextCursor }` |
| `GET /api/admin/feedback/:id` | Full detail: customer, transcript, analysis | 200 |
| `GET /api/admin/feedback/:id/audio` | Signed playback URL, valid for 60 seconds | 200 `{ url, expiresIn }` |
| `POST /api/admin/feedback/:id/reprocess` | Re-run a `COMPLETED` or `FAILED` item | 202 |

### Other routes

| Method and path | Description |
| --- | --- |
| `GET /api/me` | The current user |
| `* /api/auth/*` | Better Auth (signup, login, verification, password reset) |
| `* /api/inngest` | Inngest function endpoint, called by Inngest |
| `GET /health` | Liveness |
| `GET /health/ready` | Readiness, checks the database. Returns 503 when it is down |

## Authentication and access control

- Email and password through Better Auth. Email verification is required before login.
- `requireUser` reads the session on every request. `requireAdmin` and `requireCustomer` check the role. The role is read from the session, so a role change takes effect immediately.
- Signup cannot set its own role. Roles change only through `npm run make-admin`.
- Customers cannot read other customers' recordings, and the API returns 404, never 403, so it does not reveal that a recording exists.
- Admins cannot use the customer routes.
- Sentiment is visible to admins only.
- The storage bucket is private. Upload URLs last 15 minutes, playback URLs 60 seconds.
- The speech service receives only audio. The LLM receives only the English text, never a name, email or user id, and the transcript is wrapped in delimiters and declared to be data.
- Row level security is enabled on every table with no policies, so the Supabase REST API cannot read them. The app connects as the table owner and is unaffected. When you add a table, enable RLS in its migration too.

## Storage

Any S3-compatible service works. Set the `S3_*` variables, create a private bucket, and allow `PUT` from your frontend origin in the bucket CORS settings, because browsers upload directly.

| Provider | Settings |
| --- | --- |
| AWS S3 | Leave `S3_ENDPOINT` empty, set `S3_REGION` |
| Supabase | Endpoint and keys from Project Settings, Storage, S3 Connection. Set `S3_FORCE_PATH_STYLE=true` |
| Cloudflare R2 | R2 endpoint, `S3_REGION=auto` |
| MinIO (local Docker) | `S3_ENDPOINT=http://localhost:9000`, `S3_FORCE_PATH_STYLE=true` |

A suggested bucket setup is a 2 MB file size limit and the three audio MIME types, as a second line of defence behind the signed URL.

## Database

The schema is in `prisma/schema.prisma`: the Better Auth tables (`user`, `session`, `account`, `verification`) plus `feedback`, `transcription` and `sentiment_analysis`. Deleting a user cascades to their feedback rows.

```bash
npx prisma migrate dev --name <change>     # create and apply a migration locally
npx prisma migrate deploy                  # apply migrations in production
```

Add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` to any migration that creates a table.

## Deployment

The API runs on Vercel as a serverless function (`src/app.ts` is the entry point and `vercel.json` sets the region). `server.ts` does not listen on a port when `VERCEL` is set.

1. Set every variable from the table above on the Vercel project. In production `BETTER_AUTH_URL` is the public API origin, `CLIENT_URL` is the frontend origin, and `S3_FORCE_PATH_STYLE` must match your storage provider.
2. Run `npx prisma migrate deploy` against the production database.
3. Connect Inngest. The Vercel integration sets `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` and syncs on each deploy. Otherwise sync `https://<your-api>/api/inngest` by hand in the Inngest dashboard after every deploy that changes functions. After syncing, both `process-feedback` and `housekeeping` (with its 10 minute schedule) should be listed under Functions.
4. Disable Vercel Deployment Protection for the API, or Inngest gets a 401 and the sync fails.
5. Check the function duration. `process-feedback` makes two Sarvam calls of up to 20 seconds each, which does not fit in a 10 second limit. Use Fluid compute or raise `maxDuration`.
6. Serve the frontend and the API from the same site. The live setup is `voiceflow.mayurgadakh.dev` for the app and `api.voiceflow.mayurgadakh.dev` for the API, which share `mayurgadakh.dev`, so session cookies work. They do not work across unrelated domains such as two different `*.vercel.app` projects.
7. Create the first admin with `make-admin` against the production database.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Browser says "Failed to fetch" on upload | `S3_FORCE_PATH_STYLE` is not `true`, so the signed URL has a bucket subdomain that does not exist. Or the bucket does not allow `PUT` from the frontend origin |
| `/api/inngest` returns 500 about a signing key | Set `INNGEST_DEV=1` in development, or the signing key in production |
| Recording stays `UPLOADED` | The event did not reach Inngest. The cleanup job queues it again after 5 minutes. If it still stays, check the event key and that the functions are synced |
| Recording shows `EXPIRED` | The upload was never confirmed within 15 minutes. The customer needs to record again |
| Cleanup never seems to run | `housekeeping` is not synced, so the 10 minute schedule does not exist. Sync the app in the Inngest dashboard |
| Verification email never arrives | `EMAIL_FROM` uses a domain that is not verified in Resend |
| Login works but the session is lost in production | Frontend and API are on different sites. See Deployment step 6 |
| Server exits at startup with a zod error | A required environment variable is missing or invalid |
| `FAILED` with `SPEECH_REJECTED` | Bad Sarvam key, or the audio format was refused. Check the key, then the Sarvam response for that clip |

## Known limitations

- The tests fake the database, so they do not run the real SQL or migrations. There is no CI pipeline yet.
- Auth endpoints have no extra rate limiting beyond Better Auth's defaults. Check that it is active in production.
- Deleting a user removes their database rows, but not their audio files. The cleanup job deletes them once they pass the 30 day retention period.
- Recordings are limited to 30 seconds. Longer audio would need Sarvam's batch API.
- The language list comes from Sarvam's documentation. Only English has been tested end to end so far, so check Hindi, Marathi and mixed-language clips before relying on them.
