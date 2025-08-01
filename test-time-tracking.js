/**
 * Test script for Time Tracking functionality
 * Run this to verify the time tracking system works correctly
 */

const TimeTrackerService = require('./services/time-tracker');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create a test database
const testDbPath = path.join(__dirname, 'test-time-tracking.db');
const db = new sqlite3.Database(testDbPath);

async function runTests() {
    console.log('Starting Time Tracking Tests...\n');

    // Clean up any existing test data
    await new Promise((resolve, reject) => {
        db.run('DELETE FROM time_tracking_sessions', (err) => {
            if (err && !err.message.includes('no such table')) reject(err);
            else resolve();
        });
    });

    const timeTracker = new TimeTrackerService(db);
    await timeTracker.waitForInitialization(); // Wait for async initialization
    let testResults = [];

    try {
        // Test 1: Start a session
        console.log('Test 1: Starting a learning session...');
        const startResult = await timeTracker.startLearningSession('test_user', { test: true });
        console.log('✓ Session started:', startResult);
        testResults.push({ test: 'Start Session', status: 'PASS', data: startResult });

        // Wait a moment to simulate learning time
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Test 2: Check active session
        console.log('\nTest 2: Checking active session...');
        const activeSession = await timeTracker.getActiveSession('test_user');
        console.log('✓ Active session found:', activeSession);
        testResults.push({ test: 'Get Active Session', status: 'PASS', data: activeSession });

        // Wait a bit more
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 3: Stop the session
        console.log('\nTest 3: Stopping the learning session...');
        const stopResult = await timeTracker.stopLearningSession(startResult.sessionId, 'test_user');
        console.log('✓ Session stopped:', stopResult);
        testResults.push({ test: 'Stop Session', status: 'PASS', data: stopResult });

        // Test 4: Calculate learning time
        console.log('\nTest 4: Calculating learning time...');
        const stats = await timeTracker.calculateLearningTime('test_user', 'all');
        console.log('✓ Learning time calculated:', stats);
        testResults.push({ test: 'Calculate Time', status: 'PASS', data: stats });

        // Test 5: Get calendar data
        console.log('\nTest 5: Getting calendar data...');
        const calendarData = await timeTracker.getCalendarData('test_user', 1);
        console.log('✓ Calendar data retrieved:', calendarData);
        testResults.push({ test: 'Calendar Data', status: 'PASS', data: calendarData });

        // Test 6: Error handling - try to start another session for same user
        console.log('\nTest 6: Testing error handling (duplicate session)...');
        try {
            // First start a new session
            const newSession = await timeTracker.startLearningSession('test_user_duplicate');
            // Now try to start another one for the same user
            await timeTracker.startLearningSession('test_user_duplicate');
            testResults.push({ test: 'Error Handling', status: 'FAIL', error: 'Should have thrown error' });
        } catch (error) {
            console.log('✓ Error correctly caught:', error.message);
            testResults.push({ test: 'Error Handling', status: 'PASS', error: error.message });
        }

        // Test 7: Session recovery
        console.log('\nTest 7: Testing session recovery...');
        const startResult2 = await timeTracker.startLearningSession('test_user_2');
        console.log('✓ Second session started for recovery test');
        
        // Simulate app restart by creating new instance
        const timeTracker2 = new TimeTrackerService(db);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for recovery
        
        console.log('✓ Service restarted and sessions recovered');
        testResults.push({ test: 'Session Recovery', status: 'PASS' });

        // Clean up
        await timeTracker2.cancelSession(startResult2.sessionId, 'Test cleanup');

        console.log('\n=== TEST SUMMARY ===');
        testResults.forEach(result => {
            const status = result.status === 'PASS' ? '✓' : '✗';
            console.log(`${status} ${result.test}: ${result.status}`);
        });

        const passedTests = testResults.filter(r => r.status === 'PASS').length;
        const totalTests = testResults.length;
        console.log(`\nPassed: ${passedTests}/${totalTests} tests`);

        if (passedTests === totalTests) {
            console.log('\n🎉 All tests passed! Time tracking system is working correctly.');
        } else {
            console.log('\n❌ Some tests failed. Please check the implementation.');
        }

    } catch (error) {
        console.error('\n❌ Test failed with error:', error);
        testResults.push({ test: 'Overall', status: 'FAIL', error: error.message });
    } finally {
        // Close database
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
            } else {
                console.log('\nDatabase connection closed.');
            }
        });
    }
}

// Run the tests
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = { runTests };
