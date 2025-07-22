const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Import custom modules
const config = require('./config/app-config');
const DatabaseService = require('./services/database');
const helpers = require('./utils/helpers');

const app = express();
const dbService = new DatabaseService();

// Middleware
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());

// Configure multer for file uploads
const upload = multer({ dest: config.UPLOAD_DIRECTORY });

// Routes

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all topics
app.get('/api/topics', (req, res) => {
    dbService.getAllTopics((err, rows) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json(rows);
    });
});

// Update topic status
app.put('/api/topics/:id', (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    
    dbService.updateTopic(id, status, notes, (err) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json({ message: 'Topic updated successfully' });
    });
});

// Get progress statistics
app.get('/api/progress', (req, res) => {
    dbService.getProgress((err, row) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json(helpers.calculateProgress(row));
    });
});

// Get achievements
app.get('/api/achievements', (req, res) => {
    dbService.getAchievements((err, rows) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json(rows);
    });
});

// File attachment endpoints
app.post('/api/topics/:id/attachment', upload.single('attachment'), (req, res) => {
    const { id } = req.params;
    console.log(`File upload request for topic ${id}`);
    
    if (!req.file) {
        console.log('No file received in upload request');
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const { path: attachmentPath, originalname, filename } = req.file;
    console.log(`File uploaded: ${originalname} -> ${filename} at ${attachmentPath}`);
    
    dbService.updateTopicAttachment(id, filename, originalname, attachmentPath, (err) => {
        if (err) {
            console.error('Database error during file attachment:', err);
            return helpers.handleDatabaseError(res, err);
        }
        console.log(`File attached successfully to topic ${id}`);
        res.json({ message: 'File attached successfully', filename: originalname });
    });
});

app.get('/api/topics/:id/attachment/preview', (req, res) => {
    const { id } = req.params;
    console.log(`Preview request for topic ID: ${id}`);
    
    dbService.getTopicAttachment(id, (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return helpers.handleDatabaseError(res, err);
        }
        
        if (!row || !row.attachment_path) {
            console.log(`No attachment found for topic ${id}`);
            return res.status(404).json({ error: 'No attachment found for this topic' });
        }
        
        console.log(`Found attachment: ${row.attachment_original_name} at ${row.attachment_path}`);
        
        const filePath = path.join(__dirname, row.attachment_path);
        
        if (!fs.existsSync(filePath)) {
            console.error(`File not found on disk: ${filePath}`);
            return res.status(404).json({ error: 'Attachment file not found on disk' });
        }
        
        if (!helpers.isSupportedFileType(row.attachment_original_name)) {
            console.log(`Unsupported file type: ${row.attachment_original_name}`);
            return res.status(400).json({ error: 'File type not supported for preview', canPreview: false });
        }
        
        if (!helpers.isValidPreviewSize(filePath)) {
            console.log(`File too large for preview: ${filePath}`);
            return res.status(400).json({ error: 'File too large for preview (max 50KB)', canPreview: false });
        }
        
        try {
            // Check if it's an XLSX file
            if (helpers.isXlsxFileType(row.attachment_original_name)) {
                console.log('Processing XLSX file...');
                const xlsxPreview = helpers.parseXlsxForPreview(filePath);
                const stats = fs.statSync(filePath);
                
                if (xlsxPreview.success) {
                    console.log('XLSX preview successful');
                    res.json({
                        type: 'xlsx',
                        xlsxData: xlsxPreview,
                        filename: row.attachment_original_name,
                        fileSize: stats.size,
                        canPreview: true
                    });
                } else {
                    console.error('XLSX parsing failed:', xlsxPreview.error);
                    res.status(500).json({ 
                        error: 'Error parsing XLSX file: ' + xlsxPreview.error, 
                        canPreview: false 
                    });
                }
            } else {
                // Handle text files
                console.log('Processing text file...');
                const content = fs.readFileSync(filePath, 'utf8');
                const stats = fs.statSync(filePath);
                const fileExtension = path.extname(row.attachment_original_name).toLowerCase();
                
                console.log(`Text file read successfully, size: ${stats.size} bytes, type: ${fileExtension}`);
                
                // Determine file type for specific text formatting
                let fileType = 'text';
                if (['.md', '.markdown'].includes(fileExtension)) {
                    fileType = 'markdown';
                } else if (['.json', '.js', '.ts', '.py', '.java', '.cpp', '.c'].includes(fileExtension)) {
                    fileType = 'code';
                }
                
                res.json({
                    type: 'text',
                    subType: fileType,
                    content: content,
                    filename: row.attachment_original_name,
                    fileSize: stats.size,
                    extension: fileExtension,
                    canPreview: true
                });
            }
        } catch (readErr) {
            console.error('Error reading file:', readErr);
            let errorMessage = 'Error reading file content';
            
            if (readErr.code === 'ENOENT') {
                errorMessage = 'File not found on disk';
            } else if (readErr.code === 'EISDIR') {
                errorMessage = 'Path is a directory, not a file';
            } else if (readErr.code === 'EACCES') {
                errorMessage = 'Permission denied accessing file';
            } else if (readErr.message && readErr.message.includes('Invalid UTF-8')) {
                errorMessage = 'File is not valid UTF-8 text content';
            }
            
            res.status(500).json({ error: errorMessage, canPreview: false });
        }
    });
});

app.get('/api/topics/:id/attachment', (req, res) => {
    const { id } = req.params;
    
    dbService.getTopicAttachment(id, (err, row) => {
        if (err) return helpers.handleDatabaseError(res, err);
        
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
    
    dbService.getTopicAttachment(id, (err, row) => {
        if (err) return helpers.handleDatabaseError(res, err);
        
        if (row && row.attachment_path) {
            helpers.cleanupFile(path.join(__dirname, row.attachment_path));
        }
        
        dbService.removeTopicAttachment(id, (err) => {
            if (err) return helpers.handleDatabaseError(res, err);
            res.json({ message: 'Attachment removed successfully' });
        });
    });
});

// Excel processing endpoints
app.post('/api/upload-excel', upload.single('excel'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const workbook = XLSX.readFile(req.file.path);
        
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            helpers.cleanupFile(req.file.path);
            return res.status(400).json({ error: 'No sheets found in Excel file' });
        }
        
        dbService.clearTopics((err) => {
            if (err) {
                helpers.cleanupFile(req.file.path);
                return helpers.handleDatabaseError(res, err, 'Database error clearing topics');
            }

            let successCount = 0;
            let orderIndex = 0;
            let errors = [];
            const topicsToInsert = [];

            workbook.SheetNames.forEach((sheetName) => {
                try {
                    const worksheet = workbook.Sheets[sheetName];
                    
                    if (!worksheet) {
                        errors.push(`Sheet ${sheetName} is empty or unreadable`);
                        return;
                    }
                    
                    const tasks = helpers.parseExcelSheet(worksheet);
                    
                    Object.values(tasks).forEach((taskData) => {
                        if (taskData.task) {
                            const fullDescription = helpers.buildTopicDescription(taskData);
                            
                            topicsToInsert.push({
                                title: taskData.task,
                                description: fullDescription,
                                category: taskData.level || 'General',
                                module: sheetName,
                                order_index: orderIndex++
                            });
                            
                            successCount++;
                        }
                    });
                    
                } catch (sheetError) {
                    errors.push(`Sheet ${sheetName}: ${sheetError.message}`);
                }
            });

            dbService.bulkInsertTopics(topicsToInsert, (err) => {
                if (err) {
                    helpers.cleanupFile(req.file.path);
                    return helpers.handleDatabaseError(res, err, 'Database error during finalization');
                }
                
                helpers.cleanupFile(req.file.path);
                
                res.json({ 
                    message: `Excel data imported successfully! ${successCount} topics added from ${workbook.SheetNames.length} sheets.`,
                    count: successCount,
                    totalSheets: workbook.SheetNames.length,
                    sheetsProcessed: workbook.SheetNames.length,
                    errors: errors.length > 0 ? errors : undefined,
                    success: true
                });
            });
        });
    } catch (error) {
        helpers.cleanupFile(req.file?.path);
        res.status(500).json({ error: 'Error processing Excel file: ' + error.message });
    }
});

app.post('/api/preview-excel', upload.single('excel'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const workbook = XLSX.readFile(req.file.path);
        
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            helpers.cleanupFile(req.file.path);
            return res.status(400).json({ error: 'No sheets found in Excel file' });
        }

        const sheetsPreview = [];
        const errors = [];

        workbook.SheetNames.slice(0, config.MAX_PREVIEW_SHEETS).forEach((sheetName, index) => {
            try {
                const worksheet = workbook.Sheets[sheetName];
                
                if (!worksheet) {
                    errors.push(`Sheet ${sheetName} is empty or unreadable`);
                    return;
                }

                const sheetPreview = helpers.extractSheetPreview(worksheet, sheetName, index);
                sheetsPreview.push(sheetPreview);

            } catch (sheetError) {
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

        helpers.cleanupFile(req.file.path);

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
        helpers.cleanupFile(req.file?.path);
        res.status(500).json({ error: 'Error previewing Excel file: ' + error.message });
    }
});

// Sample data endpoint
app.post('/api/sample-data', (req, res) => {
    try {
        const sampleData = require('./data/sample-topics.json');
        
        dbService.clearTopics((err) => {
            if (err) return helpers.handleDatabaseError(res, err);

            dbService.bulkInsertTopics(sampleData, (err) => {
                if (err) return helpers.handleDatabaseError(res, err);
                res.json({ message: 'Sample data added successfully', count: sampleData.length });
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Error loading sample data: ' + error.message });
    }
});

// Clear all curriculum data
app.delete('/api/clear-curriculum', (req, res) => {
    dbService.clearAllData((err) => {
        if (err) return helpers.handleDatabaseError(res, err, 'Error clearing curriculum');
        res.json({ message: 'All curriculum data cleared successfully' });
    });
});

// Questions management endpoints
// Get a single topic with questions
app.get('/api/topics/:id', (req, res) => {
    const { id } = req.params;
    dbService.getTopicById(id, (err, topic) => {
        if (err) return helpers.handleDatabaseError(res, err);
        if (!topic) return res.status(404).json({ error: 'Topic not found' });
        res.json(topic);
    });
});

// Add question to topic
app.post('/api/topics/:id/questions', (req, res) => {
    const { id } = req.params;
    const { text } = req.body;
    
    if (!text || !text.trim()) {
        return res.status(400).json({ error: 'Question text is required' });
    }
    
    dbService.addQuestionToTopic(id, text.trim(), (err) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json({ message: 'Question added successfully' });
    });
});

// Remove question from topic
app.delete('/api/topics/:id/questions/:questionIndex', (req, res) => {
    const { id, questionIndex } = req.params;
    
    dbService.removeQuestionFromTopic(id, parseInt(questionIndex), (err) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json({ message: 'Question removed successfully' });
    });
});

// Toggle question status
app.put('/api/topics/:id/questions/:questionIndex/toggle', (req, res) => {
    const { id, questionIndex } = req.params;
    
    dbService.toggleQuestionStatus(id, parseInt(questionIndex), (err) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json({ message: 'Question status updated successfully' });
    });
});

app.listen(config.PORT, () => {
    console.log(`Learning Progress Tracker running on http://localhost:${config.PORT}`);
});
