#!/usr/bin/env node

/**
 * Migration script for Learning Progress Tracker
 * Helps transition from local SQLite to PostgreSQL
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Check if SQLite database exists
const sqliteDbPath = './learning_progress.db';

if (!fs.existsSync(sqliteDbPath)) {
    console.log('No local SQLite database found. Starting fresh with cloud storage.');
    process.exit(0);
}

console.log('Local SQLite database found!');
console.log('🔄 This will help you understand your current data before migration.');

// Open SQLite database
const db = new sqlite3.Database(sqliteDbPath);

// Export data for manual migration
async function exportData() {
    console.log('\n📊 Current database contents:');
    
    // Count topics
    db.get('SELECT COUNT(*) as count FROM topics', (err, row) => {
        if (err) {
            console.error('Error reading topics:', err);
            return;
        }
        console.log(`   Topics: ${row.count}`);
        
        // Count sessions
        db.get('SELECT COUNT(*) as count FROM sessions', (err, row) => {
            if (err) {
                console.error('Error reading sessions:', err);
                return;
            }
            console.log(`   Learning sessions: ${row.count}`);
            
            // Count achievements
            db.get('SELECT COUNT(*) as count FROM achievements', (err, row) => {
                if (err) {
                    console.error('Error reading achievements:', err);
                    return;
                }
                console.log(`   Achievements: ${row.count}`);
                
                // Count attachments
                db.get('SELECT COUNT(*) as count FROM topics WHERE attachment_path IS NOT NULL', (err, row) => {
                    if (err) {
                        console.error('Error reading attachments:', err);
                        return;
                    }
                    console.log(`   File attachments: ${row.count}`);
                    
                    console.log('\n✅ Data export completed!');
                    console.log('\n📋 Migration Steps:');
                    console.log('1. Deploy your app with PostgreSQL (see DEPLOYMENT-GUIDE.md)');
                    console.log('2. Your app will start fresh with cloud storage');
                    console.log('3. Re-upload your Excel curriculum file');
                    console.log('4. Re-upload any important attachments');
                    console.log('5. Your learning progress will be permanently stored in the cloud');
                    
                    console.log('\n💡 Benefits after migration:');
                    console.log('   ✓ Data survives server restarts');
                    console.log('   ✓ Files are stored permanently');
                    console.log('   ✓ Better performance and reliability');
                    console.log('   ✓ Automatic backups (depending on hosting service)');
                    
                    db.close();
                });
            });
        });
    });
}

exportData();

// Optional: Create data export
console.log('\n💾 Creating data backup...');

// Export topics to JSON
db.all('SELECT * FROM topics ORDER BY order_index, id', (err, topics) => {
    if (err) {
        console.error('Error exporting topics:', err);
        return;
    }
    
    // Parse questions for each topic
    const processedTopics = topics.map(topic => {
        if (topic.questions) {
            try {
                topic.questions = JSON.parse(topic.questions);
            } catch (e) {
                topic.questions = [];
            }
        } else {
            topic.questions = [];
        }
        return topic;
    });
    
    const backupData = {
        exportDate: new Date().toISOString(),
        topics: processedTopics,
        metadata: {
            totalTopics: topics.length,
            version: '1.0.0'
        }
    };
    
    fs.writeFileSync('data-backup.json', JSON.stringify(backupData, null, 2));
    console.log('📄 Data backup saved to: data-backup.json');
    console.log('   This file contains your topics and can be imported later if needed.');
});

console.log('\n🚀 Ready for migration! See DEPLOYMENT-GUIDE.md for detailed instructions.');
