# TakeoffPro — Stage 1 setup & test guide

Stage 1 = accounts (email/password, Google, password reset) + Supabase database + installable PWA.

## 1. Create the Supabase project (≈5 min)

1. Go to <https://supabase.com> → **New project**. Pick a region close to Zambia (e.g. *eu-west* or *af-south* if offered). Save the database password somewhere safe.
2. **SQL Editor → New query** → paste the whole of `supabase/migrations/0001_init.sql` → **Run**. Then do the same with `supabase/migrations/0002_free_app_and_data_collection.sql` and `supabase/migrations/0003_auto_takeoff.sql`. Each should say "Success. No rows returned".
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
   *Never copy the `service_role` key into the app.*

## 2. Connect the app

```bash
copy .env.example .env.local
```

Open `.env.local` and paste your URL and anon key. Then:

```bash
npm run dev
```

Open <http://localhost:5173>. The yellow "Supabase not connected" banner should be gone.

## 3. Auth settings in Supabase

**Authentication → URL Configuration**

- **Site URL:** `http://localhost:5173` for now (change to your live URL when you deploy).
- **Redirect URLs** — add all of these:
  - `http://localhost:5173/**`
  - `http://localhost:4173/**`
  - `https://YOUR-LIVE-DOMAIN/**` (once deployed)

**Authentication → Providers → Email**: leave *Confirm email* ON (recommended).
The built-in email sender is rate-limited (a few emails/hour) — fine for testing; set up custom SMTP
(Resend, Brevo, etc.) under **Authentication → SMTP** before launch.

### Google sign-in

1. <https://console.cloud.google.com> → create a project → **APIs & Services → OAuth consent screen** (External, add app name "TakeoffPro", your email).
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   - *Authorized JavaScript origins:* `http://localhost:5173` and your live domain.
   - *Authorized redirect URIs:* `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
3. Copy the Client ID and Client Secret into Supabase **Authentication → Providers → Google** → Enable → Save.

## 4. Test checklist (Stage 1)

| # | Test | Expected |
|---|------|----------|
| 1 | Sign up with email + password | "Check your email" screen; confirmation email arrives |
| 2 | Click the link in the email | Lands on `/app` logged in |
| 3 | Log out, log in again | Back on Projects page |
| 4 | Wrong password | "Wrong email or password." |
| 5 | Forgot password → email link → set new password | Redirects to `/app`; new password works |
| 6 | Continue with Google | Returns to `/app` logged in |
| 7 | Account → change units/currency/exchange rate → Save | "Saved."; survives reload |
| 8 | Log in as `cha462029@gmail.com` | Orange **Admin** pill in the top bar |
| 9 | Landing page → upload a drawing | Consent box appears first; after **Agree and upload** the drawing opens |
| 10 | Supabase → Table Editor → `consent_log` | One row with the exact consent wording and time |
| 11 | Measure something, wait ~5 s → `telemetry_events` | `session_start`, `drawing_uploaded`, `scale_set`, `measurement_created` rows |
| 12 | Storage → `training-uploads` | A copy of the uploaded file |

## 4b. Stage 2 tests — projects

| # | Test | Expected |
|---|------|----------|
| 1 | Projects → **+ New project** (name, client, site, date) | Opens the project workspace |
| 2 | Upload a multi-page PDF | One tab per page |
| 3 | Set scale, measure, reload the page | Drawing, scale and measurements are still there |
| 4 | Badge under the drawing | "✓ Synced to your account" a few seconds after each change (needs the SQL run) |
| 5 | Supabase → Table Editor → `projects`, `sheets`, `measurements`; Storage → `drawings` | Your project rows and sheet images |
| 6 | Log in on a second device/browser | The project downloads and opens with the same measurements |
| 7 | Turn off Wi-Fi, measure, turn it back on | Badge shows "Sync pending", then "Synced" |
| 8 | Use "Try it now" on the landing page while logged out, then log in | "Keep your Try it now work" → **Save as project** |
| 9 | Delete a project | Gone on this device and, after sync, on others |

If both devices edit the same project before syncing, the last one saved wins for now — Stage 5 adds conflict detection with a backup copy.

## 4c. Auto takeoff (AI) — setup

Auto takeoff reads the dimensions written on the drawings and calculates the SMM takeoff with Claude (Anthropic's AI). Your API key stays on the server; the browser never sees it.

1. Create an API key at <https://console.anthropic.com> → **API Keys**, and add billing credit.
2. Install the Supabase CLI (<https://supabase.com/docs/guides/cli>), then in this folder:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref urtoeqyyoxayscfcjmig
```

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-YOUR-KEY
```

```bash
npx supabase functions deploy auto-takeoff
```

3. Optional: change the per-user daily limit (default 40 steps per day; a full run uses 2): `npx supabase secrets set AUTO_TAKEOFF_DAILY_LIMIT=10`.

**Cost:** roughly **US$0.50–1.00 per run** for a 3-sheet house set (model `claude-opus-5-5`; ~40k input + ~20–30k output tokens). Each run is logged in the `ai_runs` table with token counts, so you can watch spend. Only logged-in users can run it.

**Time:** 1–3 minutes. Supabase's free plan stops functions after 150 s, so large sets may need fewer sheets per run (or the Pro plan, 400 s).

**How it works:** Step 1 finds the views (plan / elevation / section / schedule) and outlines them on the drawing. Step 2 measures in the taking-off order — excavation area and mean girth from the plan first, then substructure, walls, floors, doors & windows, finishes, roof, services. Anything it had to estimate becomes a numbered query in the **Queries** tab; answer them and press **Re-run** for a more accurate takeoff.

**Test:** open a project → upload the Angolan Consulate PDF → **✦ Auto takeoff** → Step 1 → Step 2 → compare with your Excel takeoff (mean girth 55.95 m, trench excavation 25.18 m³, slab 8.46 m³…).

## 5. Test installing (PWA)

Install needs **HTTPS** (or `localhost`).

- **Desktop:** `npm run build && npm run preview` → open <http://localhost:4173> in Chrome/Edge → install icon in the address bar.
- **Phone:** deploy first, because phones can't reach your PC's localhost over HTTPS. Easiest:
  1. Push this folder to a GitHub repo.
  2. <https://vercel.com> → *Add New Project* → import repo → add the two `VITE_SUPABASE_*` env vars → Deploy.
  3. Add the Vercel URL to Supabase Redirect URLs and Google authorized origins.
  4. Android (Chrome): ⋮ → *Install app*. iPhone (Safari): Share → *Add to Home Screen*.

## Decisions on record

- Name **TakeoffPro**, navy `#1E3A5F` + orange `#F97316`.
- Admin: `cha462029@gmail.com` (stored in table `app_admins` — add more rows for more admins).
- Output: SMM dimension-paper sheet (Timesing / Dimension / Squaring / Unit / Description, by work section) **plus** priced BOQ.
- Scale per region on a sheet (your drawings mix 1:50, 1:75 and 1:100 on one A3 page).
- Default categories = SMM work sections.

## Data collection & legal

- The app is free — no payment plan.
- After consent, the app collects uploaded drawings, scales, measurements, corrections and basic device/usage info (see `src/lib/telemetry.ts`). Unit rates are **not** collected.
- Consent wording + time is logged in `consent_log` as evidence. Bump `POLICY_VERSION` in `src/lib/consent.ts` whenever the Privacy Policy changes — users will be asked again.
- Fill in every `[BRACKETED]` item in `src/pages/Legal.tsx` (your legal name, address, contact email, Supabase region).
- **Before launch:** register as a data controller with Zambia's Office of the Data Protection Commissioner, and have a Zambian lawyer review the Privacy Policy and Terms.
- To read collected data: Supabase → Table Editor (`telemetry_events`, `consent_log`) and Storage (`training-uploads`). Only admins can read them through the API.
- Deleting a user's data on request: delete their rows by `device_id` / `user_id` and their folder in `training-uploads`.
