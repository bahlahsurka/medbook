# MedBook — Deployment Guide
## From zero to your live URL in ~15 minutes

---

## STEP 1 — Set up Supabase database (5 min)

1. Go to https://supabase.com → open your project
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**
4. Open the file `SUPABASE_SETUP.sql` from this folder and paste the entire contents
5. Click **Run** (green button)
6. You should see "Success. No rows returned" — that's correct.

That's the database and image storage configured.

---

## STEP 2 — Enable Email Auth in Supabase

1. In Supabase sidebar → **Authentication** → **Providers**
2. Make sure **Email** is enabled (it is by default)
3. Optional: under **Authentication → Settings**, disable "Confirm email" 
   if you want to skip the email confirmation step while testing.

---

## STEP 3 — Push code to GitHub (5 min)

You need a GitHub account (free). If you don't have one: https://github.com/signup

### Option A — GitHub Desktop (easiest, no terminal)
1. Download GitHub Desktop: https://desktop.github.com
2. Open it → File → Add Local Repository → select this `medbook` folder
3. It will say "This folder is not a Git repo" → click **Initialize**
4. Give it a commit message like "Initial commit" → click **Commit to main**
5. Click **Publish Repository** → name it `medbook` → keep it Private → Publish

### Option B — Terminal
```bash
cd /path/to/medbook
git init
git add .
git commit -m "Initial commit"
# Create a repo on github.com first, then:
git remote add origin https://github.com/YOUR_USERNAME/medbook.git
git push -u origin main
```

---

## STEP 4 — Deploy to Vercel (3 min)

1. Go to https://vercel.com → log in
2. Click **Add New → Project**
3. Click **Import Git Repository** → connect GitHub if not already connected
4. Find your `medbook` repo → click **Import**
5. On the config screen, everything can stay default EXCEPT:
   - Scroll down to **Environment Variables** and add these two:

   | Name | Value |
   |------|-------|
   | `REACT_APP_SUPABASE_URL` | `https://nddlxdndowsrgnicpkkj.supabase.co` |
   | `REACT_APP_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kZGx4ZG5kb3dzcmduaWNwa2tqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTU5MDUsImV4cCI6MjA5NTczMTkwNX0.MaTS2UPDeo9x4dQE9TO7waGnL_x5P_LHOaH-Q2lgnng` |

6. Click **Deploy**
7. Wait ~2 minutes for the build to complete
8. Vercel gives you a URL like `https://medbook-abc123.vercel.app`

**That's your permanent URL. Bookmark it on both devices.**

---

## STEP 5 — Create your account

1. Open your Vercel URL
2. Click **"Don't have an account? Sign up"**
3. Enter your email and a strong password
4. Check your email for a confirmation link (if email confirm is enabled)
5. Log in — you're in

On your second device: open the same URL, log in with the same credentials. All your entries sync instantly.

---

## How updates work

If you ever want to change something in the app:
1. Edit the files locally
2. Commit and push to GitHub
3. Vercel automatically rebuilds and deploys (takes ~2 min)

---

## Your data is safe because:
- **Supabase** stores all entries + images in a real PostgreSQL database with cloud backups
- **Row Level Security** means only YOU can see your data (even the database owner can't read it without your credentials)
- **Export backup** button in the sidebar lets you download a JSON file anytime
- **Vercel** just serves the frontend — no data lives there

---

## Troubleshooting

**"Invalid API key" error** → Double-check the env vars in Vercel match exactly (no spaces)

**Images not uploading** → Make sure you ran the full SQL script including the storage section

**"Email not confirmed" on login** → Go to Supabase → Auth → Settings → disable email confirmation

**Build fails on Vercel** → Check the build logs; usually a missing env var
