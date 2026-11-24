# Supabase setup (about 2 minutes)

1. Go to [supabase.com](https://supabase.com), sign in, and create a **new project** (free tier is fine). Pick the region closest to you.
2. Open **SQL Editor**, paste the contents of [`migrations/0001_tasks.sql`](migrations/0001_tasks.sql), and click **Run**.
3. Open **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick **Auto Confirm User**.
4. Open **Authentication → Sign In / Providers** and turn **off** "Allow new users to sign up". Only your account can use the list.
5. Open **Project Settings → API Keys** (or **Data API**) and copy the **Project URL** and the **anon / publishable key**.
6. In `desktop/`, copy `config.example.json` to `config.local.json` and paste both values in. `config.local.json` is git-ignored and is never committed.

The anon key is safe in the app: Row Level Security only lets a signed-in user see their own tasks. Never put the **service_role / secret** key in any app or in this repo.
