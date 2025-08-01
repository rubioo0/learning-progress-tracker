const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Import custom modules
const config = require('./config/app-config');
const DatabaseService = require('./services/database');
const helpers = require('./utils/helpers');
const TimeTrackerService = require('./services/time-tracker');
const { errorHandler } = require('./utils/error-handler');

const app = express();
const dbService = new DatabaseService();
const timeTracker = new TimeTrackerService(dbService.db);

// Middleware
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());

// Add rate limiting middleware for time tracking endpoints
app.use('/api/learning-sessions', errorHandler.rateLimitMiddleware());

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
            // Always return JSON error
            return res.status(404).json({ error: 'No attachment found for this topic', canPreview: false });
        }
        
        const filePath = path.join(__dirname, row.attachment_path);
        
        if (!fs.existsSync(filePath)) {
            console.error(`File not found on disk: ${filePath}`);
            // Always return JSON error
            return res.status(404).json({ error: 'Attachment file not found on disk', canPreview: false });
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
            // Always return JSON error
            return res.status(404).json({ error: 'No attachment found for this topic' });
        }
        
        const filePath = path.join(__dirname, row.attachment_path);
        
        if (!fs.existsSync(filePath)) {
            // Always return JSON error
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

// Time tracking endpoints
app.post('/api/time-tracking/start', (req, res) => {
    const { topicId } = req.body;
    
    // Start a new learning session using the database
    dbService.startLearningSession((err, result) => {
        if (err) {
            console.error('Error starting learning session:', err);
            return helpers.handleDatabaseError(res, err);
        }
        
        console.log(`Learning session started: ${result.sessionId} for topic: ${topicId}`);
        
        res.json({ 
            message: 'Learning session started',
            sessionId: result.sessionId.toString(),
            startTime: result.startTime,
            topicId: topicId
        });
    });
});

app.post('/api/time-tracking/stop', (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }
    
    // Stop the learning session using the database
    dbService.stopLearningSession(parseInt(sessionId), (err, result) => {
        if (err) {
            console.error('Error stopping learning session:', err);
            return helpers.handleDatabaseError(res, err);
        }
        
        const durationMinutes = Math.floor(result.duration / 60);
        const durationSeconds = result.duration % 60;
        
        console.log(`Learning session stopped: ${sessionId}, duration: ${durationMinutes}m ${durationSeconds}s`);
        
        res.json({ 
            message: 'Learning session stopped',
            sessionId: sessionId,
            endTime: result.endTime,
            duration: result.duration, // Duration in seconds
            durationMinutes: durationMinutes,
            durationDisplay: `${durationMinutes} minutes ${durationSeconds} seconds`
        });
    });
});

app.get('/api/time-tracking/total', (req, res) => {
    // Get actual time tracking data from database
    dbService.getTotalLearningTime((err, stats) => {
        if (err) {
            console.error('Error getting total learning time:', err);
            return helpers.handleDatabaseError(res, err);
        }
        
        // Get today's session count
        const today = new Date().toISOString().split('T')[0];
        dbService.db.get(
            'SELECT COUNT(*) as sessionsToday FROM sessions WHERE DATE(start_time) = ? AND end_time IS NOT NULL',
            [today],
            (err, row) => {
                if (err) {
                    console.error('Error getting today\'s sessions:', err);
                    return helpers.handleDatabaseError(res, err);
                }
                
                res.json({
                    totalMinutes: Math.round(stats.totalMinutes),
                    totalHours: Math.round(stats.totalHours * 100) / 100,
                    sessionsToday: row.sessionsToday || 0,
                    lastSession: null // Can be enhanced to get actual last session
                });
            }
        );
    });
});

// Get time tracking calendar data
app.get('/api/time-tracking/calendar', async (req, res) => {
    try {
        const { userId = 'default_user', monthsBack = 6 } = req.query;
        
        if (!errorHandler.validateUserId(userId)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid user ID format',
                    errorHandler.errorCodes.INVALID_USER_ID,
                    400
                ),
                req, res
            );
        }

        const monthsBackNum = parseInt(monthsBack);
        if (isNaN(monthsBackNum) || monthsBackNum < 1 || monthsBackNum > 24) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'monthsBack must be a number between 1 and 24',
                    errorHandler.errorCodes.VALIDATION_ERROR,
                    400
                ),
                req, res
            );
        }

        const calendarData = await timeTracker.getCalendarData(userId, monthsBackNum);
        
        res.json({
            success: true,
            data: calendarData,
            userId: userId,
            monthsBack: monthsBackNum
        });

    } catch (error) {
        console.error('Error in time tracking calendar endpoint:', error);
        errorHandler.handleError(error, req, res);
    }
});

// Calendar endpoint
app.get('/api/calendar', (req, res) => {
    // Return array of learning data directly, which is what the frontend expects
    // Each item should have a date and session data
    const today = new Date().toISOString().split('T')[0];
    
    // For now, return empty array - can be expanded to include actual session data
    res.json([
        // Example structure that could be returned:
        // {
        //     date: '2025-08-01',
        //     sessions: 2,
        //     totalMinutes: 45,
        //     topics: ['Topic 1', 'Topic 2']
        // }
    ]);
});

// Clear today's time tracking data
app.post('/api/time-tracking/clear-today', async (req, res) => {
    try {
        const { userId = 'default_user' } = req.body;
        
        if (!errorHandler.validateUserId(userId)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid user ID format',
                    errorHandler.errorCodes.INVALID_USER_ID,
                    400
                ),
                req, res
            );
        }

        const today = new Date().toISOString().split('T')[0];
        
        // Clear today's sessions from time_tracking_sessions table
        const deleteQuery = `
            DELETE FROM time_tracking_sessions 
            WHERE user_id = ? 
            AND date(start_time) = ?
        `;

        dbService.db.run(deleteQuery, [userId, today], function(err) {
            if (err) {
                console.error('Error clearing today\'s time tracking data:', err);
                return errorHandler.handleError(err, req, res);
            }

            console.log(`Cleared ${this.changes} time tracking sessions for today (${today})`);
            
            res.json({
                success: true,
                message: 'Today\'s time tracking data cleared successfully',
                deletedSessions: this.changes,
                date: today,
                userId: userId
            });
        });

    } catch (error) {
        console.error('Error in clear today endpoint:', error);
        errorHandler.handleError(error, req, res);
    }
});

// Get today's time tracking total
app.get('/api/time-tracking/today', async (req, res) => {
    try {
        const { userId = 'default_user' } = req.query;
        
        if (!errorHandler.validateUserId(userId)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid user ID format',
                    errorHandler.errorCodes.INVALID_USER_ID,
                    400
                ),
                req, res
            );
        }

        const today = new Date().toISOString().split('T')[0];
        
        // Get today's sessions from time_tracking_sessions table
        const query = `
            SELECT 
                COUNT(*) as totalSessions,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completedSessions,
                COALESCE(SUM(CASE WHEN status = 'completed' AND duration_seconds IS NOT NULL THEN duration_seconds ELSE 0 END), 0) as totalSeconds
            FROM time_tracking_sessions
            WHERE user_id = ? 
            AND date(start_time) = ?
        `;

        dbService.db.get(query, [userId, today], (err, row) => {
            if (err) {
                console.error('Error getting today\'s time tracking total:', err);
                return errorHandler.handleError(err, req, res);
            }

            const totalMinutes = Math.round((row.totalSeconds || 0) / 60);
            const totalHours = Math.round((row.totalSeconds || 0) / 3600 * 100) / 100;
            
            res.json({
                success: true,
                totalSessions: row.totalSessions || 0,
                completedSessions: row.completedSessions || 0,
                totalSeconds: row.totalSeconds || 0,
                totalMinutes: totalMinutes,
                totalHours: totalHours,
                date: today,
                userId: userId
            });
        });

    } catch (error) {
        console.error('Error in today\'s total endpoint:', error);
        errorHandler.handleError(error, req, res);
    }
});

// Session status endpoint
app.get('/api/session/status', (req, res) => {
    // Check for active sessions in the database
    dbService.getCurrentActiveSession((err, session) => {
        if (err) {
            console.error('Error getting active session:', err);
            return helpers.handleDatabaseError(res, err);
        }
        
        if (session) {
            const currentTime = new Date();
            const startTime = new Date(session.start_time);
            const elapsedMs = currentTime.getTime() - startTime.getTime();
            const elapsedSeconds = Math.floor(elapsedMs / 1000);
            
            res.json({
                isActive: true,
                sessionId: session.id.toString(),
                startTime: session.start_time,
                currentTopic: session.topic_id,
                elapsedTime: elapsedSeconds
            });
        } else {
            res.json({
                isActive: false,
                sessionId: null,
                startTime: null,
                currentTopic: null,
                elapsedTime: 0
            });
        }
    });
});

// Session management endpoints
app.post('/api/session/start', (req, res) => {
    const { topicId } = req.body;
    
    // Use the same database method as time-tracking/start
    dbService.startLearningSession((err, result) => {
        if (err) {
            console.error('Error starting session:', err);
            return helpers.handleDatabaseError(res, err);
        }
        
        res.json({
            message: 'Session started successfully',
            sessionId: result.sessionId.toString(),
            topicId: topicId,
            startTime: result.startTime
        });
    });
});

app.post('/api/session/continue', (req, res) => {
    const { sessionId } = req.body;
    res.json({
        message: 'Session continued successfully',
        sessionId: sessionId,
        continueTime: new Date().toISOString()
    });
});

app.post('/api/session/end', (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }
    
    // Use the database method to stop the session
    dbService.stopLearningSession(parseInt(sessionId), (err, result) => {
        if (err) {
            console.error('Error ending session:', err);
            return helpers.handleDatabaseError(res, err);
        }
        
        res.json({
            message: 'Session ended successfully',
            sessionId: sessionId,
            endTime: result.endTime,
            duration: result.duration
        });
    });
});

// Cancel a session without recording time (for user-declined session recovery)
app.post('/api/session/cancel', (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }
    
    // Delete the session without recording any time
    dbService.db.run('DELETE FROM sessions WHERE id = ?', [parseInt(sessionId)], function(err) {
        if (err) {
            console.error('Error cancelling session:', err);
            return helpers.handleDatabaseError(res, err);
        }
        
        res.json({
            message: 'Session cancelled successfully',
            sessionId: sessionId,
            deleted: this.changes > 0
        });
    });
});

// Clear all sessions for today
app.post('/api/session/clear-today', (req, res) => {
    try {
        // Get today's date range
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
        
        let totalDeleted = 0;
        
        // Delete from old sessions table
        dbService.db.run(
            'DELETE FROM sessions WHERE start_time >= ? AND start_time < ?',
            [startOfDay, endOfDay],
            function(err) {
                if (err) {
                    console.error('Error clearing today\'s sessions:', err);
                    return helpers.handleDatabaseError(res, err);
                }
                
                totalDeleted += this.changes;
                
                // Also delete from new time_tracking_sessions table if it exists
                dbService.db.run(
                    'DELETE FROM time_tracking_sessions WHERE start_time >= ? AND start_time < ?',
                    [startOfDay, endOfDay],
                    function(err2) {
                        // Don't fail if table doesn't exist, just log
                        if (err2 && !err2.message.includes('no such table')) {
                            console.error('Error clearing time tracking sessions:', err2);
                        } else if (!err2) {
                            totalDeleted += this.changes;
                        }
                        
                        console.log(`Cleared ${totalDeleted} session(s) from today`);
                        res.json({
                            message: 'Today\'s learning data cleared successfully',
                            deletedSessions: totalDeleted,
                            date: today.toDateString()
                        });
                    }
                );
            }
        );
    } catch (error) {
        console.error('Error in clear-today endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/shutdown', (req, res) => {
    res.json({
        message: 'Shutdown request received',
        timestamp: new Date().toISOString()
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

// ===========================================
// TIME TRACKING API ENDPOINTS
// ===========================================

// Start a new learning session
app.post('/api/learning-sessions/start', async (req, res) => {
    try {
        const { userId = 'default_user', sessionData = {} } = req.body;

        // Validate input
        if (!errorHandler.validateUserId(userId)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid user ID format',
                    errorHandler.errorCodes.INVALID_USER_ID,
                    400
                ),
                req, res
            );
        }

        const result = await timeTracker.startLearningSession(userId, sessionData);
        
        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        errorHandler.handleError(error, req, res);
    }
});

// Stop an active learning session
app.post('/api/learning-sessions/stop', async (req, res) => {
    try {
        const { sessionId, userId = 'default_user' } = req.body;

        // Validate input
        if (!sessionId) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Session ID is required',
                    errorHandler.errorCodes.INVALID_INPUT,
                    400
                ),
                req, res
            );
        }

        if (!errorHandler.validateSessionId(sessionId)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid session ID format',
                    errorHandler.errorCodes.INVALID_SESSION_ID,
                    400
                ),
                req, res
            );
        }

        if (!errorHandler.validateUserId(userId)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid user ID format',
                    errorHandler.errorCodes.INVALID_USER_ID,
                    400
                ),
                req, res
            );
        }

        const result = await timeTracker.stopLearningSession(sessionId, userId);
        
        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        errorHandler.handleError(error, req, res);
    }
});

// Get current session status
app.get('/api/learning-sessions/status', async (req, res) => {
    try {
        const { userId = 'default_user' } = req.query;

        if (!errorHandler.validateUserId(userId)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid user ID format',
                    errorHandler.errorCodes.INVALID_USER_ID,
                    400
                ),
                req, res
            );
        }

        const activeSession = await timeTracker.getActiveSession(userId);
        
        res.json({
            success: true,
            data: activeSession,
            hasActiveSession: !!activeSession
        });

    } catch (error) {
        errorHandler.handleError(error, req, res);
    }
});

// Calculate learning time statistics
app.get('/api/learning-sessions/calculate', async (req, res) => {
    try {
        const { userId = 'default_user', dateRange = 'all' } = req.query;

        if (!errorHandler.validateUserId(userId)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid user ID format',
                    errorHandler.errorCodes.INVALID_USER_ID,
                    400
                ),
                req, res
            );
        }

        const validDateRanges = ['today', 'week', 'month', 'all'];
        if (!validDateRanges.includes(dateRange)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid date range. Must be one of: ' + validDateRanges.join(', '),
                    errorHandler.errorCodes.INVALID_INPUT,
                    400
                ),
                req, res
            );
        }

        const statistics = await timeTracker.calculateLearningTime(userId, dateRange);
        
        res.json({
            success: true,
            data: statistics
        });

    } catch (error) {
        errorHandler.handleError(error, req, res);
    }
});

// Get calendar data for learning sessions
app.get('/api/learning-sessions/calendar-data', async (req, res) => {
    try {
        const { userId = 'default_user', monthsBack = 6 } = req.query;

        if (!errorHandler.validateUserId(userId)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid user ID format',
                    errorHandler.errorCodes.INVALID_USER_ID,
                    400
                ),
                req, res
            );
        }

        const monthsBackNum = parseInt(monthsBack);
        if (isNaN(monthsBackNum) || monthsBackNum < 1 || monthsBackNum > 24) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'monthsBack must be a number between 1 and 24',
                    errorHandler.errorCodes.INVALID_INPUT,
                    400
                ),
                req, res
            );
        }

        const calendarData = await timeTracker.getCalendarData(userId, monthsBackNum);
        
        res.json({
            success: true,
            data: calendarData
        });

    } catch (error) {
        errorHandler.handleError(error, req, res);
    }
});

// Cancel an active session (for error recovery)
app.post('/api/learning-sessions/cancel', async (req, res) => {
    try {
        const { sessionId, reason = 'Manual cancellation' } = req.body;

        if (!sessionId) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Session ID is required',
                    errorHandler.errorCodes.INVALID_INPUT,
                    400
                ),
                req, res
            );
        }

        if (!errorHandler.validateSessionId(sessionId)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid session ID format',
                    errorHandler.errorCodes.INVALID_SESSION_ID,
                    400
                ),
                req, res
            );
        }

        const result = await timeTracker.cancelSession(sessionId, reason);
        
        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        errorHandler.handleError(error, req, res);
    }
});

// Get session statistics for a date range
app.get('/api/learning-sessions/statistics', async (req, res) => {
    try {
        const { userId = 'default_user', startDate, endDate } = req.query;

        if (!errorHandler.validateUserId(userId)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid user ID format',
                    errorHandler.errorCodes.INVALID_USER_ID,
                    400
                ),
                req, res
            );
        }

        if (startDate && !errorHandler.validateTimestamp(startDate)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid start date format. Use ISO 8601 format.',
                    errorHandler.errorCodes.INVALID_TIMESTAMP,
                    400
                ),
                req, res
            );
        }

        if (endDate && !errorHandler.validateTimestamp(endDate)) {
            return errorHandler.handleError(
                errorHandler.createError(
                    'Invalid end date format. Use ISO 8601 format.',
                    errorHandler.errorCodes.INVALID_TIMESTAMP,
                    400
                ),
                req, res
            );
        }

        const statistics = await timeTracker.getSessionStatistics(userId, startDate, endDate);
        
        res.json({
            success: true,
            data: statistics
        });

    } catch (error) {
        errorHandler.handleError(error, req, res);
    }
});

// Health check endpoint for time tracking service
app.get('/api/learning-sessions/health', (req, res) => {
    res.json({
        success: true,
        data: {
            service: 'time-tracker',
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: '1.0.0'
        }
    });
});

// Global error handler for time tracking endpoints
app.use('/api/learning-sessions', (error, req, res, next) => {
    errorHandler.handleError(error, req, res, next);
});

app.listen(config.PORT, () => {
    console.log(`Learning Progress Tracker running on http://localhost:${config.PORT}`);
});
