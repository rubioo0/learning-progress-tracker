# Quick Start Guide - Learning Progress Tracker

## Issue: Node.js Not Installed

The errors you're experiencing ("Error previewing Excel file" and "Error clearing curriculum") are because Node.js is not installed on your system, so the server isn't running.

## Solution: Install Node.js

### Step 1: Install Node.js
1. **Go to**: [https://nodejs.org/](https://nodejs.org/)
2. **Download**: Click "Download" for the LTS version (recommended)
3. **Install**: Run the installer and follow the setup wizard
4. **Restart**: Restart your computer after installation

### Step 2: Verify Installation
Open Command Prompt or PowerShell and run:
```cmd
node --version
npm --version
```
You should see version numbers (e.g., v18.17.0 and 9.6.7).

### Step 3: Start the Application
1. **Navigate to project folder**:
   ```cmd
   cd "c:\code\PR1_QARoad"
   ```

2. **Install dependencies** (first time only):
   ```cmd
   npm install
   ```

3. **Start the server**:
   ```cmd
   npm start
   ```
   
   Or simply double-click the `start.bat` file.

4. **Open in browser**: Go to `http://localhost:3000`

## Expected Behavior

Once the server is running, you should see:
- ✅ Excel preview showing your 16 sheets with A1/B1 data
- ✅ Clear curriculum function working
- ✅ Import creating topics from each sheet

## Troubleshooting

### "npm is not recognized"
- Node.js is not installed or not in PATH
- Restart Command Prompt/PowerShell after installing Node.js
- Try restarting your computer

### "Port 3000 is already in use"
- Another application is using port 3000
- Change the port in `server.js` (line with `PORT = process.env.PORT || 3000`)

### Excel Import Still Not Working
1. **Check file format**: Ensure your file is .xlsx or .xls
2. **Verify structure**: Each sheet should have:
   - A1: Level/Role
   - B1: Task Name
   - Column C: Labels (Descriptions, ARTIFACTS, etc.)
   - Column D: Corresponding values

### Server Connection Errors
- Make sure the server is running (`npm start`)
- Check the terminal for error messages
- Try refreshing the browser page

## Test with Sample Data

If Excel import isn't working immediately:
1. Click "Load Sample Curriculum" to test the basic functionality
2. Verify the app is working correctly
3. Then try importing your Excel file

## Need Help?

1. **Check the terminal** where you ran `npm start` for error messages
2. **Look for console errors** in browser (press F12 → Console tab)
3. **Verify your Excel structure** matches the expected format

The system is specifically designed for your Excel format with 16 sheets, each containing:
- A1: Level (e.g., "Junior Test Automation Engineer")
- B1: Task Name
- C/D columns: Structured data (Descriptions, ARTIFACTS, NEBo Tasks, Outcomes, Learning Resources)

Once Node.js is installed and the server is running, your Excel import should work perfectly!
