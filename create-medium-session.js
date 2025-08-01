const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const db = new sqlite3.Database('./learning_progress.db');

// Create a test session for today with 35 minutes
const sessionId = 'session_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
const startTime = new Date(Date.now() - 35 * 60 * 1000); // 35 minutes ago
const endTime = new Date();

const insertQuery = `
    INSERT INTO time_tracking_sessions 
    (id, user_id, start_time, end_time, duration_seconds, status, created_at, updated_at, timezone_offset, session_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const sessionData = JSON.stringify({
    startedFrom: 'calendar_color_test',
    timestamp: startTime.toISOString()
});

db.run(insertQuery, [
    sessionId,
    'default_user',
    startTime.toISOString(),
    endTime.toISOString(),
    35 * 60, // 35 minutes = 2100 seconds
    'completed',
    startTime.toISOString().replace('T', ' ').replace('Z', ''),
    endTime.toISOString().replace('T', ' ').replace('Z', ''),
    -180,
    sessionData
], (err) => {
    if (err) {
        console.error('Error creating test session:', err);
    } else {
        console.log('Test session created:', sessionId);
        console.log('Duration: 35 minutes (should show medium green)');
        db.close();
    }
});
