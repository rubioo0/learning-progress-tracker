@echo off
echo ================================
echo  Learning Progress Tracker
echo  Quick Deployment Helper
echo ================================
echo.

echo 1. Make sure you have created a GitHub repository
echo 2. Replace YOUR_USERNAME with your actual GitHub username in the command below
echo.

echo To deploy to GitHub and then to Render:
echo.
echo git remote add origin https://github.com/YOUR_USERNAME/learning-progress-tracker.git
echo git branch -M main  
echo git push -u origin main
echo.

echo Then visit: https://render.com
echo - Sign up with your GitHub account
echo - Click "New +" -^> "Web Service"
echo - Connect your GitHub repository
echo - Use default settings (Node.js auto-detected)
echo - Click "Create Web Service"
echo.

echo Your app will be live in 2-3 minutes!
echo.
pause
