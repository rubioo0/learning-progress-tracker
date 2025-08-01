const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./learning_progress.db');

console.log('Cleaning up test sessions...');

// Delete test sessions (keep only real user sessions)
const deleteQuery = `
    DELETE FROM time_tracking_sessions 
    WHERE id LIKE 'test_session_%' 
    OR session_data LIKE '%test_script%' 
    OR session_data LIKE '%test_calendar_colors%'
`;

db.run(deleteQuery, (err) => {
    if (err) {
        console.error('Error cleaning up test sessions:', err);
    } else {
        console.log(`Cleaned up ${this.changes} test sessions`);
        
        // Show remaining sessions
        db.all(
            'SELECT id, duration_seconds, status, date(start_time) as date FROM time_tracking_sessions ORDER BY start_time DESC',
            (err, rows) => {
                if (err) {
                    console.error('Error checking remaining sessions:', err);
                } else {
                    console.log('Remaining sessions:', JSON.stringify(rows, null, 2));
                }
                db.close();
            }
        );
    }
});
