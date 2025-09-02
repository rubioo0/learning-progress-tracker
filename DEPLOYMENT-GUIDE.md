# Deployment Guide - Persistent Data Solution

This guide helps you deploy the Learning Progress Tracker with persistent data storage to prevent data loss.

## Problem

Free hosting services like Render.com use **ephemeral storage**, which means:
- Database files are deleted when the service restarts
- Uploaded files are lost when the container restarts  
- All progress is wiped after periods of inactivity

## Solution

We've implemented a **dual storage system**:
1. **PostgreSQL Database** for persistent data storage
2. **Cloudinary** for persistent file storage (optional)

## Deployment Options

### Option 1: Render.com with PostgreSQL (Recommended)

#### Step 1: Deploy with Database
1. Push your updated code to GitHub
2. Go to [render.com](https://render.com) and create a new web service
3. Connect your GitHub repository
4. Render will automatically detect the `render.yaml` file
5. The PostgreSQL database will be created automatically

#### Step 2: Verify Database Connection
- Check the Render dashboard to ensure the database is connected
- The app will automatically use PostgreSQL in production

### Option 2: Railway.app (Alternative)

Railway provides free PostgreSQL databases:

1. Go to [railway.app](https://railway.app)
2. Create a new project
3. Add PostgreSQL database
4. Deploy your Node.js app
5. Add environment variable: `DATABASE_URL` (Railway provides this automatically)

### Option 3: Free Database Providers

You can use any PostgreSQL provider:

#### Supabase (Free)
1. Create account at [supabase.com](https://supabase.com)
2. Create new project
3. Get connection string from Settings > Database
4. Add to your hosting service as `DATABASE_URL`

#### Neon (Free)
1. Create account at [neon.tech](https://neon.tech)
2. Create database
3. Get connection string
4. Add as `DATABASE_URL` environment variable

## Optional: Cloud File Storage

### Cloudinary Setup (Free Tier: 25GB storage)

1. Create account at [cloudinary.com](https://cloudinary.com)
2. Get your credentials from Dashboard
3. Add environment variables to your hosting service:
   ```
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   ```

### Benefits of Cloudinary
- Files survive server restarts
- 25GB free storage
- Automatic image optimization
- Global CDN delivery

## Environment Variables Summary

Add these to your hosting service:

```bash
# Required for persistent database
DATABASE_URL=postgresql://username:password@host:5432/database

# Optional for persistent file storage
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Automatically set by hosting service
NODE_ENV=production
PORT=10000
```

## Migration Notes

### Database Migration
- The app automatically detects if PostgreSQL is available
- If `DATABASE_URL` is set, it uses PostgreSQL
- If not, it falls back to SQLite (local development)
- All tables are created automatically

### File Storage Migration
- If Cloudinary is configured, new uploads go to cloud storage
- Existing local files remain local but won't survive restarts
- Re-upload important files after deployment

## Testing the Setup

1. Deploy the application
2. Upload a test file
3. Add some learning progress
4. Wait for the service to sleep (or restart manually)
5. Check if data persists after restart

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` is correctly set
- Check database logs in hosting service dashboard
- Ensure PostgreSQL database is running

### File Upload Issues
- Check Cloudinary credentials if using cloud storage
- Verify file types are supported
- Check file size limits (10MB max)

### Data Migration
If you need to migrate existing data:
1. Export from local SQLite: Use database export tools
2. Import to PostgreSQL: Use psql or database management tools

## Cost Breakdown (Free Tiers)

- **Render.com Web Service**: Free (sleeps after inactivity)
- **Render.com PostgreSQL**: Free (shared database)
- **Cloudinary**: Free (25GB storage, 25K transformations)
- **Alternative: Railway**: Free ($5 credit/month)
- **Alternative: Supabase**: Free (500MB database)

## Support

If you encounter issues:
1. Check hosting service logs
2. Verify environment variables are set correctly
3. Test database connection separately
4. Check file upload permissions
