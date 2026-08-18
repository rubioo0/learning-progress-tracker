const sqlite3 = require('sqlite3').verbose();
const config = require('../config/app-config');

class DatabaseService {
    constructor() {
        this.db = new sqlite3.Database(config.DATABASE_PATH);
        this.initializeTables();
    }

    initializeTables() {
        this.db.serialize(() => {
            this.db.run(`CREATE TABLE IF NOT EXISTS topics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                category TEXT,
                module TEXT,
                status TEXT DEFAULT 'not-started',
                notes TEXT,
                questions TEXT, -- JSON field for storing questions
                attachment_filename TEXT,
                attachment_original_name TEXT,
                attachment_path TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                order_index INTEGER
            )`);

            // Add questions column if it doesn't exist (for existing databases)
            this.db.run(`ALTER TABLE topics ADD COLUMN questions TEXT`, (err) => {
                // Ignore error if column already exists
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Error adding questions column:', err);
                }
            });

            // Add generated_content column for AI-generated educational content
            this.db.run(`ALTER TABLE topics ADD COLUMN generated_content TEXT`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Error adding generated_content column:', err);
                }
            });

            // Add generation_status column: null = not generated, 'completed' = done, 'error' = failed, 'truncated' = cropped
            this.db.run(`ALTER TABLE topics ADD COLUMN generation_status TEXT`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Error adding generation_status column:', err);
                }
            });

            // Add generated_at timestamp
            this.db.run(`ALTER TABLE topics ADD COLUMN generated_at TEXT`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Error adding generated_at column:', err);
                }
            });

            // Add generated model metadata
            this.db.run(`ALTER TABLE topics ADD COLUMN generated_model TEXT`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Error adding generated_model column:', err);
                }
            });

            // Add generation metadata payload (JSON string)
            this.db.run(`ALTER TABLE topics ADD COLUMN generation_meta TEXT`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Error adding generation_meta column:', err);
                }
            });

            // Learning notes table for inline learning assistant
            this.db.run(`CREATE TABLE IF NOT EXISTS learning_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                term TEXT NOT NULL,
                explanation TEXT NOT NULL,
                source_topic_id INTEGER,
                source_topic_title TEXT,
                source_context TEXT,
                model_used TEXT,
                review_count INTEGER DEFAULT 0,
                last_reviewed TEXT,
                mastered INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )`);

            this.db.run(`ALTER TABLE learning_notes ADD COLUMN model_used TEXT`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Error adding learning_notes.model_used column:', err);
                }
            });

            this.db.run(`CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_time DATETIME NOT NULL,
                end_time DATETIME,
                duration INTEGER,
                elapsed_minutes INTEGER,
                topic_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                total_topics INTEGER,
                completed_topics INTEGER,
                in_progress_topics INTEGER,
                points INTEGER DEFAULT 0,
                level INTEGER DEFAULT 1,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS achievements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                type TEXT
            )`);
        });
    }

    // Insert a new session (start_time, end_time, duration in seconds)
    insertSession(startTime, endTime, duration, callback) {
        this.db.run(
            'INSERT INTO sessions (start_time, end_time, duration) VALUES (?, ?, ?)',
            [startTime, endTime, duration],
            callback
        );
    }

    // Start a new learning session
    startLearningSession(callback) {
        const startTime = new Date().toISOString();
        this.db.run(
            'INSERT INTO sessions (start_time) VALUES (?)',
            [startTime],
            function(err) {
                if (err) return callback(err);
                callback(null, { sessionId: this.lastID, startTime });
            }
        );
    }

    // Stop a learning session
    stopLearningSession(sessionId, callback) {
        const endTime = new Date().toISOString();
        
        this.db.get('SELECT start_time FROM sessions WHERE id = ?', [sessionId], (err, row) => {
            if (err) return callback(err);
            if (!row) return callback(new Error('Session not found'));
            
            const startTime = new Date(row.start_time);
            const endTimeDate = new Date(endTime);
            const elapsedSeconds = Math.floor((endTimeDate - startTime) / 1000); // duration in seconds
            const elapsedMinutes = Math.floor(elapsedSeconds / 60); // duration in minutes for storage
            
            this.db.run(
                'UPDATE sessions SET end_time = ?, elapsed_minutes = ? WHERE id = ?',
                [endTime, elapsedMinutes, sessionId],
                function(err) {
                    if (err) return callback(err);
                    callback(null, { sessionId, endTime, duration: elapsedSeconds }); // return duration in seconds
                }
            );
        });
    }

    // Get active sessions (sessions without end_time)
    getActiveSessions(callback) {
        this.db.all('SELECT * FROM sessions WHERE end_time IS NULL ORDER BY start_time DESC', callback);
    }

    // Get the most recent active session
    getCurrentActiveSession(callback) {
        this.db.get('SELECT * FROM sessions WHERE end_time IS NULL ORDER BY start_time DESC LIMIT 1', callback);
    }

    // Get total learning time statistics
    getTotalLearningTime(callback) {
        this.db.get(`
            SELECT 
                COUNT(*) as totalSessions,
                SUM(CASE WHEN status = 'completed' AND duration_seconds IS NOT NULL THEN duration_seconds ELSE 0 END) as totalSeconds,
                SUM(CASE WHEN status = 'completed' AND duration_seconds IS NOT NULL THEN ROUND(duration_seconds / 60.0, 2) ELSE 0 END) as totalMinutes,
                SUM(CASE WHEN status = 'completed' AND duration_seconds IS NOT NULL THEN duration_seconds / 3600.0 ELSE 0 END) as totalHours
            FROM time_tracking_sessions
            WHERE status = 'completed'
        `, (err, row) => {
            if (err) return callback(err);
            callback(null, {
                totalSessions: row.totalSessions || 0,
                totalSeconds: row.totalSeconds || 0,
                totalMinutes: Math.round((row.totalMinutes || 0) * 100) / 100,
                totalHours: Math.round((row.totalHours || 0) * 100) / 100
            });
        });
    }

    // Get calendar data for time tracking
    getLearningCalendarData(callback) {
        this.db.all(`
            SELECT 
                date(start_time) as date,
                COUNT(*) as sessions,
                SUM(CASE WHEN elapsed_minutes IS NOT NULL THEN elapsed_minutes * 60 ELSE 0 END) as totalSeconds
            FROM sessions 
            WHERE start_time IS NOT NULL
            GROUP BY date(start_time)
            ORDER BY date DESC
        `, (err, rows) => {
            if (err) return callback(err);
            
            const calendarData = {};
            rows.forEach(row => {
                calendarData[row.date] = {
                    sessions: row.sessions,
                    totalSeconds: row.totalSeconds,
                    totalMinutes: Math.round(row.totalSeconds / 60),
                    hasActivity: row.totalSeconds > 0
                };
            });
            
            callback(null, calendarData);
        });
    }

    updateProgress() {
        const query = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as in_progress
            FROM topics
        `;
        
        this.db.get(query, (err, row) => {
            if (err) return;
            
            const points = row.completed * config.POINTS_PER_COMPLETION;
            const level = Math.floor(points / config.POINTS_PER_LEVEL) + 1;
            
            this.db.run(`
                INSERT OR REPLACE INTO progress (id, total_topics, completed_topics, in_progress_topics, points, level)
                VALUES (1, ?, ?, ?, ?, ?)
            `, [row.total, row.completed, row.in_progress, points, level]);
        });
    }

    checkAchievements() {
        this.db.get('SELECT COUNT(*) as completed FROM topics WHERE status = "completed"', (err, row) => {
            if (err) return;
            
            config.ACHIEVEMENT_MILESTONES.forEach(milestone => {
                if (row.completed === milestone.count) {
                    this.db.run(`
                        INSERT INTO achievements (title, description, type)
                        VALUES (?, ?, 'milestone')
                    `, [milestone.title, milestone.description]);
                }
            });
        });
    }

    getAllTopics(callback) {
        this.db.all('SELECT * FROM topics ORDER BY order_index, id', (err, rows) => {
            if (err) return callback(err);
            
            // Parse questions for each topic
            const topics = rows.map(row => {
                if (row.questions) {
                    try {
                        row.questions = JSON.parse(row.questions);
                    } catch (e) {
                        row.questions = [];
                    }
                } else {
                    row.questions = [];
                }
                return row;
            });
            
            callback(null, topics);
        });
    }

    getTopicsPaginated(page, limit, filters, callback) {
        const offset = (page - 1) * limit;
        let whereConditions = [];
        let params = [];

        if (filters.category) {
            // Support both exact match and LIKE for subcategories
            if (filters.category.includes('%')) {
                whereConditions.push('category LIKE ?');
                params.push(filters.category);
            } else {
                whereConditions.push('category LIKE ?');
                params.push(filters.category + '%');
            }
        }
        if (filters.module) {
            whereConditions.push('module LIKE ?');
            params.push('%' + filters.module + '%');
        }
        if (filters.status) {
            whereConditions.push('status = ?');
            params.push(filters.status);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // Get total count
        this.db.get(`SELECT COUNT(*) as total FROM topics ${whereClause}`, params, (err, countRow) => {
            if (err) return callback(err);

            const total = countRow.total;
            const totalPages = Math.ceil(total / limit);

            // Get paginated results
            this.db.all(
                `SELECT * FROM topics ${whereClause} ORDER BY order_index, id LIMIT ? OFFSET ?`,
                [...params, limit, offset],
                (err, rows) => {
                    if (err) return callback(err);

                    // Parse questions for each topic
                    const topics = rows.map(row => {
                        if (row.questions) {
                            try {
                                row.questions = JSON.parse(row.questions);
                            } catch (e) {
                                row.questions = [];
                            }
                        } else {
                            row.questions = [];
                        }
                        return row;
                    });

                    callback(null, {
                        topics,
                        pagination: {
                            page,
                            limit,
                            total,
                            totalPages,
                            hasMore: page < totalPages
                        }
                    });
                }
            );
        });
    }

    getTopicsMetadata(callback) {
        this.db.all(`
            SELECT DISTINCT category
            FROM topics
            ORDER BY category
        `, (err, rows) => {
            if (err) return callback(err);

            // Group categories into main groups. "Test Automation" gets a nested
            // language breakdown (parsed from "Test Automation - <language> - <type>");
            // every other category (including new ones like "Books") becomes its own
            // top-level group automatically, so adding a category doesn't require code changes.
            const mainCategories = {};

            rows.forEach(row => {
                const cat = row.category;
                if (!cat) return;
                if (cat.startsWith('Test Automation')) {
                    if (!mainCategories['Test Automation']) mainCategories['Test Automation'] = {};
                    // Parse: "Test Automation - language - type"
                    const parts = cat.split(' - ');
                    if (parts.length >= 2) {
                        const language = parts[1];
                        if (!mainCategories['Test Automation'][language]) {
                            mainCategories['Test Automation'][language] = [];
                        }
                        mainCategories['Test Automation'][language].push(cat);
                    }
                } else {
                    if (!mainCategories[cat]) mainCategories[cat] = [];
                    mainCategories[cat].push(cat);
                }
            });

            // Get counts for main groups
            this.db.all(`
                SELECT
                    CASE
                        WHEN category LIKE 'Test Automation%' THEN 'Test Automation'
                        ELSE category
                    END as main_category,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
                FROM topics
                GROUP BY main_category
            `, (err, counts) => {
                if (err) return callback(err);

                const stats = {};
                counts.forEach(row => {
                    stats[row.main_category] = {
                        total: row.total,
                        completed: row.completed
                    };
                });

                // Get counts per language for Test Automation
                this.db.all(`
                    SELECT 
                        category,
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
                    FROM topics
                    WHERE category LIKE 'Test Automation%'
                    GROUP BY category
                `, (err, langCounts) => {
                    if (err) return callback(err);

                    const languageStats = {};
                    langCounts.forEach(row => {
                        const parts = row.category.split(' - ');
                        if (parts.length >= 2) {
                            const lang = parts[1];
                            if (!languageStats[lang]) {
                                languageStats[lang] = { total: 0, completed: 0 };
                            }
                            languageStats[lang].total += row.total;
                            languageStats[lang].completed += row.completed;
                        }
                    });

                    callback(null, { 
                        mainCategories, 
                        stats, 
                        languageStats 
                    });
                });
            });
        });
    }

    updateTopic(id, status, notes, callback) {
        this.db.run(
            'UPDATE topics SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [status, notes, id],
            (err) => {
                if (err) return callback(err);
                this.updateProgress();
                this.checkAchievements();
                callback(null);
            }
        );
    }

    getProgress(callback) {
        const query = `
            SELECT 
                COUNT(*) as total_topics,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_topics,
                SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as in_progress_topics,
                SUM(CASE WHEN status = 'not-started' THEN 1 ELSE 0 END) as not_started_topics
            FROM topics
        `;
        
        this.db.get(query, callback);
    }

    getAchievements(callback) {
        this.db.all('SELECT * FROM achievements ORDER BY earned_at DESC', callback);
    }

    updateTopicAttachment(id, filename, originalName, attachmentPath, callback) {
        this.db.run(
            'UPDATE topics SET attachment_filename = ?, attachment_original_name = ?, attachment_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [filename, originalName, attachmentPath, id],
            callback
        );
    }

    getTopicAttachment(id, callback) {
        this.db.get('SELECT attachment_path, attachment_original_name FROM topics WHERE id = ?', [id], callback);
    }

    removeTopicAttachment(id, callback) {
        this.db.run(
            'UPDATE topics SET attachment_filename = NULL, attachment_original_name = NULL, attachment_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [id],
            callback
        );
    }

    clearTopics(callback) {
        this.db.run('DELETE FROM topics', callback);
    }

    insertTopic(title, description, category, module, orderIndex, callback) {
        this.db.run(
            'INSERT INTO topics (title, description, category, module, order_index) VALUES (?, ?, ?, ?, ?)',
            [title, description, category, module, orderIndex],
            callback
        );
    }

    bulkInsertTopics(topics, callback) {
        const stmt = this.db.prepare(`
            INSERT INTO topics (title, description, category, module, order_index)
            VALUES (?, ?, ?, ?, ?)
        `);

        topics.forEach(topic => {
            stmt.run([topic.title, topic.description, topic.category, topic.module, topic.order_index]);
        });

        stmt.finalize(callback);
    }

    // Like bulkInsertTopics, but also carries status/notes/questions — used by the
    // generic book-pack importer (see /api/books/:id/import) so seeded content can
    // ship with a pre-filled self-check checklist and study notes per topic.
    bulkInsertTopicsFull(topics, callback) {
        const stmt = this.db.prepare(`
            INSERT INTO topics (title, description, category, module, status, notes, questions, order_index)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        topics.forEach((topic, index) => {
            stmt.run([
                topic.title,
                topic.description || '',
                topic.category || '',
                topic.module || '',
                topic.status || 'not-started',
                topic.notes || '',
                topic.questions ? JSON.stringify(topic.questions) : null,
                topic.order_index || index + 1
            ]);
        });

        stmt.finalize(callback);
    }

    // Used to make book-pack imports idempotent: pass candidate titles, get back
    // which ones already exist so the caller can skip re-inserting them.
    getExistingTopicTitles(titles, callback) {
        if (!titles || titles.length === 0) return callback(null, []);
        const placeholders = titles.map(() => '?').join(',');
        this.db.all(`SELECT title FROM topics WHERE title IN (${placeholders})`, titles, callback);
    }

    // Get a single topic by ID with questions
    getTopicById(id, callback) {
        this.db.get('SELECT * FROM topics WHERE id = ?', [id], (err, row) => {
            if (err) return callback(err);
            if (!row) return callback(null, null);
            
            // Parse questions if they exist
            if (row.questions) {
                try {
                    row.questions = JSON.parse(row.questions);
                } catch (e) {
                    row.questions = [];
                }
            } else {
                row.questions = [];
            }
            
            callback(null, row);
        });
    }

    // Add question to topic
    addQuestionToTopic(topicId, questionText, callback) {
        this.getTopicById(topicId, (err, topic) => {
            if (err) return callback(err);
            if (!topic) return callback(new Error('Topic not found'));
            
            const questions = topic.questions || [];
            questions.push({
                text: questionText,
                answered: false,
                createdAt: new Date().toISOString()
            });
            
            this.db.run(
                'UPDATE topics SET questions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [JSON.stringify(questions), topicId],
                callback
            );
        });
    }

    // Remove question from topic
    removeQuestionFromTopic(topicId, questionIndex, callback) {
        this.getTopicById(topicId, (err, topic) => {
            if (err) return callback(err);
            if (!topic) return callback(new Error('Topic not found'));
            
            const questions = topic.questions || [];
            if (questionIndex < 0 || questionIndex >= questions.length) {
                return callback(new Error('Invalid question index'));
            }
            
            questions.splice(questionIndex, 1);
            
            this.db.run(
                'UPDATE topics SET questions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [JSON.stringify(questions), topicId],
                callback
            );
        });
    }

    // Toggle question answered status
    toggleQuestionStatus(topicId, questionIndex, callback) {
        this.getTopicById(topicId, (err, topic) => {
            if (err) return callback(err);
            if (!topic) return callback(new Error('Topic not found'));
            
            const questions = topic.questions || [];
            if (questionIndex < 0 || questionIndex >= questions.length) {
                return callback(new Error('Invalid question index'));
            }
            
            questions[questionIndex].answered = !questions[questionIndex].answered;
            
            this.db.run(
                'UPDATE topics SET questions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [JSON.stringify(questions), topicId],
                callback
            );
        });
    }

    // Save AI-generated content for a topic
    saveGeneratedContent(topicId, content, status, modelUsed, generationMeta, callback) {
        if (typeof modelUsed === 'function') {
            callback = modelUsed;
            modelUsed = null;
            generationMeta = null;
        } else if (typeof generationMeta === 'function') {
            callback = generationMeta;
            generationMeta = null;
        }

        const serializedMeta = generationMeta ? JSON.stringify(generationMeta) : null;
        this.db.run(
            'UPDATE topics SET generated_content = ?, generation_status = ?, generated_model = ?, generation_meta = ?, generated_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [content, status, modelUsed || null, serializedMeta, new Date().toISOString(), topicId],
            callback
        );
    }

    // Get generated content for a topic
    getGeneratedContent(topicId, callback) {
        this.db.get(
            'SELECT id, title, description, generated_content, generation_status, generated_at, generated_model, generation_meta FROM topics WHERE id = ?',
            [topicId],
            callback
        );
    }

    // Clear generated content for a topic (allows regeneration)
    clearGeneratedContent(topicId, callback) {
        this.db.run(
            'UPDATE topics SET generated_content = NULL, generation_status = NULL, generated_model = NULL, generation_meta = NULL, generated_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [topicId],
            callback
        );
    }

    // ============ Learning Notes (Inline Learning Assistant) ============

    // Save a learning note (explained term)
    saveLearningNote(data, callback) {
        this.db.run(
            `INSERT INTO learning_notes (term, explanation, source_topic_id, source_topic_title, source_context, model_used)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [data.term, data.explanation, data.sourceTopicId || null, data.sourceTopicTitle || null, data.sourceContext || null, data.modelUsed || null],
            function(err) {
                if (err) return callback(err);
                callback(null, { id: this.lastID });
            }
        );
    }

    // Get all learning notes (for review)
    getLearningNotes(callback) {
        this.db.all(
            `SELECT * FROM learning_notes ORDER BY 
                CASE WHEN mastered = 0 THEN 0 ELSE 1 END,
                review_count ASC, 
                created_at DESC`,
            callback
        );
    }

    // Get learning notes due for review (not mastered, sorted by least reviewed)
    getLearningNotesForReview(limit, callback) {
        this.db.all(
            `SELECT * FROM learning_notes WHERE mastered = 0 
             ORDER BY review_count ASC, last_reviewed ASC NULLS FIRST
             LIMIT ?`,
            [limit || 10],
            callback
        );
    }

    // Mark a learning note as reviewed
    reviewLearningNote(noteId, callback) {
        this.db.run(
            `UPDATE learning_notes SET review_count = review_count + 1, last_reviewed = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
            [noteId],
            callback
        );
    }

    // Toggle mastered status for a learning note
    toggleLearningNoteMastered(noteId, callback) {
        this.db.run(
            `UPDATE learning_notes SET mastered = CASE WHEN mastered = 0 THEN 1 ELSE 0 END, updated_at = datetime('now') WHERE id = ?`,
            [noteId],
            callback
        );
    }

    // Delete a learning note
    deleteLearningNote(noteId, callback) {
        this.db.run('DELETE FROM learning_notes WHERE id = ?', [noteId], callback);
    }

    // Get learning notes stats
    getLearningNotesStats(callback) {
        this.db.get(
            `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN mastered = 1 THEN 1 ELSE 0 END) as mastered,
                SUM(CASE WHEN mastered = 0 THEN 1 ELSE 0 END) as pending,
                AVG(review_count) as avgReviews
             FROM learning_notes`,
            callback
        );
    }

    clearAllData(callback) {
        this.db.serialize(() => {
            this.db.run('DELETE FROM topics');
            this.db.run('DELETE FROM progress');
            this.db.run('DELETE FROM achievements', callback);
        });
    }

    getDatabase() {
        return this.db;
    }
}

module.exports = DatabaseService;
