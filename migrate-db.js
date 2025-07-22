const sqlite3 = require('sqlite3').verbose();

// Open the database
const db = new sqlite3.Database('./learning_progress.db');

console.log('Adding attachment columns to topics table...');

// Add the missing attachment columns
db.serialize(() => {
    // Check if columns exist first, then add them if they don't
    db.run(`PRAGMA table_info(topics)`, (err, rows) => {
        if (err) {
            console.error('Error checking table info:', err);
            return;
        }
    });
    
    // Add attachment columns (SQLite will ignore if they already exist due to IF NOT EXISTS approach)
    db.run(`ALTER TABLE topics ADD COLUMN attachment_filename TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding attachment_filename column:', err);
        } else {
            console.log('✓ attachment_filename column added (or already exists)');
        }
    });
    
    db.run(`ALTER TABLE topics ADD COLUMN attachment_original_name TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding attachment_original_name column:', err);
        } else {
            console.log('✓ attachment_original_name column added (or already exists)');
        }
    });
    
    db.run(`ALTER TABLE topics ADD COLUMN attachment_path TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding attachment_path column:', err);
        } else {
            console.log('✓ attachment_path column added (or already exists)');
        }
        
        // Close database after all operations
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
            } else {
                console.log('✅ Database migration completed successfully!');
                console.log('You can now restart the server.');
            }
        });
    });
});
