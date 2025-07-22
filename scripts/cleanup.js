const fs = require('fs');
const path = require('path');

/**
 * Cleanup Script for Learning Progress Tracker
 * Safely removes old files after optimization
 */

console.log('🧹 CLEANUP SCRIPT');
console.log('==================\n');

// Files that can be safely removed after optimization
const filesToCleanup = [
    'server.js',           // Original server file (replaced by server-optimized.js)
    'migrate-db.js',       // One-time migration script (no longer needed)
];

// Documentation files that might be redundant
const documentationFiles = [
    'SETUP.md',            // Might be redundant with README.md
    'LOCAL_SETUP.md',      // Might be redundant with README.md
    'QUICKSTART.md',       // Might be redundant with README.md
    'DATABASE_OPTIONS.md', // Might be redundant
];

function askUserConfirmation(message) {
    // In a real scenario, you'd use a proper CLI library like inquirer
    // For now, we'll just log what would be removed
    console.log(`❓ ${message}`);
    return false; // Safety default - don't actually delete
}

function cleanupFile(filePath, reason) {
    const fullPath = path.join(__dirname, '..', filePath);
    
    if (fs.existsSync(fullPath)) {
        console.log(`📄 Found: ${filePath}`);
        console.log(`   Reason: ${reason}`);
        
        // For safety, we'll just show what would be removed
        // To actually remove, uncomment the lines below
        
        // if (askUserConfirmation(`Remove ${filePath}?`)) {
        //     try {
        //         fs.unlinkSync(fullPath);
        //         console.log(`   ✅ Removed: ${filePath}`);
        //     } catch (error) {
        //         console.log(`   ❌ Error removing ${filePath}: ${error.message}`);
        //     }
        // } else {
        //     console.log(`   ⏭️  Skipped: ${filePath}`);
        // }
        
        console.log(`   ⚠️  Would be removed (change script to actually remove)`);
        console.log('');
    }
}

console.log('🔍 SCANNING FOR FILES TO CLEANUP...\n');

console.log('🗂️  OBSOLETE FILES:');
console.log('===================');
filesToCleanup.forEach(file => {
    cleanupFile(file, 'Replaced by optimized version');
});

console.log('📚 REDUNDANT DOCUMENTATION:');
console.log('============================');
documentationFiles.forEach(file => {
    cleanupFile(file, 'Potentially redundant with main README');
});

console.log('📋 CLEANUP SUMMARY:');
console.log('===================');
console.log('✅ server-optimized.js     - Main optimized server');
console.log('✅ config/app-config.js    - Configuration management');
console.log('✅ services/database.js    - Database service layer');
console.log('✅ utils/helpers.js        - Utility functions');
console.log('✅ scripts/backup.js       - Database backup tool');
console.log('✅ scripts/analyze.js      - Code analysis tool');
console.log('✅ data/sample-topics.json - External sample data');
console.log('✅ OPTIMIZATION_REPORT.md  - Detailed optimization report\n');

console.log('🔧 TO ACTUALLY REMOVE FILES:');
console.log('=============================');
console.log('1. Review the files listed above');
console.log('2. Uncomment the deletion code in this script');
console.log('3. Run the script again');
console.log('4. Or manually delete the files you no longer need\n');

console.log('⚠️  SAFETY NOTE:');
console.log('================');
console.log('This script is in "preview mode" and will not actually delete files.');
console.log('Review each file carefully before removal.\n');

console.log('🎉 OPTIMIZATION COMPLETE!');
console.log('Your application is now modular, maintainable, and production-ready!');
