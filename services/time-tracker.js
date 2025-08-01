const crypto = require('crypto');

class TimeTrackerService {
    constructor(database) {
        this.db = database;
        this.activeSessionsCache = new Map(); // In-memory cache for active sessions
        this.initialized = false;
        this.initializeAsync();
    }

    /**
     * Async initialization to ensure proper table creation
     */
    async initializeAsync() {
        await this.initializeLearningSessionsTable();
        await this.recoverIncompleteSessions();
        this.initialized = true;
    }

    /**
     * Wait for initialization to complete
     */
    async waitForInitialization() {
        while (!this.initialized) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    /**
     * Initialize the time_tracking_sessions table with proper schema
     */
    initializeLearningSessionsTable() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(`CREATE TABLE IF NOT EXISTS time_tracking_sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT DEFAULT 'default_user',
                    start_time TEXT NOT NULL,
                    end_time TEXT,
                    duration_seconds INTEGER,
                    status TEXT DEFAULT 'active',
                    created_at TEXT DEFAULT (datetime('now', 'utc')),
                    updated_at TEXT DEFAULT (datetime('now', 'utc')),
                    timezone_offset INTEGER,
                    session_data TEXT
                )`, (err) => {
                    if (err) return reject(err);
                    
                    // Create indexes for better performance
                    this.db.run(`CREATE INDEX IF NOT EXISTS idx_time_tracking_sessions_start_time 
                                ON time_tracking_sessions(start_time)`, (err) => {
                        if (err) return reject(err);
                        
                        this.db.run(`CREATE INDEX IF NOT EXISTS idx_time_tracking_sessions_status 
                                    ON time_tracking_sessions(status)`, (err) => {
                            if (err) return reject(err);
                            
                            this.db.run(`CREATE INDEX IF NOT EXISTS idx_time_tracking_sessions_user 
                                        ON time_tracking_sessions(user_id)`, (err) => {
                                if (err) return reject(err);
                                resolve();
                            });
                        });
                    });
                });
            });
        });
    }

    /**
     * Recover incomplete sessions on service initialization
     */
    recoverIncompleteSessions() {
        return new Promise((resolve, reject) => {
            const query = `SELECT id, start_time FROM time_tracking_sessions 
                          WHERE status = 'active' AND end_time IS NULL`;
            
            this.db.all(query, (err, rows) => {
                if (err) {
                    console.error('Error recovering incomplete sessions:', err);
                    return resolve(); // Don't fail initialization
                }

                rows.forEach(session => {
                    this.activeSessionsCache.set(session.id, {
                        id: session.id,
                        startTime: session.start_time,
                        status: 'recovered'
                    });
                });

                if (rows.length > 0) {
                    console.log(`Recovered ${rows.length} incomplete learning sessions`);
                }
                
                resolve();
            });
        });
    }

    /**
     * Start a new learning session
     * @param {string} userId - User identifier (optional, defaults to 'default_user')
     * @param {Object} sessionData - Additional session metadata (optional)
     * @returns {Promise} Session details
     */
    async startLearningSession(userId = 'default_user', sessionData = {}) {
        await this.waitForInitialization();
        
        return new Promise((resolve, reject) => {
            // Check for existing active session first
            const checkQuery = `SELECT id FROM time_tracking_sessions 
                              WHERE user_id = ? AND status = 'active' AND end_time IS NULL 
                              LIMIT 1`;
            
            this.db.get(checkQuery, [userId], (err, existingSession) => {
                if (err) {
                    console.error('Error checking for existing session:', err);
                    return reject(err);
                }

                if (existingSession) {
                    return reject(new Error('User already has an active learning session'));
                }

                const sessionId = this.generateSessionId();
                const startTime = new Date().toISOString();
                const timezoneOffset = new Date().getTimezoneOffset();
                
                const sessionInfo = {
                    id: sessionId,
                    user_id: userId,
                    start_time: startTime,
                    status: 'active',
                    timezone_offset: timezoneOffset,
                    session_data: JSON.stringify(sessionData)
                };

                const query = `INSERT INTO time_tracking_sessions 
                              (id, user_id, start_time, status, timezone_offset, session_data) 
                              VALUES (?, ?, ?, ?, ?, ?)`;

                this.db.run(query, [
                    sessionId, userId, startTime, 'active', timezoneOffset, 
                    JSON.stringify(sessionData)
                ], function(err) {
                    if (err) {
                        console.error('Error starting learning session:', err);
                        return reject(err);
                    }

                    // Cache the active session
                    this.activeSessionsCache.set(sessionId, {
                        id: sessionId,
                        userId: userId,
                        startTime: startTime,
                        status: 'active'
                    });

                    resolve({
                        sessionId: sessionId,
                        startTime: startTime,
                        status: 'started',
                        message: 'Learning session started successfully'
                    });
                }.bind(this));
            });
        });
    }

    /**
     * Stop an active learning session
     * @param {string} sessionId - Session identifier
     * @param {string} userId - User identifier (optional, for validation)
     * @returns {Promise} Session completion details
     */
    stopLearningSession(sessionId, userId = 'default_user') {
        return new Promise((resolve, reject) => {
            // Validate session exists and is active
            const cachedSession = this.activeSessionsCache.get(sessionId);
            if (!cachedSession) {
                return reject(new Error('No active session found with the provided ID'));
            }

            const endTime = new Date().toISOString();
            
            // Get session details from database
            const selectQuery = `SELECT start_time, user_id FROM time_tracking_sessions 
                               WHERE id = ? AND status = 'active'`;

            this.db.get(selectQuery, [sessionId], (err, row) => {
                if (err) {
                    console.error('Error retrieving session details:', err);
                    return reject(err);
                }

                if (!row) {
                    this.activeSessionsCache.delete(sessionId);
                    return reject(new Error('Session not found or already completed'));
                }

                // Validate user ownership
                if (row.user_id !== userId) {
                    return reject(new Error('Session does not belong to the specified user'));
                }

                // Calculate duration
                const startTime = new Date(row.start_time);
                const endTimeDate = new Date(endTime);
                const durationSeconds = Math.floor((endTimeDate - startTime) / 1000);

                // Validate reasonable duration (not negative, not too long)
                if (durationSeconds < 0) {
                    return reject(new Error('Invalid session duration: negative time'));
                }

                if (durationSeconds > 86400) { // More than 24 hours
                    console.warn(`Long session detected: ${durationSeconds} seconds`);
                }

                // Update session in database
                const updateQuery = `UPDATE time_tracking_sessions 
                                   SET end_time = ?, duration_seconds = ?, status = 'completed',
                                       updated_at = datetime('now', 'utc')
                                   WHERE id = ?`;

                this.db.run(updateQuery, [endTime, durationSeconds, sessionId], function(err) {
                    if (err) {
                        console.error('Error stopping learning session:', err);
                        return reject(err);
                    }

                    // Remove from active sessions cache
                    this.activeSessionsCache.delete(sessionId);

                    resolve({
                        sessionId: sessionId,
                        startTime: row.start_time,
                        endTime: endTime,
                        durationSeconds: durationSeconds,
                        durationMinutes: Math.round(durationSeconds / 60),
                        status: 'completed',
                        message: 'Learning session completed successfully'
                    });
                }.bind(this));
            });
        });
    }

    /**
     * Get active session for a user
     * @param {string} userId - User identifier
     * @returns {Promise} Active session details or null
     */
    getActiveSession(userId = 'default_user') {
        return new Promise((resolve, reject) => {
            const query = `SELECT id, start_time, timezone_offset, session_data 
                          FROM time_tracking_sessions 
                          WHERE user_id = ? AND status = 'active' AND end_time IS NULL
                          ORDER BY start_time DESC LIMIT 1`;

            this.db.get(query, [userId], (err, row) => {
                if (err) {
                    console.error('Error getting active session:', err);
                    return reject(err);
                }

                if (!row) {
                    return resolve(null);
                }

                // Calculate elapsed time
                const startTime = new Date(row.start_time);
                const now = new Date();
                const elapsedSeconds = Math.floor((now - startTime) / 1000);

                resolve({
                    sessionId: row.id,
                    startTime: row.start_time,
                    elapsedSeconds: elapsedSeconds,
                    elapsedMinutes: Math.round(elapsedSeconds / 60),
                    timezoneOffset: row.timezone_offset,
                    sessionData: row.session_data ? JSON.parse(row.session_data) : {}
                });
            });
        });
    }

    /**
     * Calculate total learning time for a user
     * @param {string} userId - User identifier
     * @param {string} dateRange - Optional date range filter ('today', 'week', 'month', 'all')
     * @returns {Promise} Calculated time statistics
     */
    calculateLearningTime(userId = 'default_user', dateRange = 'all') {
        return new Promise((resolve, reject) => {
            let dateFilter = '';
            const params = [userId];

            switch (dateRange) {
                case 'today':
                    dateFilter = `AND date(start_time) = date('now')`;
                    break;
                case 'week':
                    dateFilter = `AND start_time >= date('now', '-7 days')`;
                    break;
                case 'month':
                    dateFilter = `AND start_time >= date('now', '-30 days')`;
                    break;
                case 'all':
                default:
                    dateFilter = '';
                    break;
            }

            const query = `
                SELECT 
                    COUNT(*) as total_sessions,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_sessions,
                    COUNT(CASE WHEN status = 'active' THEN 1 END) as active_sessions,
                    COALESCE(SUM(CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds ELSE 0 END), 0) as total_seconds,
                    COALESCE(AVG(CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds ELSE NULL END), 0) as avg_seconds,
                    MIN(start_time) as first_session,
                    MAX(start_time) as last_session
                FROM time_tracking_sessions 
                WHERE user_id = ? AND status != 'cancelled' ${dateFilter}
            `;

            this.db.get(query, params, (err, row) => {
                if (err) {
                    console.error('Error calculating learning time:', err);
                    return reject(err);
                }

                const totalMinutes = Math.round(row.total_seconds / 60);
                const totalHours = Math.round(row.total_seconds / 3600 * 100) / 100;
                const avgMinutes = Math.round(row.avg_seconds / 60);

                resolve({
                    totalSessions: row.total_sessions,
                    completedSessions: row.completed_sessions,
                    activeSessions: row.active_sessions,
                    totalSeconds: row.total_seconds,
                    totalMinutes: totalMinutes,
                    totalHours: totalHours,
                    averageSessionMinutes: avgMinutes,
                    firstSession: row.first_session,
                    lastSession: row.last_session,
                    dateRange: dateRange
                });
            });
        });
    }

    /**
     * Get calendar data for learning sessions
     * @param {string} userId - User identifier
     * @param {number} monthsBack - Number of months to go back (default: 6)
     * @returns {Promise} Calendar data grouped by date
     */
    getCalendarData(userId = 'default_user', monthsBack = 6) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    date(start_time) as date,
                    COUNT(*) as sessions,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_sessions,
                    COALESCE(SUM(CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds ELSE 0 END), 0) as total_seconds
                FROM time_tracking_sessions 
                WHERE user_id = ? 
                  AND start_time >= date('now', '-${monthsBack} months')
                  AND status != 'cancelled'
                GROUP BY date(start_time)
                ORDER BY date DESC
            `;

            this.db.all(query, [userId], (err, rows) => {
                if (err) {
                    console.error('Error getting calendar data:', err);
                    return reject(err);
                }

                const calendarData = {};
                rows.forEach(row => {
                    const totalMinutes = Math.round(row.total_seconds / 60);
                    calendarData[row.date] = {
                        sessions: row.sessions,
                        completedSessions: row.completed_sessions,
                        totalSeconds: row.total_seconds,
                        totalMinutes: totalMinutes,
                        hasActivity: row.total_seconds > 0,
                        intensity: this.calculateIntensity(totalMinutes) // For visual representation
                    };
                });

                resolve(calendarData);
            });
        });
    }

    /**
     * Cancel an active session (for error recovery)
     * @param {string} sessionId - Session identifier
     * @param {string} reason - Reason for cancellation
     * @returns {Promise} Cancellation result
     */
    cancelSession(sessionId, reason = 'Manual cancellation') {
        return new Promise((resolve, reject) => {
            const query = `UPDATE time_tracking_sessions 
                          SET status = 'cancelled', 
                              session_data = json_set(COALESCE(session_data, '{}'), '$.cancellation_reason', ?),
                              updated_at = datetime('now', 'utc')
                          WHERE id = ? AND status = 'active'`;

            this.db.run(query, [reason, sessionId], function(err) {
                if (err) {
                    console.error('Error cancelling session:', err);
                    return reject(err);
                }

                if (this.changes === 0) {
                    return reject(new Error('Session not found or already completed'));
                }

                // Remove from cache
                this.activeSessionsCache.delete(sessionId);

                resolve({
                    sessionId: sessionId,
                    status: 'cancelled',
                    reason: reason,
                    message: 'Session cancelled successfully'
                });
            }.bind(this));
        });
    }

    /**
     * Helper methods
     */
    hasActiveSession(userId) {
        for (const [sessionId, session] of this.activeSessionsCache) {
            if (session.userId === userId && session.status === 'active') {
                return true;
            }
        }
        return false;
    }

    generateSessionId() {
        // Generate a simple unique ID (you could use uuid if available)
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    calculateIntensity(minutes) {
        if (minutes === 0) return 0;
        if (minutes < 30) return 1;
        if (minutes < 60) return 2;
        if (minutes < 120) return 3;
        return 4;
    }

    /**
     * Get session statistics for a specific time period
     * @param {string} userId - User identifier
     * @param {string} startDate - Start date (ISO string)
     * @param {string} endDate - End date (ISO string)
     * @returns {Promise} Session statistics
     */
    getSessionStatistics(userId = 'default_user', startDate, endDate) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT 
                    date(start_time) as date,
                    COUNT(*) as sessions,
                    SUM(CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds ELSE 0 END) as total_seconds,
                    MIN(duration_seconds) as min_duration,
                    MAX(duration_seconds) as max_duration,
                    AVG(duration_seconds) as avg_duration
                FROM time_tracking_sessions 
                WHERE user_id = ? AND status = 'completed'
            `;
            
            const params = [userId];
            
            if (startDate) {
                query += ` AND start_time >= ?`;
                params.push(startDate);
            }
            
            if (endDate) {
                query += ` AND start_time <= ?`;
                params.push(endDate);
            }
            
            query += ` GROUP BY date(start_time) ORDER BY date DESC`;

            this.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('Error getting session statistics:', err);
                    return reject(err);
                }

                resolve(rows.map(row => ({
                    date: row.date,
                    sessions: row.sessions,
                    totalMinutes: Math.round(row.total_seconds / 60),
                    minMinutes: row.min_duration ? Math.round(row.min_duration / 60) : 0,
                    maxMinutes: row.max_duration ? Math.round(row.max_duration / 60) : 0,
                    avgMinutes: row.avg_duration ? Math.round(row.avg_duration / 60) : 0
                })));
            });
        });
    }

    /**
     * Clean up old sessions (maintenance function)
     * @param {number} daysOld - Remove sessions older than this many days
     * @returns {Promise} Cleanup result
     */
    cleanupOldSessions(daysOld = 365) {
        return new Promise((resolve, reject) => {
            const query = `DELETE FROM time_tracking_sessions 
                          WHERE start_time < date('now', '-${daysOld} days')
                          AND status IN ('completed', 'cancelled')`;

            this.db.run(query, function(err) {
                if (err) {
                    console.error('Error cleaning up old sessions:', err);
                    return reject(err);
                }

                resolve({
                    deletedSessions: this.changes,
                    message: `Cleaned up ${this.changes} old sessions`
                });
            });
        });
    }
}

module.exports = TimeTrackerService;
