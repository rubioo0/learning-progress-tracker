const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const db = new sqlite3.Database('./learning_progress.db');

// Create test sessions for different days with different durations to test colors

const sessions = [
    // Yesterday: 30 minutes (medium green)
    {
        duration: 1800, // 30 minutes
        date: new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
    },
    // Day before yesterday: 75 minutes (dark green)
    {
        duration: 4500, // 75 minutes  
        date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
    }
];

let completed = 0;

sessions.forEach((session, index) => {
    const sessionId = 'test_session_' + Date.now() + '_' + index + '_' + crypto.randomBytes(4).toString('hex');
    const startTime = new Date(session.date.getTime() - session.duration * 1000);
    const endTime = session.date;

    const insertQuery = `
        INSERT INTO time_tracking_sessions 
        (id, user_id, start_time, end_time, duration_seconds, status, created_at, updated_at, timezone_offset, session_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const sessionData = JSON.stringify({
        startedFrom: 'test_calendar_colors',
        timestamp: startTime.toISOString()
    });

    db.run(insertQuery, [
        sessionId,
        'default_user',
        startTime.toISOString(),
        endTime.toISOString(),
        session.duration,
        'completed',
        startTime.toISOString().replace('T', ' ').replace('Z', ''),
        endTime.toISOString().replace('T', ' ').replace('Z', ''),
        -180,
        sessionData
    ], (err) => {
        if (err) {
            console.error('Error creating test session:', err);
        } else {
            console.log(`Test session ${index + 1} created: ${session.duration} seconds (${Math.round(session.duration / 60)} minutes) on ${endTime.toISOString().split('T')[0]}`);
        }
        
        completed++;
        if (completed === sessions.length) {
            console.log('All test sessions created successfully!');
            db.close();
        }
    });
});
