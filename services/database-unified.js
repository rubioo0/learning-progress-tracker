const sqlite3 = require('sqlite3').verbose();
const config = require('../config/app-config');

class DatabaseService {
    constructor() {
        // Use PostgreSQL in production, SQLite for development
        if (config.DATABASE_URL) {
            this.initializePostgreSQL();
        } else {
            this.initializeSQLite();
        }
    }

    initializePostgreSQL() {
        console.log('Initializing PostgreSQL database...');
        const { Pool } = require('pg');
        
        this.pool = new Pool({
            connectionString: config.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        this.dbType = 'postgresql';
        this.initializePostgreSQLTables();
    }

    initializeSQLite() {
        console.log('Initializing SQLite database...');
        this.db = new sqlite3.Database(config.DATABASE_PATH);
        this.dbType = 'sqlite';
        this.initializeSQLiteTables();
    }

    async initializePostgreSQLTables() {
        const client = await this.pool.connect();
        try {
            // Create topics table
            await client.query(`
                CREATE TABLE IF NOT EXISTS topics (
                    id SERIAL PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT,
                    category TEXT,
                    module TEXT,
                    status TEXT DEFAULT 'not-started',
                    notes TEXT,
                    questions TEXT,
                    attachment_filename TEXT,
                    attachment_original_name TEXT,
                    attachment_path TEXT,
                    attachment_url TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    order_index INTEGER
                )
            `);

            // Create sessions table
            await client.query(`
                CREATE TABLE IF NOT EXISTS sessions (
                    id SERIAL PRIMARY KEY,
                    start_time TIMESTAMP NOT NULL,
                    end_time TIMESTAMP,
                    duration INTEGER,
                    elapsed_minutes INTEGER,
                    topic_id INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create progress table
            await client.query(`
                CREATE TABLE IF NOT EXISTS progress (
                    id SERIAL PRIMARY KEY,
                    total_topics INTEGER,
                    completed_topics INTEGER,
                    in_progress_topics INTEGER,
                    points INTEGER DEFAULT 0,
                    level INTEGER DEFAULT 1,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create achievements table
            await client.query(`
                CREATE TABLE IF NOT EXISTS achievements (
                    id SERIAL PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT,
                    earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    type TEXT
                )
            `);

            // Create time_tracking_sessions table
            await client.query(`
                CREATE TABLE IF NOT EXISTS time_tracking_sessions (
                    id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT 'default_user',
                    start_time TIMESTAMP NOT NULL,
                    end_time TIMESTAMP,
                    duration_seconds INTEGER,
                    status TEXT DEFAULT 'active',
                    session_data TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            console.log('PostgreSQL tables initialized successfully');
        } catch (error) {
            console.error('Error initializing PostgreSQL tables:', error);
        } finally {
            client.release();
        }
    }

    initializeSQLiteTables() {
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
                attachment_url TEXT,
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

            // Add attachment_url column for cloud storage URLs
            this.db.run(`ALTER TABLE topics ADD COLUMN attachment_url TEXT`, (err) => {
                // Ignore error if column already exists
                if (err && !err.message.includes('duplicate column name')) {
                    console.log('Added attachment_url column for cloud storage');
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

            // Add time_tracking_sessions table
            this.db.run(`CREATE TABLE IF NOT EXISTS time_tracking_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL DEFAULT 'default_user',
                start_time DATETIME NOT NULL,
                end_time DATETIME,
                duration_seconds INTEGER,
                status TEXT DEFAULT 'active',
                session_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
        });
    }

    // Unified query method that works with both databases
    async query(sql, params = []) {
        if (this.dbType === 'postgresql') {
            const client = await this.pool.connect();
            try {
                const result = await client.query(sql, params);
                return result.rows;
            } finally {
                client.release();
            }
        } else {
            return new Promise((resolve, reject) => {
                this.db.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        }
    }

    // Unified run method for INSERT/UPDATE/DELETE
    async run(sql, params = []) {
        if (this.dbType === 'postgresql') {
            const client = await this.pool.connect();
            try {
                const result = await client.query(sql, params);
                return { 
                    changes: result.rowCount, 
                    lastID: result.rows[0]?.id 
                };
            } finally {
                client.release();
            }
        } else {
            return new Promise((resolve, reject) => {
                this.db.run(sql, params, function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes, lastID: this.lastID });
                });
            });
        }
    }

    // Get a single row
    async get(sql, params = []) {
        if (this.dbType === 'postgresql') {
            const client = await this.pool.connect();
            try {
                const result = await client.query(sql, params);
                return result.rows[0];
            } finally {
                client.release();
            }
        } else {
            return new Promise((resolve, reject) => {
                this.db.get(sql, params, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        }
    }

    // Insert a new session (start_time, end_time, duration in seconds)
    insertSession(startTime, endTime, duration, callback) {
        const sql = this.dbType === 'postgresql' 
            ? 'INSERT INTO sessions (start_time, end_time, duration) VALUES ($1, $2, $3) RETURNING id'
            : 'INSERT INTO sessions (start_time, end_time, duration) VALUES (?, ?, ?)';
        
        if (this.dbType === 'postgresql') {
            this.run(sql, [startTime, endTime, duration])
                .then(result => callback(null, result))
                .catch(callback);
        } else {
            this.db.run(sql, [startTime, endTime, duration], function(err) {
                callback(err, { lastID: this.lastID });
            });
        }
    }

    // Start a new learning session
    startLearningSession(callback) {
        const startTime = new Date().toISOString();
        const sql = this.dbType === 'postgresql'
            ? 'INSERT INTO sessions (start_time) VALUES ($1) RETURNING id'
            : 'INSERT INTO sessions (start_time) VALUES (?)';
        
        if (this.dbType === 'postgresql') {
            this.run(sql, [startTime])
                .then(result => {
                    callback(null, {
                        sessionId: result.lastID || result.rows?.[0]?.id,
                        startTime: startTime
                    });
                })
                .catch(callback);
        } else {
            this.db.run(sql, [startTime], function(err) {
                if (err) return callback(err);
                callback(null, {
                    sessionId: this.lastID,
                    startTime: startTime
                });
            });
        }
    }

    // Stop a learning session
    stopLearningSession(sessionId, callback) {
        const endTime = new Date().toISOString();
        
        // First get the session start time
        const getSessionSql = this.dbType === 'postgresql'
            ? 'SELECT start_time FROM sessions WHERE id = $1'
            : 'SELECT start_time FROM sessions WHERE id = ?';
        
        this.get(getSessionSql, [sessionId])
            .then(session => {
                if (!session) {
                    return callback(new Error('Session not found'));
                }
                
                const startTime = new Date(session.start_time);
                const endTimeDate = new Date(endTime);
                const duration = Math.floor((endTimeDate.getTime() - startTime.getTime()) / 1000);
                const elapsedMinutes = Math.floor(duration / 60);
                
                const updateSql = this.dbType === 'postgresql'
                    ? 'UPDATE sessions SET end_time = $1, duration = $2, elapsed_minutes = $3 WHERE id = $4'
                    : 'UPDATE sessions SET end_time = ?, duration = ?, elapsed_minutes = ? WHERE id = ?';
                
                this.run(updateSql, [endTime, duration, elapsedMinutes, sessionId])
                    .then(() => {
                        callback(null, {
                            endTime: endTime,
                            duration: duration,
                            elapsedMinutes: elapsedMinutes
                        });
                    })
                    .catch(callback);
            })
            .catch(callback);
    }

    // Get active sessions (sessions without end_time)
    getActiveSessions(callback) {
        const sql = 'SELECT * FROM sessions WHERE end_time IS NULL ORDER BY start_time DESC';
        this.query(sql)
            .then(rows => callback(null, rows))
            .catch(callback);
    }

    // Get the most recent active session
    getCurrentActiveSession(callback) {
        const sql = 'SELECT * FROM sessions WHERE end_time IS NULL ORDER BY start_time DESC LIMIT 1';
        this.get(sql)
            .then(row => callback(null, row))
            .catch(callback);
    }

    // Get total learning time statistics
    getTotalLearningTime(callback) {
        const sql = `
            SELECT 
                COUNT(*) as totalSessions,
                COALESCE(SUM(duration), 0) as totalSeconds,
                COALESCE(SUM(elapsed_minutes), 0) as totalMinutes
            FROM sessions 
            WHERE end_time IS NOT NULL
        `;
        
        this.get(sql)
            .then(row => {
                const stats = {
                    totalSessions: row.totalsessions || row.totalSessions || 0,
                    totalSeconds: row.totalseconds || row.totalSeconds || 0,
                    totalMinutes: row.totalminutes || row.totalMinutes || 0,
                    totalHours: Math.round(((row.totalseconds || row.totalSeconds || 0) / 3600) * 100) / 100
                };
                callback(null, stats);
            })
            .catch(callback);
    }

    // Rest of the methods remain the same but need to be converted to use the unified query methods
    getAllTopics(callback) {
        const sql = 'SELECT * FROM topics ORDER BY order_index, id';
        this.query(sql)
            .then(rows => {
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
            })
            .catch(callback);
    }

    updateTopic(id, status, notes, callback) {
        const sql = this.dbType === 'postgresql'
            ? 'UPDATE topics SET status = $1, notes = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3'
            : 'UPDATE topics SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        
        this.run(sql, [status, notes, id])
            .then(() => {
                this.updateProgress();
                this.checkAchievements();
                callback(null);
            })
            .catch(callback);
    }

    updateProgress() {
        const query = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as in_progress
            FROM topics
        `;
        
        this.get(query)
            .then(row => {
                const points = row.completed * config.POINTS_PER_COMPLETION;
                const level = Math.floor(points / config.POINTS_PER_LEVEL) + 1;
                
                const insertSql = this.dbType === 'postgresql'
                    ? `INSERT INTO progress (id, total_topics, completed_topics, in_progress_topics, points, level)
                       VALUES (1, $1, $2, $3, $4, $5)
                       ON CONFLICT (id) DO UPDATE SET
                       total_topics = $1, completed_topics = $2, in_progress_topics = $3, points = $4, level = $5`
                    : `INSERT OR REPLACE INTO progress (id, total_topics, completed_topics, in_progress_topics, points, level)
                       VALUES (1, ?, ?, ?, ?, ?)`;
                
                this.run(insertSql, [row.total, row.completed, row.in_progress, points, level]);
            })
            .catch(console.error);
    }

    checkAchievements() {
        const sql = 'SELECT COUNT(*) as completed FROM topics WHERE status = ?';
        this.get(sql, ['completed'])
            .then(row => {
                if (config.ACHIEVEMENT_MILESTONES) {
                    config.ACHIEVEMENT_MILESTONES.forEach(milestone => {
                        if (row.completed === milestone.count) {
                            const insertSql = this.dbType === 'postgresql'
                                ? 'INSERT INTO achievements (title, description, type) VALUES ($1, $2, $3)'
                                : 'INSERT INTO achievements (title, description, type) VALUES (?, ?, ?)';
                            
                            this.run(insertSql, [milestone.title, milestone.description, 'milestone']);
                        }
                    });
                }
            })
            .catch(console.error);
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
        
        this.get(query)
            .then(row => callback(null, row))
            .catch(callback);
    }

    getAchievements(callback) {
        const sql = 'SELECT * FROM achievements ORDER BY earned_at DESC';
        this.query(sql)
            .then(rows => callback(null, rows))
            .catch(callback);
    }

    updateTopicAttachment(id, filename, originalName, attachmentPath, attachmentUrl, callback) {
        // If only 5 parameters, it's the old signature without attachmentUrl
        if (typeof attachmentUrl === 'function') {
            callback = attachmentUrl;
            attachmentUrl = null;
        }
        
        const sql = this.dbType === 'postgresql'
            ? 'UPDATE topics SET attachment_filename = $1, attachment_original_name = $2, attachment_path = $3, attachment_url = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5'
            : 'UPDATE topics SET attachment_filename = ?, attachment_original_name = ?, attachment_path = ?, attachment_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        
        this.run(sql, [filename, originalName, attachmentPath, attachmentUrl, id])
            .then(() => callback(null))
            .catch(callback);
    }

    getTopicAttachment(id, callback) {
        const sql = 'SELECT attachment_path, attachment_original_name, attachment_url FROM topics WHERE id = ?';
        this.get(sql, [id])
            .then(row => callback(null, row))
            .catch(callback);
    }

    removeTopicAttachment(id, callback) {
        const sql = this.dbType === 'postgresql'
            ? 'UPDATE topics SET attachment_filename = NULL, attachment_original_name = NULL, attachment_path = NULL, attachment_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1'
            : 'UPDATE topics SET attachment_filename = NULL, attachment_original_name = NULL, attachment_path = NULL, attachment_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        
        this.run(sql, [id])
            .then(() => callback(null))
            .catch(callback);
    }

    clearTopics(callback) {
        const sql = 'DELETE FROM topics';
        this.run(sql)
            .then(() => callback(null))
            .catch(callback);
    }

    clearAllData(callback) {
        const queries = [
            'DELETE FROM topics',
            'DELETE FROM sessions',
            'DELETE FROM achievements',
            'DELETE FROM progress',
            'DELETE FROM time_tracking_sessions'
        ];

        Promise.all(queries.map(sql => this.run(sql)))
            .then(() => callback(null))
            .catch(callback);
    }

    bulkInsertTopics(topics, callback) {
        if (this.dbType === 'postgresql') {
            // PostgreSQL bulk insert
            const values = topics.map((_, index) => {
                const offset = index * 5;
                return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
            }).join(', ');
            
            const params = topics.flatMap(topic => [
                topic.title, topic.description, topic.category, topic.module, topic.order_index
            ]);
            
            const sql = `INSERT INTO topics (title, description, category, module, order_index) VALUES ${values}`;
            this.run(sql, params)
                .then(() => callback(null))
                .catch(callback);
        } else {
            // SQLite bulk insert
            const stmt = this.db.prepare(`
                INSERT INTO topics (title, description, category, module, order_index)
                VALUES (?, ?, ?, ?, ?)
            `);

            topics.forEach(topic => {
                stmt.run([topic.title, topic.description, topic.category, topic.module, topic.order_index]);
            });

            stmt.finalize(callback);
        }
    }

    // Get a single topic by ID with questions
    getTopicById(id, callback) {
        const sql = 'SELECT * FROM topics WHERE id = ?';
        this.get(sql, [id])
            .then(row => {
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
            })
            .catch(callback);
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
                addedAt: new Date().toISOString()
            });
            
            const sql = this.dbType === 'postgresql'
                ? 'UPDATE topics SET questions = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2'
                : 'UPDATE topics SET questions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
            
            this.run(sql, [JSON.stringify(questions), topicId])
                .then(() => callback(null))
                .catch(callback);
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
            
            const sql = this.dbType === 'postgresql'
                ? 'UPDATE topics SET questions = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2'
                : 'UPDATE topics SET questions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
            
            this.run(sql, [JSON.stringify(questions), topicId])
                .then(() => callback(null))
                .catch(callback);
        });
    }

    // Toggle question status
    toggleQuestionStatus(topicId, questionIndex, callback) {
        this.getTopicById(topicId, (err, topic) => {
            if (err) return callback(err);
            if (!topic) return callback(new Error('Topic not found'));
            
            const questions = topic.questions || [];
            if (questionIndex < 0 || questionIndex >= questions.length) {
                return callback(new Error('Invalid question index'));
            }
            
            questions[questionIndex].answered = !questions[questionIndex].answered;
            
            const sql = this.dbType === 'postgresql'
                ? 'UPDATE topics SET questions = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2'
                : 'UPDATE topics SET questions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
            
            this.run(sql, [JSON.stringify(questions), topicId])
                .then(() => callback(null))
                .catch(callback);
        });
    }
}

module.exports = DatabaseService;
