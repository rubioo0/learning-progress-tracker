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
const GeminiAIService = require('./services/gemini-ai');
const CodeValidatorService = require('./services/code-validator');

const app = express();
const dbService = new DatabaseService();
const timeTracker = new TimeTrackerService(dbService.db);
const geminiAI = new GeminiAIService();
const codeValidator = new CodeValidatorService(config.CODE_VALIDATION || {});

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

// Get all topics with pagination
app.get('/api/topics', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const category = req.query.category;
    const module = req.query.module;
    const status = req.query.status;
    
    dbService.getTopicsPaginated(page, limit, { category, module, status }, (err, result) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json(result);
    });
});

// Get all topic categories and modules for filtering
app.get('/api/topics/metadata', (req, res) => {
    dbService.getTopicsMetadata((err, metadata) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json(metadata);
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

// ========================================
// Gemini AI Content Generation Endpoints
// ========================================

// Get API key configuration status
app.get('/api/ai/status', (req, res) => {
    res.json(geminiAI.getApiKeyStatus());
});

// Set API key
app.post('/api/ai/api-key', (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
        return res.status(400).json({ error: 'Invalid API key format.' });
    }
    geminiAI.setApiKey(apiKey.trim());
    res.json({ message: 'API key saved successfully', status: geminiAI.getApiKeyStatus() });
});

// Set active AI model
app.post('/api/ai/model', (req, res) => {
    const { model } = req.body;

    if (!model || typeof model !== 'string') {
        return res.status(400).json({ error: 'Invalid model selection.' });
    }

    try {
        const status = geminiAI.setModel(model.trim());
        res.json({ message: 'AI model updated successfully', status });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Failed to update model.' });
    }
});

// Get generated content for a topic (check cache)
app.get('/api/topics/:id/generated-content', (req, res) => {
    const { id } = req.params;
    
    dbService.getGeneratedContent(id, (err, row) => {
        if (err) return helpers.handleDatabaseError(res, err);
        if (!row) return res.status(404).json({ error: 'Topic not found' });

        let generationMeta = null;
        if (row.generation_meta) {
            try {
                generationMeta = JSON.parse(row.generation_meta);
            } catch (parseError) {
                generationMeta = null;
            }
        }
        
        res.json({
            topicId: row.id,
            title: row.title,
            description: row.description,
            generatedContent: row.generated_content,
            generationStatus: row.generation_status,
            generatedAt: row.generated_at,
            model: row.generated_model,
            modelLabel: geminiAI.getModelLabel(row.generated_model),
            generationMeta,
            hasContent: !!row.generated_content && row.generation_status === 'completed'
        });
    });
});

function getAIErrorStatus(errorMessage) {
    const msg = String(errorMessage || '');
    if (msg.includes('Rate limited') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        return 429;
    }
    if (msg.includes('503') || msg.includes('overloaded') || msg.includes('UNAVAILABLE') || msg.includes('Service Unavailable')) {
        return 503;
    }
    if (msg.includes('Invalid API key') || msg.includes('Permission denied')) {
        return 401;
    }
    if (msg.includes('Unsupported model') || msg.includes('unavailable for this request')) {
        return 400;
    }
    return 500;
}

// Generate content for a topic using Gemini AI
app.post('/api/topics/:id/generate-content', async (req, res) => {
    const { id } = req.params;
    const { force } = req.body; // force=true to regenerate
    
    try {
        // Get topic data
        const topic = await new Promise((resolve, reject) => {
            dbService.getTopicById(id, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!topic) {
            return res.status(404).json({ error: 'Topic not found' });
        }
        
        // Check if already generated (unless force regeneration)
        if (!force && topic.generated_content && topic.generation_status === 'completed') {
            // Check if content exists in generated_content column
            const existing = await new Promise((resolve, reject) => {
                dbService.getGeneratedContent(id, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (existing && existing.generated_content && existing.generation_status === 'completed') {
                let generationMeta = null;
                if (existing.generation_meta) {
                    try {
                        generationMeta = JSON.parse(existing.generation_meta);
                    } catch (parseError) {
                        generationMeta = null;
                    }
                }

                return res.json({
                    topicId: id,
                    content: existing.generated_content,
                    cached: true,
                    model: existing.generated_model,
                    modelLabel: geminiAI.getModelLabel(existing.generated_model),
                    generationMeta,
                    generatedAt: existing.generated_at,
                    message: 'Content already generated. Use force=true to regenerate.'
                });
            }
        }
        
        // Generate content using Gemini AI
        console.log(`Generating AI content for topic ${id}: "${topic.title}"`);
        const result = await geminiAI.generateContent(topic);
        
        // Determine status
        const status = result.isTruncated ? 'truncated' : 'completed';
        
        // Save to database
        const generationMeta = {
            fallbackUsed: !!result.fallbackUsed,
            attempts: result.attempts || 1,
            attemptedModels: result.attemptedModels || [result.model],
            stopReason: result.stopReason || 'STOP',
            usage: result.usage || null
        };

        await new Promise((resolve, reject) => {
            dbService.saveGeneratedContent(id, result.content, status, result.model, generationMeta, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        console.log(`AI content generated for topic ${id}, status: ${status}, tokens: ${result.usage?.output_tokens || 'unknown'}`);
        
        res.json({
            topicId: id,
            content: result.content,
            cached: false,
            model: result.model,
            modelLabel: result.modelLabel,
            activeModel: result.activeModel,
            fallbackUsed: result.fallbackUsed,
            attempts: result.attempts,
            attemptedModels: result.attemptedModels,
            usage: result.usage,
            stopReason: result.stopReason,
            isTruncated: result.isTruncated,
            generatedAt: result.generatedAt,
            status
        });
    } catch (error) {
        console.error(`Error generating content for topic ${id}:`, error.message);
        
        // Save error status
        try {
            await new Promise((resolve, reject) => {
                dbService.saveGeneratedContent(id, null, 'error', null, null, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } catch (saveErr) {
            console.error('Error saving error status:', saveErr);
        }
        
        res.status(getAIErrorStatus(error.message)).json({ 
            error: error.message || 'Failed to generate content',
            topicId: id
        });
    }
});

// Clear generated content for a topic (allows regeneration)
app.delete('/api/topics/:id/generated-content', (req, res) => {
    const { id } = req.params;
    
    dbService.clearGeneratedContent(id, (err) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json({ message: 'Generated content cleared', topicId: id });
    });
});

// ============ Batch Generation ============

// Background batch generation state
const batchGenerationState = {
    isRunning: false,
    queue: [],
    completed: [],
    failed: [],
    current: null,
    total: 0
};

// Start batch generation for multiple topics
app.post('/api/ai/batch-generate', async (req, res) => {
    const { topicIds } = req.body;
    
    if (!topicIds || !Array.isArray(topicIds) || topicIds.length === 0) {
        return res.status(400).json({ error: 'Provide an array of topicIds' });
    }

    if (batchGenerationState.isRunning) {
        return res.status(409).json({ error: 'Batch generation already in progress', state: getBatchStatus() });
    }

    // Initialize batch state
    batchGenerationState.isRunning = true;
    batchGenerationState.queue = [...topicIds];
    batchGenerationState.completed = [];
    batchGenerationState.failed = [];
    batchGenerationState.current = null;
    batchGenerationState.total = topicIds.length;

    res.json({ message: 'Batch generation started', total: topicIds.length });

    // Process in background
    processBatchQueue();
});

// Get batch generation status
app.get('/api/ai/batch-status', (req, res) => {
    res.json(getBatchStatus());
});

// Cancel batch generation
app.post('/api/ai/batch-cancel', (req, res) => {
    if (batchGenerationState.isRunning) {
        batchGenerationState.queue = [];
        batchGenerationState.isRunning = false;
        res.json({ message: 'Batch generation cancelled', state: getBatchStatus() });
    } else {
        res.json({ message: 'No batch generation running' });
    }
});

function getBatchStatus() {
    return {
        isRunning: batchGenerationState.isRunning,
        current: batchGenerationState.current,
        total: batchGenerationState.total,
        completedCount: batchGenerationState.completed.length,
        failedCount: batchGenerationState.failed.length,
        remaining: batchGenerationState.queue.length,
        completed: batchGenerationState.completed,
        failed: batchGenerationState.failed
    };
}

async function processBatchQueue() {
    while (batchGenerationState.queue.length > 0 && batchGenerationState.isRunning) {
        const topicId = batchGenerationState.queue.shift();
        batchGenerationState.current = topicId;

        try {
            const topic = await new Promise((resolve, reject) => {
                dbService.getTopicById(topicId, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            if (!topic) {
                batchGenerationState.failed.push({ id: topicId, error: 'Topic not found' });
                continue;
            }

            // Skip if already generated
            if (topic.generated_content && topic.generation_status === 'completed') {
                batchGenerationState.completed.push({ id: topicId, title: topic.title, cached: true });
                continue;
            }

            console.log(`[Batch] Generating content for topic ${topicId}: "${topic.title}" (${batchGenerationState.completed.length + 1}/${batchGenerationState.total})`);
            
            const result = await geminiAI.generateContent(topic);
            const status = result.isTruncated ? 'truncated' : 'completed';
            const generationMeta = {
                fallbackUsed: !!result.fallbackUsed,
                attempts: result.attempts || 1,
                attemptedModels: result.attemptedModels || [result.model],
                stopReason: result.stopReason || 'STOP',
                usage: result.usage || null,
                batch: true
            };

            await new Promise((resolve, reject) => {
                dbService.saveGeneratedContent(topicId, result.content, status, result.model, generationMeta, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            batchGenerationState.completed.push({ id: topicId, title: topic.title, cached: false });

            // Rate limiting: wait 4 seconds between requests (free tier: 15 req/min)
            if (batchGenerationState.queue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 4000));
            }
        } catch (error) {
            console.error(`[Batch] Error generating content for topic ${topicId}:`, error.message);
            batchGenerationState.failed.push({ id: topicId, error: error.message });

            // If rate limited, wait longer
            if (error.message.includes('Rate limited') || error.message.includes('429')) {
                console.log('[Batch] Rate limited, waiting 60 seconds...');
                await new Promise(resolve => setTimeout(resolve, 60000));
            }
        }
    }

    batchGenerationState.isRunning = false;
    batchGenerationState.current = null;
    console.log(`[Batch] Generation complete. ${batchGenerationState.completed.length} completed, ${batchGenerationState.failed.length} failed.`);
}

// ============ Inline Learning Assistant ============

const explainRateState = new Map();
const explainCache = new Map();

function getExplainClientId(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.ip || req.connection?.remoteAddress || 'unknown';
}

function getExplainCacheKey(term, sourceTopicTitle, sourceContext) {
    return [
        String(term || '').trim().toLowerCase(),
        String(sourceTopicTitle || '').trim().toLowerCase(),
        String(sourceContext || '').trim().toLowerCase()
    ].join('||');
}

function cleanupExplainRuntimeState() {
    const now = Date.now();
    const limitConfig = config.AI_EXPLAIN_RATE_LIMIT || {};
    const windowMs = Number(limitConfig.windowMs) || 60000;
    const cooldownMs = Number(limitConfig.cooldownMs) || 15000;

    for (const [clientId, state] of explainRateState.entries()) {
        const recentRequests = (state.timestamps || []).filter((timestamp) => now - timestamp <= windowMs);
        const cooldownUntil = Number(state.cooldownUntil) || 0;
        const stale = recentRequests.length === 0 && cooldownUntil <= now;

        if (stale) {
            explainRateState.delete(clientId);
            continue;
        }

        explainRateState.set(clientId, {
            timestamps: recentRequests,
            cooldownUntil: cooldownUntil > now ? cooldownUntil : 0,
            touchedAt: state.touchedAt || now
        });
    }

    for (const [cacheKey, cacheEntry] of explainCache.entries()) {
        if (!cacheEntry || Number(cacheEntry.expiresAt) <= now) {
            explainCache.delete(cacheKey);
        }
    }
}

const explainStateCleanupTimer = setInterval(cleanupExplainRuntimeState, 60000);
if (typeof explainStateCleanupTimer.unref === 'function') {
    explainStateCleanupTimer.unref();
}

// Explain a term using AI
app.post('/api/ai/explain-term', async (req, res) => {
    const { term, sourceTopicTitle, sourceContext } = req.body;
    const limitConfig = config.AI_EXPLAIN_RATE_LIMIT || {};
    const windowMs = Number(limitConfig.windowMs) || 60000;
    const maxRequests = Number(limitConfig.maxRequests) || 10;
    const cooldownMs = Number(limitConfig.cooldownMs) || 15000;
    const cacheTtlMs = Number(limitConfig.cacheTtlMs) || 10 * 60 * 1000;
    const maxTermLength = Number(limitConfig.maxTermLength) || 350;
    
    if (!term || typeof term !== 'string' || term.trim().length === 0) {
        return res.status(400).json({ error: 'Provide a term to explain' });
    }

    if (term.trim().length > maxTermLength) {
        return res.status(400).json({ error: `Selected term is too long. Maximum supported length is ${maxTermLength} characters.` });
    }

    const now = Date.now();
    const clientId = getExplainClientId(req);
    const currentState = explainRateState.get(clientId) || { timestamps: [], cooldownUntil: 0, touchedAt: now };
    const recentRequests = currentState.timestamps.filter((timestamp) => now - timestamp <= windowMs);

    if (currentState.cooldownUntil && now < currentState.cooldownUntil) {
        const retryAfterSeconds = Math.max(1, Math.ceil((currentState.cooldownUntil - now) / 1000));
        return res.status(429).json({
            error: `Rate limited. Please wait ${retryAfterSeconds}s before requesting another explanation.`,
            retryAfterSeconds
        });
    }

    if (recentRequests.length >= maxRequests) {
        const cooldownUntil = now + cooldownMs;
        explainRateState.set(clientId, {
            timestamps: recentRequests,
            cooldownUntil,
            touchedAt: now
        });

        const retryAfterSeconds = Math.max(1, Math.ceil(cooldownMs / 1000));
        return res.status(429).json({
            error: `Rate limited. You reached ${maxRequests} explain requests in the last minute.`,
            retryAfterSeconds
        });
    }

    recentRequests.push(now);
    explainRateState.set(clientId, {
        timestamps: recentRequests,
        cooldownUntil: 0,
        touchedAt: now
    });

    const cacheKey = getExplainCacheKey(term, sourceTopicTitle, sourceContext);
    const cached = explainCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return res.json({
            ...cached.payload,
            cached: true
        });
    }

    try {
        const result = await geminiAI.explainTerm(term.trim(), sourceTopicTitle, sourceContext);
        const payload = {
            ...result,
            modelLabel: geminiAI.getModelLabel(result.model),
            cached: false
        };

        explainCache.set(cacheKey, {
            payload,
            expiresAt: now + cacheTtlMs
        });

        res.json(payload);
    } catch (error) {
        console.error('Error explaining term:', error.message);

        const statusCode = getAIErrorStatus(error.message);
        if (statusCode === 429) {
            const cooldownUntil = Date.now() + cooldownMs;
            explainRateState.set(clientId, {
                timestamps: recentRequests,
                cooldownUntil,
                touchedAt: Date.now()
            });

            const retryAfterSeconds = Math.max(1, Math.ceil(cooldownMs / 1000));
            return res.status(429).json({
                error: error.message || 'Rate limited. Please wait and try again.',
                retryAfterSeconds
            });
        }

        res.status(statusCode).json({ error: error.message || 'Failed to explain term' });
    }
});

// Validate code snippets for fullscreen edit mode (Python/C#)
app.post('/api/code/validate', async (req, res) => {
    const { language, code, editMode } = req.body || {};

    if (editMode !== true) {
        return res.status(400).json({
            error: 'Validation is available only in fullscreen Edit mode.'
        });
    }

    if (typeof code !== 'string' || code.trim().length === 0) {
        return res.status(400).json({ error: 'Code is required for validation.' });
    }

    try {
        const result = await codeValidator.validate(language, code);
        res.json(result);
    } catch (error) {
        console.error('Error validating code block:', error.message);
        res.status(500).json({ error: error.message || 'Failed to validate code snippet.' });
    }
});

// Save a learning note
app.post('/api/learning-notes', (req, res) => {
    const { term, explanation, sourceTopicId, sourceTopicTitle, sourceContext, modelUsed } = req.body;
    
    if (!term || !explanation) {
        return res.status(400).json({ error: 'Term and explanation are required' });
    }

    dbService.saveLearningNote({ term, explanation, sourceTopicId, sourceTopicTitle, sourceContext, modelUsed }, (err, result) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json({ message: 'Learning note saved', id: result.id });
    });
});

// Get all learning notes
app.get('/api/learning-notes', (req, res) => {
    dbService.getLearningNotes((err, rows) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json(rows || []);
    });
});

// Get notes for review
app.get('/api/learning-notes/review', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    dbService.getLearningNotesForReview(limit, (err, rows) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json(rows || []);
    });
});

// Get learning notes stats
app.get('/api/learning-notes/stats', (req, res) => {
    dbService.getLearningNotesStats((err, stats) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json(stats || { total: 0, mastered: 0, pending: 0, avgReviews: 0 });
    });
});

// Mark note as reviewed
app.post('/api/learning-notes/:id/review', (req, res) => {
    dbService.reviewLearningNote(req.params.id, (err) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json({ message: 'Note marked as reviewed' });
    });
});

// Toggle mastered status
app.post('/api/learning-notes/:id/toggle-mastered', (req, res) => {
    dbService.toggleLearningNoteMastered(req.params.id, (err) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json({ message: 'Mastered status toggled' });
    });
});

// Delete a learning note
app.delete('/api/learning-notes/:id', (req, res) => {
    dbService.deleteLearningNote(req.params.id, (err) => {
        if (err) return helpers.handleDatabaseError(res, err);
        res.json({ message: 'Learning note deleted' });
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

// ========================================
// Data Export Endpoints
// ========================================

/**
 * Export all topics with their current status and completeness
 * GET /api/export/topics
 */
app.get('/api/export/topics', (req, res) => {
    dbService.getAllTopics((err, topics) => {
        if (err) return helpers.handleDatabaseError(res, err);
        
        const exportData = {
            exportedAt: new Date().toISOString(),
            totalCount: topics ? topics.length : 0,
            topics: topics || [],
            completenessStats: calculateCompleteness(topics || [])
        };
        
        // Set download headers
        res.setHeader('Content-Disposition', 'attachment; filename="topics-export-' + new Date().toISOString().split('T')[0] + '.json"');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(exportData);
    });
});

/**
 * Export current progress and statistics
 * GET /api/export/progress
 */
app.get('/api/export/progress', (req, res) => {
    Promise.all([
        new Promise((resolve, reject) => {
            dbService.getProgress((err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        }),
        new Promise((resolve, reject) => {
            dbService.getAchievements((err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        }),
        new Promise((resolve, reject) => {
            dbService.getLearningNotesStats((err, stats) => {
                if (err) reject(err);
                else resolve(stats);
            });
        }),
        new Promise((resolve, reject) => {
            dbService.getTotalLearningTime((err, stats) => {
                if (err) reject(err);
                else resolve(stats);
            });
        })
    ]).then(([progress, achievements, notesStats, timeStats]) => {
        const exportData = {
            exportedAt: new Date().toISOString(),
            progress: progress ? helpers.calculateProgress(progress) : {},
            achievements: achievements || [],
            learningNotesStats: notesStats || {},
            timeTrackingStats: timeStats || {},
            completionPercentage: progress ? Math.round((progress.completed_topics / (progress.total_topics || 1)) * 100) : 0
        };
        
        res.setHeader('Content-Disposition', 'attachment; filename="progress-export-' + new Date().toISOString().split('T')[0] + '.json"');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(exportData);
    }).catch(err => helpers.handleDatabaseError(res, err));
});

/**
 * Export learning notes (flashcards/terms)
 * GET /api/export/learning-notes
 */
app.get('/api/export/learning-notes', (req, res) => {
    dbService.getLearningNotes((err, notes) => {
        if (err) return helpers.handleDatabaseError(res,err);
        
        const exportData = {
            exportedAt: new Date().toISOString(),
            totalCount: notes ? notes.length : 0,
            notes: notes || []
        };
        
        res.setHeader('Content-Disposition', 'attachment; filename="learning-notes-export-' + new Date().toISOString().split('T')[0] + '.json"');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(exportData);
    });
});

/**
 * Export complete backup with ALL data
 * GET /api/export/complete
 */
app.get('/api/export/complete', (req, res) => {
    Promise.all([
        new Promise((resolve, reject) => {
            dbService.getAllTopics((err, topics) => {
                if (err) reject(err);
                else resolve(topics);
            });
        }),
        new Promise((resolve, reject) => {
            dbService.getProgress((err, progress) => {
                if (err) reject(err);
                else resolve(progress);
            });
        }),
        new Promise((resolve, reject) => {
            dbService.getAchievements((err, achievements) => {
                if (err) reject(err);
                else resolve(achievements);
            });
        }),
        new Promise((resolve, reject) => {
            dbService.getLearningNotes((err, notes) => {
                if (err) reject(err);
                else resolve(notes);
            });
        }),
        new Promise((resolve, reject) => {
            dbService.getTotalLearningTime((err, stats) => {
                if (err) reject(err);
                else resolve(stats);
            });
        }),
        new Promise((resolve, reject) => {
            dbService.getLearningNotesStats((err, stats) => {
                if (err) reject(err);
                else resolve(stats);
            });
        })
    ]).then(([topics, progress, achievements, notes, timeStats, notesStats]) => {
        const completeness = calculateCompleteness(topics || []);
        
        const exportData = {
            exportVersion: '1.0',
            exportedAt: new Date().toISOString(),
            
            // Topics Section
            topics: {
                count: topics ? topics.length : 0,
                data: topics || [],
                completeness: completeness
            },
            
            // Progress Section
            progress: progress ? helpers.calculateProgress(progress) : {},
            progressPercentage: progress ? Math.round((progress.completed_topics / (progress.total_topics || 1)) * 100) : 0,
            
            // Achievements Section
            achievements: {
                count: achievements ? achievements.length : 0,
                data: achievements || []
            },
            
            // Learning Notes Section
            learningNotes: {
                count: notes ? notes.length : 0,
                data: notes || [],
                stats: notesStats || {}
            },
            
            // Time Tracking Section
            timeTracking: {
                totalMinutes: timeStats ? Math.round(timeStats.totalMinutes) : 0,
                totalHours: timeStats ? Math.round(timeStats.totalHours * 100) / 100 : 0,
                stats: timeStats || {}
            },
            
            // Summary
            summary: {
                totalTopics: topics ? topics.length : 0,
                completedTopics: progress ? progress.completed_topics : 0,
                inProgressTopics: progress ? progress.in_progress_topics : 0,
                notStartedTopics: progress ? progress.total_topics - progress.completed_topics - progress.in_progress_topics : 0,
                totalPoints: progress ? progress.points : 0,
                level: progress ? Math.floor((progress.points || 0) / 100) + 1 : 1,
                totalLearningHours: timeStats ? Math.round(timeStats.totalHours * 100) / 100 : 0
            }
        };
        
        res.setHeader('Content-Disposition', 'attachment; filename="complete-backup-' + new Date().toISOString().replace(/:/g, '-').split('.')[0] + '.json"');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(exportData);
    }).catch(err => helpers.handleDatabaseError(res, err));
});

/**
 * Helper function to calculate topic completeness statistics
 */
function calculateCompleteness(topics) {
    const stats = {
        completed: 0,
        inProgress: 0,
        notStarted: 0,
        byCategory: {},
        byModule: {}
    };
    
    topics.forEach(topic => {
        // Overall stats
        if (topic.status === 'completed') stats.completed++;
        else if (topic.status === 'in-progress') stats.inProgress++;
        else stats.notStarted++;
        
        // By category
        if (topic.category) {
            if (!stats.byCategory[topic.category]) {
                stats.byCategory[topic.category] = { completed: 0, inProgress: 0, notStarted: 0, total: 0 };
            }
            stats.byCategory[topic.category].total++;
            if (topic.status === 'completed') stats.byCategory[topic.category].completed++;
            else if (topic.status === 'in-progress') stats.byCategory[topic.category].inProgress++;
            else stats.byCategory[topic.category].notStarted++;
        }
        
        // By module
        if (topic.module) {
            if (!stats.byModule[topic.module]) {
                stats.byModule[topic.module] = { completed: 0, inProgress: 0, notStarted: 0, total: 0 };
            }
            stats.byModule[topic.module].total++;
            if (topic.status === 'completed') stats.byModule[topic.module].completed++;
            else if (topic.status === 'in-progress') stats.byModule[topic.module].inProgress++;
            else stats.byModule[topic.module].notStarted++;
        }
    });
    
    stats.total = topics.length;
    stats.completionPercentage = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
    
    return stats;
}

app.listen(config.PORT, () => {
    console.log(`Learning Progress Tracker running on http://localhost:${config.PORT}`);
});
