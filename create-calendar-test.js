const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const db = new sqlite3.Database('./learning_progress.db');

// Create a test session for today with 45 minutes to test calendar colors
const sessionId = 'session_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
const startTime = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago
const endTime = new Date();

const insertQuery = `
    INSERT INTO time_tracking_sessions 
    (id, user_id, start_time, end_time, duration_seconds, status, created_at, updated_at, timezone_offset, session_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const sessionData = JSON.stringify({
    startedFrom: 'calendar_test',
    timestamp: startTime.toISOString()
});

db.run(insertQuery, [
    sessionId,
    'default_user',
    startTime.toISOString(),
    endTime.toISOString(),
    45 * 60, // 45 minutes = 2700 seconds
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
        console.log('Duration: 45 minutes (should show medium green in calendar)');
        
        // Verify the session was created
        db.get('SELECT * FROM time_tracking_sessions WHERE id = ?', [sessionId], (err, row) => {
            if (err) {
                console.error('Error retrieving test session:', err);
            } else {
                console.log('Session verified. Total duration seconds:', row.duration_seconds);
            }
            db.close();
        });
    }
});
