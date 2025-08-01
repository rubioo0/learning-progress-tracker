const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const db = new sqlite3.Database('./learning_progress.db');

// Create a test session with 65 seconds (over 1 minute)
const sessionId = 'session_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
const startTime = new Date(Date.now() - 65000); // 65 seconds ago
const endTime = new Date();

const insertQuery = `
    INSERT INTO time_tracking_sessions 
    (id, user_id, start_time, end_time, duration_seconds, status, created_at, updated_at, timezone_offset, session_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const sessionData = JSON.stringify({
    startedFrom: 'test_script',
    timestamp: startTime.toISOString()
});

db.run(insertQuery, [
    sessionId,
    'default_user',
    startTime.toISOString(),
    endTime.toISOString(),
    65,
    'completed',
    startTime.toISOString().replace('T', ' ').replace('Z', ''),
    endTime.toISOString().replace('T', ' ').replace('Z', ''),
    -180,
    sessionData
], (err) => {
    if (err) {
        console.error('Error creating test session:', err);
    } else {
        console.log('Test session created successfully:', sessionId);
        console.log('Duration: 65 seconds (1 minute 5 seconds)');
        
        // Verify the session was created
        db.get('SELECT * FROM time_tracking_sessions WHERE id = ?', [sessionId], (err, row) => {
            if (err) {
                console.error('Error retrieving test session:', err);
            } else {
                console.log('Verified session:', JSON.stringify(row, null, 2));
            }
            db.close();
        });
    }
});
