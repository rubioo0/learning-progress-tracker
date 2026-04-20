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

Already defined defaults:
- DATABASE_PROVIDER=postgres
- FORCE_SQLITE=false
- ALLOW_SQLITE_FALLBACK=false
- STORAGE_BACKEND=cloudinary
- AI_FILE_PERSISTENCE=false
- CODE_VALIDATION_ENABLED=false
- REQUIRE_PROD_EXTERNAL_SERVICES=true

## 3. Optional local env for testing

1. Copy .env.example to .env.
2. Fill in the same service credentials.
3. Start app locally and verify APIs.

## 4. Migrate existing SQLite data to Neon

If you already have data in learning_progress.db, run:

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
