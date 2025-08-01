const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./learning_progress.db');

console.log('Checking all time tracking sessions...');

db.all(
    `SELECT id, duration_seconds, status, created_at, start_time, date(start_time) as start_date 
     FROM time_tracking_sessions 
     ORDER BY created_at DESC`,
    (err, rows) => {
        if (err) {
            console.error('Error:', err);
        } else {
            console.log('All time tracking sessions:', JSON.stringify(rows, null, 2));
            
            // Group by date
            const byDate = rows.reduce((acc, row) => {
                const date = row.start_date;
                if (!acc[date]) acc[date] = [];
                acc[date].push(row);
                return acc;
            }, {});
            
            console.log('\nSessions by date:');
            Object.keys(byDate).forEach(date => {
                const sessions = byDate[date];
                const totalSeconds = sessions
                    .filter(s => s.status === 'completed')
                    .reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
                console.log(`${date}: ${sessions.length} sessions, ${totalSeconds} total seconds`);
            });
        }
        
        db.close();
    }
);
