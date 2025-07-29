const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Initialize SQLite database
const db = new sqlite3.Database('./learning_progress.db');

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT,
        module TEXT,
        status TEXT DEFAULT 'not-started',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        order_index INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total_topics INTEGER,
        completed_topics INTEGER,
        in_progress_topics INTEGER,
        points INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS achievements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        type TEXT
    )`);
});

// Routes

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all topics
app.get('/api/topics', (req, res) => {
    db.all('SELECT * FROM topics ORDER BY order_index, id', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Update topic status
app.put('/api/topics/:id', (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    
    db.run(
        'UPDATE topics SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, notes, id],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            // Update progress and check for achievements
            updateProgress();
            checkAchievements();
            
            res.json({ message: 'Topic updated successfully' });
        }
    );
});

// Get progress statistics
app.get('/api/progress', (req, res) => {
    db.get(`
        SELECT 
            COUNT(*) as total_topics,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_topics,
            SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as in_progress_topics,
            SUM(CASE WHEN status = 'not-started' THEN 1 ELSE 0 END) as not_started_topics
        FROM topics
    `, (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        const completionPercentage = row.total_topics > 0 ? 
            Math.round((row.completed_topics / row.total_topics) * 100) : 0;
        
        const points = row.completed_topics * 10; // 10 points per completed topic
        const level = Math.floor(points / 100) + 1; // Level up every 100 points
        
        res.json({
            ...row,
            completion_percentage: completionPercentage,
            points,
            level
        });
    });
});

// Get achievements
app.get('/api/achievements', (req, res) => {
    db.all('SELECT * FROM achievements ORDER BY earned_at DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Upload Excel file
app.post('/api/upload-excel', upload.single('excel'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        console.log('Processing Excel file:', req.file.originalname);
        const workbook = XLSX.readFile(req.file.path);
        console.log('Available sheets:', workbook.SheetNames);
        
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'No sheets found in Excel file' });
        }
        
        // Clear existing topics
        db.run('DELETE FROM topics', (err) => {
            if (err) {
                console.error('Database error clearing topics:', err);
                fs.unlinkSync(req.file.path);
                res.status(500).json({ error: 'Database error: ' + err.message });
                return;
            }

            const stmt = db.prepare(`
                INSERT INTO topics (title, description, category, module, order_index)
                VALUES (?, ?, ?, ?, ?)
            `);

            let successCount = 0;
            let totalSheets = 0;
            let orderIndex = 0;
            let errors = [];

            // Process each sheet
            workbook.SheetNames.forEach((sheetName, sheetIndex) => {
                try {
                    console.log(`Processing sheet ${sheetIndex + 1}: ${sheetName}`);
                    const worksheet = workbook.Sheets[sheetName];
                    
                    if (!worksheet) {
                        errors.push(`Sheet ${sheetName} is empty or unreadable`);
                        return;
                    }
                    
                    // Convert sheet to array of arrays to better handle your tab-separated structure
                    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                    console.log(`Sheet ${sheetName} has ${rawData.length} rows`);
                    
                    // Parse the data to group by tasks
                    const tasks = {};
                    let currentLevel = '';
                    let currentTask = '';
                    let currentSectionType = '';
                    
                    rawData.forEach((row, rowIndex) => {
                        if (row.length >= 4) {
                            const level = row[0] ? row[0].toString().trim() : '';
                            const task = row[1] ? row[1].toString().trim() : '';
                            const sectionType = row[2] ? row[2].toString().trim().toLowerCase() : '';
                            const content = row[3] ? row[3].toString().trim() : '';
                            
                            console.log(`Row ${rowIndex}: Level="${level}", Task="${task}", Section="${sectionType}", Content="${content.substring(0, 50)}..."`);
                            
                            // Update current level if provided
                            if (level) {
                                currentLevel = level;
                                console.log(`  -> Updated level to: ${currentLevel}`);
                            }
                            
                            // Update current task if provided
                            if (task) {
                                currentTask = task;
                                console.log(`  -> Updated task to: ${currentTask}`);
                                // Initialize task if not exists
                                if (!tasks[currentTask]) {
                                    tasks[currentTask] = {
                                        level: currentLevel,
                                        task: currentTask,
                                        descriptions: [],
                                        artifacts: [],
                                        neboTasks: [],
                                        outcomes: [],
                                        learningResources: [],
                                        other: []
                                    };
                                }
                            }
                            
                            // Update current section type if provided
                            if (sectionType) {
                                currentSectionType = sectionType;
                                console.log(`  -> Updated section type to: ${currentSectionType}`);
                            }
                            
                            // Add content to appropriate section if we have a current task and content
                            if (currentTask && content && tasks[currentTask]) {
                                if (currentSectionType.includes('description')) {
                                    tasks[currentTask].descriptions.push(content);
                                    console.log(`  -> Added to descriptions: ${content.substring(0, 30)}...`);
                                } else if (currentSectionType.includes('artifact')) {
                                    tasks[currentTask].artifacts.push(content);
                                    console.log(`  -> Added to artifacts: ${content.substring(0, 30)}...`);
                                } else if (currentSectionType.includes('nebo') || (currentSectionType.includes('task') && !currentSectionType.includes('name'))) {
                                    tasks[currentTask].neboTasks.push(content);
                                    console.log(`  -> Added to neboTasks: ${content.substring(0, 30)}...`);
                                } else if (currentSectionType.includes('outcome')) {
                                    tasks[currentTask].outcomes.push(content);
                                    console.log(`  -> Added to outcomes: ${content.substring(0, 30)}...`);
                                } else if (currentSectionType.includes('learning') || currentSectionType.includes('resource')) {
                                    tasks[currentTask].learningResources.push(content);
                                    console.log(`  -> Added to learningResources: ${content.substring(0, 30)}...`);
                                } else if (currentSectionType) {
                                    tasks[currentTask].other.push(`${currentSectionType}: ${content}`);
                                    console.log(`  -> Added to other: ${currentSectionType}: ${content.substring(0, 30)}...`);
                                } else {
                                    // If no section type, assume it's a description
                                    tasks[currentTask].descriptions.push(content);
                                    console.log(`  -> Added to descriptions (no section): ${content.substring(0, 30)}...`);
                                }
                            }
                        }
                    });
                    
                    console.log(`Found ${Object.keys(tasks).length} tasks in sheet ${sheetName}`);
                    
                    // Create topics from parsed tasks
                    Object.values(tasks).forEach((taskData) => {
                        if (taskData.task) {
                            // Build comprehensive description
                            const descriptionParts = [];
                            
                            if (taskData.descriptions.length > 0) {
                                descriptionParts.push(`**Descriptions:**\n${taskData.descriptions.join('\n• ')}`);
                            }
                            
                            if (taskData.artifacts.length > 0) {
                                descriptionParts.push(`**Artifacts:**\n${taskData.artifacts.join('\n• ')}`);
                            }
                            
                            if (taskData.neboTasks.length > 0) {
                                descriptionParts.push(`**NEBo Tasks:**\n${taskData.neboTasks.join('\n• ')}`);
                            }
                            
                            if (taskData.outcomes.length > 0) {
                                descriptionParts.push(`**Outcomes:**\n${taskData.outcomes.join('\n• ')}`);
                            }
                            
                            if (taskData.learningResources.length > 0) {
                                descriptionParts.push(`**Learning Resources:**\n${taskData.learningResources.join('\n• ')}`);
                            }
                            
                            if (taskData.other.length > 0) {
                                descriptionParts.push(`**Additional Information:**\n${taskData.other.join('\n• ')}`);
                            }
                            
                            const fullDescription = descriptionParts.length > 0 ? 
                                descriptionParts.join('\n\n') : 
                                'No detailed description available.';
                            
                            // Insert the topic
                            stmt.run([
                                taskData.task,
                                fullDescription,
                                taskData.level || 'General',
                                `${sheetName}`,
                                orderIndex++
                            ]);
                            
                            successCount++;
                            console.log(`✓ Created topic: ${taskData.task}`);
                        }
                    });
                    
                    totalSheets++;
                    
                } catch (sheetError) {
                    console.error(`Error processing sheet ${sheetName}:`, sheetError);
                    errors.push(`Sheet ${sheetName}: ${sheetError.message}`);
                }
            });

            stmt.finalize((err) => {
                if (err) {
                    console.error('Error finalizing database statement:', err);
                    fs.unlinkSync(req.file.path);
                    res.status(500).json({ error: 'Database error during finalization: ' + err.message });
                    return;
                }
                
                // Clean up uploaded file
                fs.unlinkSync(req.file.path);
                
                console.log(`Import completed: ${successCount} topics added, ${errors.length} errors`);
                
                res.json({ 
                    message: `Excel data imported successfully! ${successCount} topics added from ${totalSheets} sheets.`,
                    count: successCount,
                    totalSheets: workbook.SheetNames.length,
                    sheetsProcessed: totalSheets,
                    errors: errors.length > 0 ? errors : undefined,
                    success: true
                });
            });
        });
    } catch (error) {
        console.error('Excel processing error:', error);
        // Clean up file if it exists
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Error processing Excel file: ' + error.message });
    }
});

// Add sample data
app.post('/api/sample-data', (req, res) => {
    const sampleTopics = [
        // Module 1: Automation Fundamentals
        { title: "Introduction to Automation", description: "Understanding automation concepts and benefits", category: "Fundamentals", module: "Module 1: Fundamentals", order_index: 1 },
        { title: "Automation Tools Overview", description: "Survey of popular automation tools and platforms", category: "Fundamentals", module: "Module 1: Fundamentals", order_index: 2 },
        { title: "Scripting Basics", description: "Introduction to scripting languages for automation", category: "Fundamentals", module: "Module 1: Fundamentals", order_index: 3 },
        { title: "Error Handling", description: "Best practices for handling errors in automation", category: "Fundamentals", module: "Module 1: Fundamentals", order_index: 4 },
        
        // Module 2: Web Automation
        { title: "Selenium WebDriver", description: "Getting started with Selenium for web automation", category: "Web Automation", module: "Module 2: Web Automation", order_index: 5 },
        { title: "Page Object Model", description: "Implementing maintainable test automation with POM", category: "Web Automation", module: "Module 2: Web Automation", order_index: 6 },
        { title: "Browser DevTools", description: "Using browser developer tools for automation", category: "Web Automation", module: "Module 2: Web Automation", order_index: 7 },
        { title: "Dynamic Content Handling", description: "Working with AJAX and dynamic web content", category: "Web Automation", module: "Module 2: Web Automation", order_index: 8 },
        
        // Module 3: API Testing
        { title: "REST API Basics", description: "Understanding RESTful APIs and HTTP methods", category: "API Testing", module: "Module 3: API Testing", order_index: 9 },
        { title: "Postman for API Testing", description: "Using Postman for API testing and automation", category: "API Testing", module: "Module 3: API Testing", order_index: 10 },
        { title: "API Test Automation", description: "Automating API tests with code", category: "API Testing", module: "Module 3: API Testing", order_index: 11 },
        { title: "Authentication & Security", description: "Handling API authentication in automated tests", category: "API Testing", module: "Module 3: API Testing", order_index: 12 },
        
        // Module 4: CI/CD Integration
        { title: "Version Control with Git", description: "Git fundamentals for automation projects", category: "CI/CD", module: "Module 4: CI/CD Integration", order_index: 13 },
        { title: "Continuous Integration", description: "Setting up CI pipelines for automation", category: "CI/CD", module: "Module 4: CI/CD Integration", order_index: 14 },
        { title: "Test Reporting", description: "Generating and analyzing test reports", category: "CI/CD", module: "Module 4: CI/CD Integration", order_index: 15 },
        { title: "Deployment Automation", description: "Automating application deployment processes", category: "CI/CD", module: "Module 4: CI/CD Integration", order_index: 16 }
    ];

    // Clear existing topics
    db.run('DELETE FROM topics', (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        const stmt = db.prepare(`
            INSERT INTO topics (title, description, category, module, order_index)
            VALUES (?, ?, ?, ?, ?)
        `);

        sampleTopics.forEach(topic => {
            stmt.run([topic.title, topic.description, topic.category, topic.module, topic.order_index]);
        });

        stmt.finalize();
        res.json({ message: 'Sample data added successfully', count: sampleTopics.length });
    });
});

// Debug endpoint to preview Excel file structure
app.post('/api/preview-excel', upload.single('excel'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        console.log('Previewing Excel file:', req.file.originalname);
        const workbook = XLSX.readFile(req.file.path);
        console.log('Previewing Excel with sheets:', workbook.SheetNames);
        
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'No sheets found in Excel file' });
        }
        
        const sheetsPreview = [];
        const errors = [];
        
        // Preview each sheet (limit to first 5 for performance)
        workbook.SheetNames.slice(0, 5).forEach((sheetName, index) => {
            try {
                const worksheet = workbook.Sheets[sheetName];
                
                if (!worksheet) {
                    errors.push(`Sheet ${sheetName} is empty or unreadable`);
                    return;
                }
                
                // Read A1 and B1 cells with better error handling
                let level = 'Not found';
                let taskName = 'Not found';
                
                try {
                    const levelCell = worksheet['A1'];
                    const taskNameCell = worksheet['B1'];
                    
                    level = levelCell && levelCell.v ? levelCell.v.toString().trim() : 'Not found';
                    taskName = taskNameCell && taskNameCell.v ? taskNameCell.v.toString().trim() : 'Not found';
                } catch (cellError) {
                    console.error(`Error reading A1/B1 in sheet ${sheetName}:`, cellError);
                    level = 'Error reading';
                    taskName = 'Error reading';
                }
                
                // Read structure from columns C and D
                const structureData = [];
                for (let row = 1; row <= 15; row++) { // Preview first 15 rows
                    try {
                        const cCell = worksheet[`C${row}`];
                        const dCell = worksheet[`D${row}`];
                        
                        if (cCell && cCell.v) {
                            const label = cCell.v.toString().trim();
                            const value = dCell && dCell.v ? dCell.v.toString().substring(0, 150) : '(empty)';
                            
                            if (label && value !== '(empty)') {
                                structureData.push({
                                    row: row,
                                    label: label,
                                    value: value + (dCell && dCell.v && dCell.v.toString().length > 150 ? '...' : '')
                                });
                            }
                        }
                    } catch (rowError) {
                        console.error(`Error reading row ${row} in sheet ${sheetName}:`, rowError);
                    }
                }
                
                sheetsPreview.push({
                    sheetName,
                    index: index + 1,
                    level,
                    taskName,
                    structureData: structureData,
                    dataFound: structureData.length > 0
                });
                
                console.log(`✓ Previewed sheet: ${sheetName}, Data rows: ${structureData.length}`);
                
            } catch (sheetError) {
                console.error(`Error previewing sheet ${sheetName}:`, sheetError);
                errors.push(`Sheet ${sheetName}: ${sheetError.message}`);
                sheetsPreview.push({
                    sheetName,
                    index: index + 1,
                    level: 'Error reading',
                    taskName: 'Error reading',
                    error: sheetError.message,
                    structureData: []
                });
            }
        });
        
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        
        console.log(`Preview completed: ${sheetsPreview.length} sheets previewed, ${errors.length} errors`);
        
        res.json({
            totalSheets: workbook.SheetNames.length,
            sheetNames: workbook.SheetNames,
            sheetsPreview,
            structure: {
                A1: 'Level (e.g., Junior Test Automation Engineer)',
                B1: 'Task Name (e.g., Perform/Execute tests...)',
                'Column C': 'Labels (Descriptions, ARTIFACTS, NEBo Tasks, etc.)',
                'Column D': 'Values for the labels in Column C'
            },
            errors: errors.length > 0 ? errors : undefined,
            success: true
        });
    } catch (error) {
        console.error('Excel preview error:', error);
        // Clean up file if it exists
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Error previewing Excel file: ' + error.message });
    }
});

// Clear all curriculum data
app.delete('/api/clear-curriculum', (req, res) => {
    db.serialize(() => {
        db.run('DELETE FROM topics', (err) => {
            if (err) {
                res.status(500).json({ error: 'Error clearing topics: ' + err.message });
                return;
            }
        });
        
        db.run('DELETE FROM progress', (err) => {
            if (err) {
                res.status(500).json({ error: 'Error clearing progress: ' + err.message });
                return;
            }
        });
        
        db.run('DELETE FROM achievements', (err) => {
            if (err) {
                res.status(500).json({ error: 'Error clearing achievements: ' + err.message });
                return;
            }
            
            res.json({ message: 'All curriculum data cleared successfully' });
        });
    });
});

// File attachment endpoints
app.post('/api/topics/:id/attachment', upload.single('attachment'), (req, res) => {
    const { id } = req.params;
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const { path: attachmentPath, originalname, filename } = req.file;
    db.run(
        'UPDATE topics SET attachment_filename = ?, attachment_original_name = ?, attachment_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [filename, originalname, attachmentPath, id],
        function(err) {
            if (err) {
                // Clean up file if DB update fails
                if (attachmentPath && fs.existsSync(attachmentPath)) fs.unlinkSync(attachmentPath);
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: 'File attached successfully', filename: originalname });
        }
    );
});

app.get('/api/topics/:id/attachment', (req, res) => {
    const { id } = req.params;
    db.get('SELECT attachment_path, attachment_original_name FROM topics WHERE id = ?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row || !row.attachment_path) {
            return res.status(404).json({ error: 'No attachment found for this topic' });
        }
        const filePath = path.join(__dirname, row.attachment_path);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Attachment file not found on disk' });
        }
        res.download(filePath, row.attachment_original_name);
    });
});

app.delete('/api/topics/:id/attachment', (req, res) => {
    const { id } = req.params;
    db.get('SELECT attachment_path FROM topics WHERE id = ?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row && row.attachment_path && fs.existsSync(row.attachment_path)) {
            fs.unlinkSync(row.attachment_path);
        }
        db.run(
            'UPDATE topics SET attachment_filename = NULL, attachment_original_name = NULL, attachment_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Attachment removed successfully' });
            }
        );
    });
});

// Add this endpoint for file preview (text/xlsx)
app.get('/api/topics/:id/attachment/preview', (req, res) => {
    const { id } = req.params;
    db.get('SELECT attachment_path, attachment_original_name FROM topics WHERE id = ?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message, canPreview: false });
        if (!row || !row.attachment_path) {
            return res.status(404).json({ error: 'No attachment found for this topic', canPreview: false });
        }
        const filePath = path.join(__dirname, row.attachment_path);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Attachment file not found on disk', canPreview: false });
        }

        // Only allow preview for text and xlsx files (simple check)
        const ext = path.extname(row.attachment_original_name).toLowerCase();
        const textExts = ['.txt', '.md', '.markdown', '.json', '.js', '.ts', '.py', '.java', '.c', '.cpp'];
        const xlsxExts = ['.xlsx', '.xls'];
        const maxPreviewSize = 50 * 1024; // 50KB

        if (![...textExts, ...xlsxExts].includes(ext)) {
            return res.status(400).json({ error: 'File type not supported for preview', canPreview: false });
        }
        try {
            const stats = fs.statSync(filePath);
            if (stats.size > maxPreviewSize) {
                return res.status(400).json({ error: 'File too large for preview (max 50KB)', canPreview: false });
            }
            if (xlsxExts.includes(ext)) {
                // XLSX preview (first 3 sheets, basic info)
                try {
                    const XLSX = require('xlsx');
                    const workbook = XLSX.readFile(filePath);
                    const sheetsPreview = [];
                    workbook.SheetNames.slice(0, 3).forEach((sheetName, index) => {
                        const worksheet = workbook.Sheets[sheetName];
                        let level = 'Not found', taskName = 'Not found';
                        try {
                            const levelCell = worksheet['A1'];
                            const taskNameCell = worksheet['B1'];
                            level = levelCell && levelCell.v ? levelCell.v.toString().trim() : 'Not found';
                            taskName = taskNameCell && taskNameCell.v ? taskNameCell.v.toString().trim() : 'Not found';
                        } catch {}
                        sheetsPreview.push({
                            sheetName,
                            index: index + 1,
                            level,
                            taskName,
                            structureData: [],
                            dataFound: true
                        });
                    });
                    return res.json({
                        type: 'xlsx',
                        xlsxData: {
                            totalSheets: workbook.SheetNames.length,
                            sheetNames: workbook.SheetNames,
                            sheetsPreview
                        },
                        filename: row.attachment_original_name,
                        fileSize: stats.size,
                        canPreview: true
                    });
                } catch (e) {
                    return res.status(500).json({ error: 'Error parsing XLSX file: ' + e.message, canPreview: false });
                }
            } else {
                // Text file preview
                let content = '';
                try {
                    content = fs.readFileSync(filePath, 'utf8');
                } catch (e) {
                    return res.status(500).json({ error: 'Error reading file: ' + e.message, canPreview: false });
                }
                return res.json({
                    type: 'text',
                    content,
                    filename: row.attachment_original_name,
                    fileSize: stats.size,
                    extension: ext,
                    canPreview: true
                });
            }
        } catch (e) {
            return res.status(500).json({ error: 'Error accessing file: ' + e.message, canPreview: false });
        }
    });
});

// Helper functions
function updateProgress() {
    db.get(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as in_progress
        FROM topics
    `, (err, row) => {
        if (err) return;
        
        db.run(`
            INSERT OR REPLACE INTO progress (id, total_topics, completed_topics, in_progress_topics, points, level)
            VALUES (1, ?, ?, ?, ?, ?)
        `, [row.total, row.completed, row.in_progress, row.completed * 10, Math.floor((row.completed * 10) / 100) + 1]);
    });
}

function checkAchievements() {
    db.get('SELECT COUNT(*) as completed FROM topics WHERE status = "completed"', (err, row) => {
        if (err) return;
        
        const milestones = [
            { count: 1, title: "First Steps", description: "Completed your first topic!" },
            { count: 5, title: "Getting Started", description: "Completed 5 topics!" },
            { count: 10, title: "Making Progress", description: "Completed 10 topics!" },
            { count: 20, title: "Halfway There", description: "Completed 20 topics!" }
        ];
        
        milestones.forEach(milestone => {
            if (row.completed === milestone.count) {
                db.run(`
                    INSERT INTO achievements (title, description, type)
                    VALUES (?, ?, 'milestone')
                `, [milestone.title, milestone.description]);
            }
        });
    });
}

app.listen(PORT, () => {
    console.log(`Learning Progress Tracker running on http://localhost:${PORT}`);
});
