@echo off
echo ================================
echo  Learning Progress Tracker
echo  Quick Deployment Helper
echo ================================
echo.

echo TROUBLESHOOTING: If you're seeing errors (502, 503, "Application loading"):
echo 1. Check Render logs in your dashboard
echo 2. Try Railway instead (more reliable): railway.app
echo 3. See TROUBLESHOOTING.md for detailed help
echo.

echo Current fixes applied:
echo - Better error handling
echo - Fixed database paths  
echo - Added health check endpoint
echo - Improved logging
echo.

echo To update your deployment with fixes:
echo.
echo git add .
echo git commit -m "Fix deployment issues"
echo git push origin main
echo.

echo Alternative: Try Railway (recommended if Render fails):
echo 1. Visit: https://railway.app
echo 2. Sign up with GitHub
echo 3. Click "Deploy from GitHub repo"  
echo 4. Select your repository
echo 5. Done! (Usually works better than Render)
echo.

echo Your app will be live in 1-2 minutes!
echo.
pause
