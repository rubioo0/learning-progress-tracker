const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./learning_progress.db');

console.log('Checking today\'s sessions...');

db.all(
    `SELECT id, duration_seconds, status, created_at, date(start_time) as date 
     FROM time_tracking_sessions 
     WHERE date(start_time) = date('now') 
     ORDER BY created_at`,
    (err, rows) => {
        if (err) {
            console.error('Error:', err);
        } else {
            console.log('Today\'s sessions:', JSON.stringify(rows, null, 2));
            
            // Calculate total
            const totalSeconds = rows
                .filter(r => r.status === 'completed')
                .reduce((sum, r) => sum + (r.duration_seconds || 0), 0);
                
            console.log(`Total completed seconds today: ${totalSeconds}`);
            console.log(`Total completed minutes today: ${Math.round(totalSeconds / 60)}`);
        }
        
        db.close();
    }
);
