# Setup Guide for Learning Progress Tracker

## Prerequisites Installation

### 1. Install Node.js

**Windows:**
1. Visit [nodejs.org](https://nodejs.org/)
2. Download the LTS version (recommended)
3. Run the installer and follow the setup wizard
4. Restart your computer after installation

**Verify Installation:**
Open Command Prompt or PowerShell and run:
```cmd
node --version
npm --version
```

You should see version numbers for both commands.

### 2. Download or Clone the Project

If you have Git installed:
```cmd
git clone <repository-url>
cd learning-progress-tracker
```

Or download the project files and extract them to a folder.

## Quick Start

### Option 1: Use the Startup Script (Windows)
1. Double-click `start.bat` in the project folder
2. The script will automatically install dependencies and start the server
3. Open your browser to `http://localhost:3000`

### Option 2: Manual Setup
1. Open Command Prompt or PowerShell
2. Navigate to the project folder:
   ```cmd
   cd path\to\learning-progress-tracker
   ```
3. Install dependencies:
   ```cmd
   npm install
   ```
4. Start the application:
   ```cmd
   npm start
   ```
5. Open your browser to `http://localhost:3000`

## First Time Setup

1. **Load Sample Data**: Click "Load Sample Curriculum" to get started with a pre-built automation learning curriculum
2. **Or Import Your Own**: Use "Import Excel File" to upload your own curriculum from an Excel file
3. **Start Learning**: Click on any topic to update its status and add notes

## Troubleshooting

### "npm is not recognized"
- Make sure Node.js is properly installed
- Restart your command prompt/PowerShell
- Try restarting your computer

### Port 3000 is already in use
- Another application is using port 3000
- Close other applications or change the port in `server.js`

### Cannot find module errors
- Run `npm install` again
- Delete `node_modules` folder and run `npm install`

### Database issues
- Delete `learning_progress.db` file and restart the app
- The database will be recreated automatically

## Development Mode

For development with auto-restart on file changes:
```cmd
npm run dev
```

Note: This requires nodemon, which is included in the dev dependencies.

## Usage Tips

### Excel Import Format
Your Excel file should have these columns:
- **Title**: Topic name
- **Description**: What the topic covers
- **Category**: Subject area
- **Module**: Module grouping

### Keyboard Shortcuts
- **Escape**: Close modal windows
- **Click outside modal**: Close modal

### Data Persistence
- Your progress is automatically saved in a local database
- Data persists between sessions
- To reset all data, delete the `learning_progress.db` file

## Features Overview

### Progress Tracking
- Visual progress bars
- Completion statistics
- Color-coded status indicators

### Gamification
- Points for completed topics (10 points each)
- Level progression (level up every 100 points)
- Achievement badges for milestones

### Organization
- Module-based curriculum organization
- Grid and list view options
- Search and filter capabilities

### Notes & Reflection
- Add personal notes to each topic
- Track learning resources and links
- Record thoughts and reflections

Happy Learning! 🚀
