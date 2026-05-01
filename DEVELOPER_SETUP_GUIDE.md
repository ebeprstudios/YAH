# YAH! Developer App Setup Guide

This is the part of the build **only you can do** — the platform requires that the actual account owner creates and configures these apps. Plan ~45 minutes total. Do them in this order; if anything blocks, skip and come back.

> ✅ End state: Tiffany can click "Connect Instagram" and "Connect TikTok" inside YAH and authorize her own accounts. No app review required because both apps stay in development mode with her added as a tester.

---

## Part 1 — Meta Developer App (Instagram)

### 1.1 Create the developer account

1. Go to **https://developers.facebook.com**
2. Sign in with your personal Facebook (the one tied to ebeprinc@gmail.com or whatever account has admin on Tiffany's IG)
3. Top right → **My Apps** → **Create App**

### 1.2 Create the app

1. Use case: **"Other"** (don't pick a vertical — they all add unnecessary products)
2. App type: **Business**
3. App name: `YAH Content Studio`
4. App contact email: `ebeprinc@gmail.com`
5. Business portfolio: pick one if you have it, or "I don't want to connect a business portfolio"

### 1.3 Add the Instagram product

1. In the left sidebar of your new app: **Add Product** → find **Instagram** → **Set up**
2. You'll see two options. Pick: **Instagram API setup with Instagram Login**
   *(NOT "Instagram API setup with Facebook Login" — that's the heavier path)*
3. Click **Generate access tokens** (you can ignore this for now — we use OAuth)

### 1.4 Configure Business Login

Still in Instagram product → **Business Login** → **Configure**

- **Embedded Browser OAuth Login**: ON
- **Redirect URI**:
  ```
  https://ebeprstudios.github.io/YAH/oauth_callback.html
  ```
- **Permissions** (check these boxes):
  - `instagram_business_basic`
  - `instagram_business_manage_insights`
- Save changes

### 1.5 Capture your credentials

Left sidebar → **App settings** → **Basic**

Write down:
- **App ID** → this is `IG_CLIENT_ID`
- **App Secret** (click Show, enter your password) → this is `IG_CLIENT_SECRET`

### 1.6 Add Tiffany as a tester

This is the magic step that lets you skip app review.

1. Left sidebar → **App roles** → **Roles**
2. **Add People** → **Instagram Tester**
3. Search Tiffany's Instagram username
4. She'll get a notification in Instagram → Settings → Apps and Websites → Tester Invites → **Accept**

Once she accepts, the app can authenticate her account in development mode.

### 1.7 Confirm her IG account is Business or Creator

Tiffany opens Instagram → Profile → ☰ menu → Settings & privacy → Account type and tools → **Switch to professional account** if she's not already on Creator or Business. (She likely is already, but worth confirming.)

---

## Part 2 — TikTok Developer App

### 2.1 Create the developer account

1. Go to **https://developers.tiktok.com**
2. Sign in with the TikTok account that admins Tiffany's account (or your own — doesn't have to be hers)
3. Click **Manage apps** → **Connect**

### 2.2 Create the app

1. **Create an app**
2. Name: `YAH Content Studio`
3. Description: `Content performance dashboard for managed creator accounts`
4. Category: **Business Tools**

### 2.3 Configure scopes and redirect

In the app dashboard:

1. **Login Kit** → **Add product**
2. **Redirect domain**:
   ```
   ebeprstudios.github.io
   ```
3. **Redirect URI**:
   ```
   https://ebeprstudios.github.io/YAH/oauth_callback.html
   ```
4. Scopes — request:
   - `user.info.basic`
   - `video.list`
5. Save

### 2.4 Capture your credentials

App dashboard → **Basic information**:
- **Client Key** → this is `TT_CLIENT_KEY`
- **Client Secret** → this is `TT_CLIENT_SECRET`

### 2.5 Add Tiffany as a tester

1. App dashboard → **Manage** → **Sandbox** (or **Test users** depending on console version)
2. Add a **Target User** by TikTok handle: Tiffany's @
3. She receives an in-app notification to accept the test access
4. While the app is in sandbox/dev mode, only added test users can authorize

### 2.6 Confirm her TikTok is Creator or Business

In TikTok app → Profile → ☰ → Settings and privacy → **Account** → **Switch to Business Account** (or Creator). Free, no follower impact.

---

## Part 3 — Configure Supabase Edge Function Secrets

Once you have the four credentials, drop them into Supabase. **Project Settings → Edge Functions → Manage secrets**, add:

```
SB_URL              = https://piowmyefosrdpjisguii.supabase.co
SB_SERVICE_ROLE     = <copy from Project Settings → API → service_role key>
IG_CLIENT_ID        = <from step 1.5>
IG_CLIENT_SECRET    = <from step 1.5>
IG_REDIRECT_URI     = https://ebeprstudios.github.io/YAH/oauth_callback.html
TT_CLIENT_KEY       = <from step 2.4>
TT_CLIENT_SECRET    = <from step 2.4>
TT_REDIRECT_URI     = https://ebeprstudios.github.io/YAH/oauth_callback.html
```

> ⚠️ The `SB_SERVICE_ROLE` key has full database access. It only ever lives in Edge Function env vars — never paste it into `index.html`, never commit it to GitHub.

---

## Part 4 — Drop the Client IDs into YAH

In `index.html`, near the top of the `<script>` block alongside `SB_URL` and `SB_KEY`, add:

```javascript
window.YAH_CONFIG = {
  IG_CLIENT_ID: 'PASTE_INSTAGRAM_APP_ID_FROM_STEP_1.5',
  TT_CLIENT_KEY: 'PASTE_TIKTOK_CLIENT_KEY_FROM_STEP_2.4',
  OAUTH_REDIRECT_URI: 'https://ebeprstudios.github.io/YAH/oauth_callback.html'
};
```

Yes, these are public — they're meant to be. The **secrets** (App Secret / Client Secret) stay on the server in Supabase. The IDs/keys are safe in the browser.

---

## Part 5 — First Connection Test

1. Push everything to GitHub (auto-deploys to Pages)
2. Open `https://ebeprstudios.github.io/YAH` in Chrome
3. Open Tiffany's client → Performance tab
4. Click **Connect Instagram**
5. Popup → Tiffany authorizes (she must be logged into IG in that browser, or she'll have to sign in)
6. Popup shows green checkmark → closes → YAH performance tab shows her username and "0 posts"
7. Click **Pull Instagram** → wait 10–30 seconds → posts appear, scored
8. Repeat 4–7 with **Connect TikTok**

If the Instagram connect throws "Invalid platform app" or similar — most likely the redirect URI in the Meta dashboard doesn't exactly match the URI in your config. They have to match character-for-character.

If TikTok throws "scope_not_authorized" — Tiffany hasn't accepted the tester invite yet, OR her account isn't Creator/Business yet.

---

## What Happens When You Onboard a Second Client

For client #2, you have two paths:

**Path A — Stay in dev mode (free, indefinite)**
Add client #2 as a Tester role in both apps the same way you added Tiffany. Works forever, but caps at ~25 testers per Meta app and limited testers on TikTok. Fine for boutique agency volumes.

**Path B — Submit for app review (4–6 weeks)**
When you're ready to onboard clients without manually adding each one, submit the apps for review. Meta requires a screencast walkthrough showing each permission's use case + a privacy policy URL + business verification. TikTok wants similar plus a public website. Both are doable but neither is instant.

While review is pending: new clients use the **CSV import path** (still built into YAH from the Metricool integration). They export their analytics manually, you import. Friction, but it works.

---

## Token Refresh Reality Check

- **Instagram long-lived tokens**: 60 days. The `pull-instagram` Edge Function checks expiry on every pull and auto-refreshes when <7 days remain. As long as you (or a cron) pulls at least once a month, tokens stay alive forever.
- **TikTok access tokens**: 24 hours, with a 1-year refresh token. The `pull-tiktok` Edge Function auto-refreshes if the token is within an hour of expiry. Refresh tokens themselves expire after 1 year of non-use — same rule, pull at least once a month and you never see this.

If a token does fully expire (90+ days of no pulls for IG, 1 year for TT), the only fix is having Tiffany re-click "Connect Instagram" / "Connect TikTok" in YAH. Build a "stale token" warning into the connector card if you want to be defensive about it.

---

## Costs

- **Meta Developer**: Free.
- **TikTok Developer**: Free.
- **Supabase Edge Functions**: ~500K invocations/month free tier, you'll use <1% of that.
- **No more Metricool subscription**: cancel it once direct pulls are validated.

The whole stack is now $0/month per client (excluding Anthropic API spend on plan generation, which you already pay).
