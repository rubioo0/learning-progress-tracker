# Learning Progress Tracker

A modern web-based application for tracking your learning progress through automation skills curriculum. Features interactive topic management, progress visualization, gamification elements, and Excel import capabilities.

## Features

### 📊 **Progress Dashboard**
- Visual progress bars showing overall completion percentage
- Statistics grid with completed, in-progress, and pending topics
- Real-time updates as you mark topics complete

### 📚 **Interactive Curriculum**
- **Module View**: Topics organized by learning modules with individual module progress
- **Grid View**: Card-based layout for quick overview
- Color-coded status indicators (Not Started, In Progress, Completed)
- Click any topic to update status and add notes

### 🎯 **Gamification**
- Points system (10 points per completed topic)
- Level progression (level up every 100 points)
- Achievement system with milestone badges
- Popup notifications for new achievements

### 📝 **Topic Management**
- Detailed topic information with descriptions
- Personal notes and reflections for each topic
- Status tracking with visual indicators
- Easy status updates through modal interface

### 📁 **Data Import/Export**
- Import curriculum from Excel files (.xlsx, .xls)
- Sample automation curriculum included
- Persistent storage with SQLite database

### 🎨 **Modern UI/UX**
- Responsive design that works on desktop and mobile
- Smooth animations and transitions
- Intuitive hover effects and visual feedback
- Accessibility-focused design

## Quick Start

### Prerequisites
- Node.js (version 14 or higher)
- npm (comes with Node.js)

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the application:**
   ```bash
   npm start
   ```

3. **Open your browser:**
   Navigate to `http://localhost:3000`

4. **Load sample data:**
   Click "Load Sample Curriculum" to get started with a pre-built automation learning path

## Usage Guide

### Getting Started
1. **Load Initial Data**: Use either the "Load Sample Curriculum" button for a pre-built automation curriculum, or import your own Excel file
2. **Explore Topics**: Browse through topics organized by modules or switch to grid view
3. **Track Progress**: Click on any topic to update its status and add personal notes

### Excel Import Format
Your Excel file should have columns for:
- **Title**: Topic name
- **Description**: Brief description of the topic
- **Category**: Subject area (e.g., "Web Automation", "API Testing")
- **Module**: Module grouping (e.g., "Module 1: Fundamentals")

Example Excel structure:
| Title | Description | Category | Module |
|-------|-------------|----------|--------|
| Introduction to Automation | Understanding automation concepts | Fundamentals | Module 1: Fundamentals |
| Selenium WebDriver | Getting started with Selenium | Web Automation | Module 2: Web Automation |

### Status Management
- **Not Started** (Gray): Topic hasn't been started yet
- **In Progress** (Yellow): Currently working on this topic
- **Completed** (Green): Topic has been finished

### Notes and Reflections
Use the notes feature to:
- Record key learning points
- Add links to helpful resources
- Track your thoughts and reflections
- Note areas that need more practice

## Sample Curriculum

The included sample curriculum covers:

### Module 1: Automation Fundamentals
- Introduction to Automation
- Automation Tools Overview
- Scripting Basics
- Error Handling

### Module 2: Web Automation
- Selenium WebDriver
- Page Object Model
- Browser DevTools
- Dynamic Content Handling

### Module 3: API Testing
- REST API Basics
- Postman for API Testing
- API Test Automation
- Authentication & Security

### Module 4: CI/CD Integration
- Version Control with Git
- Continuous Integration
- Test Reporting
- Deployment Automation

## Development

### Project Structure
```
learning-progress-tracker/
├── server.js              # Express.js backend server
├── package.json           # Node.js dependencies and scripts
├── public/
│   └── index.html         # Frontend application
├── uploads/               # Temporary file upload directory
└── learning_progress.db   # SQLite database (created automatically)
```

### API Endpoints
- `GET /api/topics` - Retrieve all topics
- `PUT /api/topics/:id` - Update topic status and notes
- `GET /api/progress` - Get progress statistics
- `GET /api/achievements` - Retrieve achievements
- `POST /api/upload-excel` - Import Excel file
- `POST /api/sample-data` - Load sample curriculum

### Database Schema
- **topics**: Stores learning topics with status, notes, and organization
- **progress**: Tracks overall progress statistics
- **achievements**: Records earned milestones and badges

## Customization

### Adding Your Own Curriculum
1. **Excel Import**: Create an Excel file with your topics and import it
2. **Manual Addition**: Modify the sample data in `server.js` to include your topics
3. **API Integration**: Use the REST API to programmatically add topics

### Styling
The application uses Tailwind CSS for styling. Modify the classes in `index.html` to customize the appearance.

### Gamification
Adjust the points and achievement system in `server.js`:
- Change points per completed topic
- Modify level progression requirements
- Add new achievement milestones

## Educational Benefits

### Structured Learning
- **Clear Path**: Organized curriculum with logical progression
- **Milestones**: Module-based organization with completion tracking
- **Focus**: One topic at a time approach reduces overwhelm

### Motivation & Engagement
- **Visual Progress**: Progress bars and statistics provide immediate feedback
- **Gamification**: Points, levels, and achievements maintain engagement
- **Achievement Recognition**: Celebrate completion of milestones

### Self-Reflection
- **Notes System**: Encourage reflection and knowledge consolidation
- **Progress Tracking**: Self-monitoring enhances learning outcomes
- **Customization**: Adapt the curriculum to your specific needs

## Research-Backed Features

This application incorporates educational research findings:
- **Progress Visualization**: Studies show visual progress indicators improve motivation
- **Gamification**: Research indicates points and badges increase learner engagement
- **Self-Monitoring**: Progress tracking enhances self-regulation and learning outcomes
- **Milestone Celebration**: Breaking large goals into smaller achievements sustains motivation
- **Structured Curriculum**: Clear learning paths with explicit steps improve outcomes

## Troubleshooting

### Common Issues

**App won't start:**
- Ensure Node.js is installed: `node --version`
- Check if port 3000 is available
- Try `npm install` again

**Excel import fails:**
- Verify file format (.xlsx or .xls)
- Check that required columns exist
- Ensure file isn't corrupted

**Database issues:**
- Delete `learning_progress.db` to reset
- Restart the application

### Support
For technical issues or feature requests, check the application logs in the terminal where you started the server.

## License

MIT License - feel free to use and modify for your learning needs!

---

**Happy Learning!** 🚀

Remember: "Learning by doing projects is an excellent way to learn" - use this tracker to build both your automation skills and your project portfolio!
