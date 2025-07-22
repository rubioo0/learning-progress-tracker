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
