const fs = require('fs');
const path = require('path');
const config = require('./config/app-config');

/**
 * Backup utility for the Learning Progress Tracker
 * Creates a timestamped backup of the database
 */

function createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(__dirname, 'backups', `learning_progress_${timestamp}.db`);
    const sourceDb = config.DATABASE_PATH;
    
    // Create backups directory if it doesn't exist
    const backupDir = path.dirname(backupPath);
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    try {
        if (fs.existsSync(sourceDb)) {
            fs.copyFileSync(sourceDb, backupPath);
            console.log(`✅ Database backup created: ${backupPath}`);
            return backupPath;
        } else {
            console.log('⚠️  Source database not found, no backup created');
            return null;
        }
    } catch (error) {
        console.error('❌ Error creating backup:', error);
        return null;
    }
}

function listBackups() {
    const backupDir = path.join(__dirname, 'backups');
    
    if (!fs.existsSync(backupDir)) {
        console.log('No backups directory found');
        return [];
    }
    
    try {
        const backups = fs.readdirSync(backupDir)
            .filter(file => file.endsWith('.db'))
            .map(file => {
                const filePath = path.join(backupDir, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    path: filePath,
                    created: stats.birthtime,
                    size: stats.size
                };
            })
            .sort((a, b) => b.created - a.created);
            
        return backups;
    } catch (error) {
        console.error('Error listing backups:', error);
        return [];
    }
}

function restoreBackup(backupPath) {
    const sourceDb = config.DATABASE_PATH;
    
    try {
        if (fs.existsSync(backupPath)) {
            // Create a backup of the current database before restoring
            const currentBackup = createBackup();
            if (currentBackup) {
                console.log(`Current database backed up to: ${currentBackup}`);
            }
            
            fs.copyFileSync(backupPath, sourceDb);
            console.log(`✅ Database restored from: ${backupPath}`);
            return true;
        } else {
            console.log('❌ Backup file not found');
            return false;
        }
    } catch (error) {
        console.error('❌ Error restoring backup:', error);
        return false;
    }
}

// CLI interface
if (require.main === module) {
    const command = process.argv[2];
    
    switch (command) {
        case 'create':
            createBackup();
            break;
            
        case 'list':
            const backups = listBackups();
            if (backups.length === 0) {
                console.log('No backups found');
            } else {
                console.log('Available backups:');
                backups.forEach((backup, index) => {
                    console.log(`${index + 1}. ${backup.filename} (${backup.created.toLocaleString()}) - ${(backup.size / 1024).toFixed(2)} KB`);
                });
            }
            break;
            
        case 'restore':
            const backupIndex = parseInt(process.argv[3]) - 1;
            const backups2 = listBackups();
            
            if (backupIndex >= 0 && backupIndex < backups2.length) {
                restoreBackup(backups2[backupIndex].path);
            } else {
                console.log('Invalid backup index. Use "list" command to see available backups.');
            }
            break;
            
        default:
            console.log(`
Database Backup Utility

Usage:
  node backup.js create     - Create a new backup
  node backup.js list       - List available backups  
  node backup.js restore N  - Restore backup number N (use list to see numbers)

Examples:
  node backup.js create
  node backup.js list
  node backup.js restore 1
            `);
    }
}

module.exports = {
    createBackup,
    listBackups,
    restoreBackup
};
