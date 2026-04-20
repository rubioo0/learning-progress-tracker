# Render + Neon + Cloudinary Deployment Guide

This project is prepared for a free-tier deployment using:
- Render Free Web Service
- Neon Free Postgres
- Cloudinary Free Storage

The application now supports:
- Postgres in production with SQLite fallback for local development
- Cloudinary-backed attachments with local fallback
- Environment-first Gemini key/model behavior

## 1. Create external services

### Neon (Postgres)
1. Create a Neon project.
2. Copy the connection string (include sslmode=require).
3. Keep this value for DATABASE_URL.

### Cloudinary (storage)
1. Create a Cloudinary account.
2. Copy:
   - cloud name
   - API key
   - API secret
3. Keep these for Render environment variables.

### Gemini
1. Create or reuse your Gemini API key.
2. Keep this for GEMINI_API_KEY.

## 2. Configure Render service

Render blueprint is already aligned in render.yaml.
Set the following environment variables in Render Dashboard:

Required:
- DATABASE_URL
- CLOUDINARY_CLOUD_NAME
- CLOUDINARY_API_KEY
- CLOUDINARY_API_SECRET
- GEMINI_API_KEY

Note: when `GEMINI_API_KEY` is set in Render environment variables, the in-app "Save API key" action is intentionally read-only/blocked. Change the key in Render and redeploy.

Already defined defaults:
- DATABASE_PROVIDER=postgres
- FORCE_SQLITE=false
- ALLOW_SQLITE_FALLBACK=false
- STORAGE_BACKEND=cloudinary
- AI_FILE_PERSISTENCE=false
- AI_ALLOW_MODEL_FALLBACK=false
- CODE_VALIDATION_ENABLED=false
- REQUIRE_PROD_EXTERNAL_SERVICES=true

If you want automatic fallback behavior (allow downgrade from Gemini 2.5 Flash to Flash Lite under overload), set:
- AI_ALLOW_MODEL_FALLBACK=true

## 2.1 Deploy from feature branch (no main merge required)

You can deploy directly from this feature branch without merging into main.

1. In Render, click New -> Web Service.
2. Connect your GitHub repository.
3. Set Branch to `feature/render-neon-cloudinary-deploy`.
4. Keep build command `npm install` and start command `npm start`.
5. Add required environment variables from section 2.
6. Deploy.

If you already created the Render service from main, open service Settings -> Build & Deploy -> Branch and switch it to `feature/render-neon-cloudinary-deploy`, then trigger a manual deploy.

## 2.2 Security rules for keys

1. Never commit real keys into files tracked by git.
2. Store production keys only in Render environment variables.
3. Keep `.env` local only (already ignored by git).
4. Rotate any key immediately if it was posted publicly or sent through untrusted channels.
5. If you suspect leakage, rotate Neon, Cloudinary, and Gemini credentials before production use.

## 3. Optional local env for testing

1. Copy .env.example to .env.
2. Fill in the same service credentials.
3. Start app locally and verify APIs.

## 3.1 Optional rollback safety copy of main

Create a remote backup branch of main before final merge:

```powershell
git fetch origin
git checkout feature/render-neon-cloudinary-deploy
git branch backup/main-YYYY-MM-DD origin/main
git push origin backup/main-YYYY-MM-DD
```

Replace `YYYY-MM-DD` with current date.

## 4. Migrate existing SQLite data to Neon

For a complete migration (topics, learning notes, sessions, progress, achievements, and time tracking), use your local SQLite database as the source.

If you already have data in learning_progress.db, run:

```powershell
node scripts/migrate-sqlite-to-postgres.js
```

If your source is a JSON backup instead of SQLite, import it into local SQLite first. Note: this helper currently imports topics only.

```powershell
node scripts/import-json-state-to-sqlite.js path\to\your-backup.json --clear
```

Then run the Neon migration command:

```powershell
node scripts/migrate-sqlite-to-postgres.js
```

Optional: specify a custom SQLite file path:

```powershell
node scripts/migrate-sqlite-to-postgres.js ./learning_progress.db
```

## 5. Verify after deploy

Check these flows from browser and phone:
1. Topic list loads
2. Status updates persist
3. Learning notes CRUD works
4. Export endpoints work
5. Attachment upload/preview/download/delete works
6. App still works after service sleep/wake on Render free tier

## 6. Notes

- Render free web sleeps after inactivity. This is expected.
- Persistent data is in Neon and Cloudinary, so sleep/redeploy should not lose user data.
- Code validation endpoint is disabled by default in production because free runtimes often do not have Python and .NET toolchains installed.
