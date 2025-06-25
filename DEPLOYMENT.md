# 🚀 Deployment Guide

## Free Deployment Options

### Option 1: Render (Recommended)

Render offers excellent free hosting with the following benefits:
- ✅ Free tier includes 750 hours/month (enough for full-time use)
- ✅ Automatic deployments from GitHub
- ✅ Custom domains
- ✅ SSL certificates
- ✅ Persistent file storage

#### Steps to Deploy on Render:

1. **Create a GitHub Repository**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/learning-progress-tracker.git
   git push -u origin main
   ```

2. **Sign up at [render.com](https://render.com)**
   - Use your GitHub account for easy integration

3. **Create a New Web Service**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Use these settings:
     - **Name**: learning-progress-tracker
     - **Environment**: Node
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`

4. **Deploy**
   - Click "Create Web Service"
   - Wait for deployment (usually 2-3 minutes)
   - Your app will be available at `https://your-app-name.onrender.com`

### Option 2: Railway

Railway is another excellent free option:

1. **Visit [railway.app](https://railway.app)**
2. **Sign up with GitHub**
3. **Deploy from GitHub**
   - Click "Deploy from GitHub repo"
   - Select your repository
   - Railway auto-detects Node.js and deploys

### Option 3: Cyclic

Cyclic offers good free hosting for Node.js apps:

1. **Visit [cyclic.sh](https://cyclic.sh)**
2. **Connect GitHub account**
3. **Deploy repository**
   - Select your GitHub repository
   - Cyclic automatically deploys

## Environment Variables

For production deployment, you may want to set:

- `NODE_ENV=production`
- `PORT=10000` (for Render)

## Database Persistence

The app uses SQLite which creates a local file. On free hosting:
- **Render**: Files persist between deployments
- **Railway**: Files persist
- **Cyclic**: Files may not persist (consider upgrading)

## Custom Domain (Optional)

Most platforms allow custom domains on free plans:
1. Purchase a domain from any registrar
2. Add it in your hosting platform's dashboard
3. Update DNS records as instructed

## Monitoring

Free hosting platforms provide:
- ✅ Automatic HTTPS
- ✅ Basic monitoring
- ✅ Logs and metrics
- ✅ Auto-sleep (app sleeps after 30 min of inactivity)

## Cost Considerations

**Free Tier Limitations:**
- App may sleep after inactivity (30 min)
- Limited monthly hours (usually 500-750)
- Shared resources

**To upgrade later:**
- ~$7/month for dedicated hosting
- No sleep mode
- Better performance
- More storage

## Getting Started

1. **Choose a platform** (Render recommended)
2. **Push code to GitHub**
3. **Connect and deploy**
4. **Test your live app**
5. **Share the URL with others!**

Your learning tracker will be accessible 24/7 at your custom URL! 🎉
