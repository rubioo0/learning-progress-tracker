/**
 * Time Tracker Component
 * Handles learning session tracking with robust error handling and state management
 */

class TimeTrackerComponent {
    constructor(containerSelector = null) {
        // Get existing elements instead of creating new ones
        this.button = document.getElementById('learning-control-btn');
        this.timeDisplay = document.getElementById('learning-timer-display');
        this.container = containerSelector ? document.querySelector(containerSelector) : document.body;
        
        // Initialize session state manager
        this.sessionStateManager = new SessionStateManager();
        
        // Component state
        this.isActive = false;
        this.currentSessionId = null;
        this.startTime = null;
        this.elapsedTime = 0;
        this.isLoading = false;
        this.retryQueue = [];
        
        // Timers
        this.updateTimer = null;
        this.debounceTimer = null;
        
        // Configuration
        this.config = {
            updateInterval: 1000, // Update display every second
            debounceDelay: 300, // Prevent rapid clicks
            retryAttempts: 3,
            retryDelay: 1000,
            apiTimeout: 5000
        };

        this.initialize();
    }

    /**
     * Initialize the time tracker component
     */
    async initialize() {
        try {
            // Check if existing elements are found
            if (!this.button) {
                throw new Error('Session control buttons not found. Please try again.');
            }
            
            if (!this.timeDisplay) {
                console.warn('Time display element not found, creating fallback');
                this.timeDisplay = this.createFallbackTimeDisplay();
            }

            this.setupEventListeners();
            await this.checkForExistingSessions();
            await this.loadInitialState();
            
            console.log('Time Tracker initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Time Tracker:', error);
            this.showError('Failed to initialize time tracker. Please refresh the page.');
        }
    }

    /**
     * Create fallback time display if none exists
     */
    createFallbackTimeDisplay() {
        const display = document.createElement('div');
        display.className = 'text-2xl font-mono font-bold text-blue-600 dark:text-blue-400';
        display.textContent = '00:00:00';
        display.id = 'fallback-time-display';
        
        if (this.container && this.container !== document.body) {
            this.container.appendChild(display);
        }
        
        return display;
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Override the existing button click handler
        if (this.button) {
            // Remove existing onclick handler
            this.button.removeAttribute('onclick');
            
            // Add new event listener with debouncing
            this.button.addEventListener('click', () => {
                this.handleButtonClick();
            });
        }

        // Session state manager events
        this.sessionStateManager.addEventListener('sessionConflict', (data) => {
            this.handleSessionConflict(data);
        });

        this.sessionStateManager.addEventListener('connectionLost', () => {
            this.handleConnectionLost();
        });

        this.sessionStateManager.addEventListener('connectionRestored', () => {
            this.handleConnectionRestored();
        });

        this.sessionStateManager.addEventListener('sessionDiscrepancy', (data) => {
            this.handleSessionDiscrepancy(data);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'L') {
                e.preventDefault();
                this.handleButtonClick();
            }
        });
    }

    /**
     * Handle button click with debouncing and state validation
     */
    handleButtonClick() {
        // Prevent rapid clicks
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            if (this.isLoading) {
                console.log('Button click ignored - operation in progress');
                return;
            }

            if (this.isActive) {
                this.stopSession();
            } else {
                this.startSession();
            }
        }, this.config.debounceDelay);
    }

    /**
     * Start a new learning session
     */
    async startSession() {
        try {
            this.setLoading(true);
            this.hideError();
            this.updateStatus('Starting learning session...');

            const response = await this.makeApiCall('/api/learning-sessions/start', {
                method: 'POST',
                body: JSON.stringify({
                    userId: 'default_user',
                    sessionData: {
                        startedFrom: 'web_interface',
                        userAgent: navigator.userAgent,
                        timestamp: new Date().toISOString()
                    }
                })
            });

            if (!response.success) {
                throw new Error(response.error?.message || 'Failed to start session');
            }

            // Update component state
            this.isActive = true;
            this.currentSessionId = response.data.sessionId;
            this.startTime = new Date(response.data.startTime);
            this.elapsedTime = 0;

            // Save state
            this.sessionStateManager.saveState({
                isActive: true,
                sessionId: this.currentSessionId,
                startTime: response.data.startTime,
                status: 'active'
            });

            // Update UI
            this.updateButtonForActiveState();
            this.updateStatus('Learning session active');
            this.startTimeUpdate();

            // Load today's stats
            console.log('Loading today\'s stats...');

            console.log('Learning session started:', response.data);

        } catch (error) {
            console.error('Failed to start session:', error);
            this.showError(error.message);
            this.addToRetryQueue('start');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Stop the current learning session
     */
    async stopSession() {
        try {
            this.setLoading(true);
            this.hideError();
            this.updateStatus('Stopping learning session...');

            if (!this.currentSessionId) {
                throw new Error('No active session found');
            }

            const response = await this.makeApiCall('/api/learning-sessions/stop', {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: this.currentSessionId,
                    userId: 'default_user'
                })
            });

            if (!response.success) {
                throw new Error(response.error?.message || 'Failed to stop session');
            }

            // Calculate final elapsed time
            const finalElapsed = response.data.durationSeconds;
            
            // Update component state
            this.isActive = false;
            this.currentSessionId = null;
            this.startTime = null;
            this.elapsedTime = 0;

            // Clear state
            this.sessionStateManager.clearState();

            // Update UI
            this.updateButtonForInactiveState();
            this.updateStatus(`Session completed: ${this.formatDuration(finalElapsed)}`);
            this.stopTimeUpdate();
            this.timeDisplay.textContent = '00:00:00';

            // Load updated stats
            console.log('Loading updated stats...');

            console.log('Learning session stopped:', response.data);

        } catch (error) {
            console.error('Failed to stop session:', error);
            this.showError(error.message);
            this.addToRetryQueue('stop');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Check for existing sessions on initialization
     */
    async checkForExistingSessions() {
        try {
            // Check local storage first
            const recoveryData = this.sessionStateManager.getRecoveryData();
            if (recoveryData && recoveryData.canRecover) {
                await this.handleSessionRecovery(recoveryData);
                return;
            }

            // Check server state
            const response = await this.makeApiCall('/api/learning-sessions/status', {
                method: 'GET'
            });

            if (response.success && response.hasActiveSession) {
                await this.restoreActiveSession(response.data);
            }

        } catch (error) {
            console.error('Error checking existing sessions:', error);
            // Don't show error to user for this check
        }
    }

    /**
     * Handle session recovery prompt
     */
    async handleSessionRecovery(recoveryData) {
        const message = recoveryData.isInterrupted 
            ? `You have an interrupted learning session from ${recoveryData.minutesAgo} minutes ago. Would you like to continue?`
            : `You have an active learning session. Would you like to continue?`;

        if (confirm(message)) {
            try {
                // Check if session is still active on server
                const response = await this.makeApiCall('/api/learning-sessions/status', {
                    method: 'GET'
                });

                if (response.success && response.hasActiveSession) {
                    await this.restoreActiveSession(response.data);
                } else {
                    // Session not found on server, clear local state
                    this.sessionStateManager.clearState();
                    this.updateStatus('Previous session expired');
                }
            } catch (error) {
                console.error('Error recovering session:', error);
                this.sessionStateManager.clearState();
            }
        } else {
            // User declined recovery, cancel the session
            try {
                await this.makeApiCall('/api/learning-sessions/cancel', {
                    method: 'POST',
                    body: JSON.stringify({
                        sessionId: recoveryData.sessionId,
                        reason: 'User declined recovery'
                    })
                });
            } catch (error) {
                console.error('Error cancelling session:', error);
            }
            
            this.sessionStateManager.clearState();
        }
    }

    /**
     * Restore an active session
     */
    async restoreActiveSession(sessionData) {
        this.isActive = true;
        this.currentSessionId = sessionData.sessionId;
        this.startTime = new Date(sessionData.startTime);
        this.elapsedTime = sessionData.elapsedSeconds;

        // Update state
        this.sessionStateManager.saveState({
            isActive: true,
            sessionId: this.currentSessionId,
            startTime: sessionData.startTime,
            status: 'active'
        });

        // Update UI
        this.updateButtonForActiveState();
        this.updateStatus('Learning session restored');
        this.startTimeUpdate();

        console.log('Active session restored:', sessionData);
    }

    /**
     * Load initial state and statistics
     */
    async loadInitialState() {
        console.log('Loading initial state...');
    }

    /**
     * Start the time update timer
     */
    startTimeUpdate() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }

        this.updateTimer = setInterval(() => {
            if (this.isActive && this.startTime) {
                const now = new Date();
                this.elapsedTime = Math.floor((now - this.startTime) / 1000);
                this.timeDisplay.textContent = this.formatDuration(this.elapsedTime);
            }
        }, this.config.updateInterval);
    }

    /**
     * Stop the time update timer
     */
    stopTimeUpdate() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
    }

    /**
     * Update button for active state
     */
    updateButtonForActiveState() {
        if (!this.button) return;
        
        this.button.classList.remove('bg-green-600', 'hover:bg-green-700');
        this.button.classList.add('bg-red-600', 'hover:bg-red-700');
        this.button.innerHTML = '<i data-lucide="square" class="w-5 h-5 inline mr-2"></i>Stop Learning';
        
        // Recreate lucide icons
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }
    }

    /**
     * Update button for inactive state
     */
    updateButtonForInactiveState() {
        if (!this.button) return;
        
        this.button.classList.remove('bg-red-600', 'hover:bg-red-700');
        this.button.classList.add('bg-green-600', 'hover:bg-green-700');
        this.button.innerHTML = '<i data-lucide="play" class="w-5 h-5 inline mr-2"></i>Start Learning';
        
        // Recreate lucide icons
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }
    }

    /**
     * Set loading state
     */
    setLoading(loading) {
        if (!this.button) return;
        
        this.isLoading = loading;
        this.button.disabled = loading;
        
        if (loading) {
            this.button.classList.add('opacity-75', 'cursor-not-allowed');
            // Add spinner to button
            this.button.innerHTML = `
                <svg class="w-5 h-5 animate-spin inline mr-2" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>Processing...
            `;
        } else {
            this.button.classList.remove('opacity-75', 'cursor-not-allowed');
            if (this.isActive) {
                this.updateButtonForActiveState();
            } else {
                this.updateButtonForInactiveState();
            }
        }
    }

    /**
     * Update status display
     */
    updateStatus(message) {
        console.log('Status:', message);
        // Could show in a toast notification or existing status area
    }

    /**
     * Show error message
     */
    showError(message) {
        console.error('Time Tracker Error:', message);
        // Show user-friendly error - could use existing notification system
        if (typeof showErrorMessage === 'function') {
            showErrorMessage(message);
        } else {
            alert(message); // Fallback
        }
    }

    /**
     * Hide error message
     */
    hideError() {
        // Clear any error displays
        console.log('Errors cleared');
    }

    /**
     * Add operation to retry queue
     */
    addToRetryQueue(operation) {
        this.retryQueue.push({
            operation,
            timestamp: Date.now()
        });
    }

    /**
     * Process retry queue
     */
    async processRetryQueue() {
        if (this.retryQueue.length === 0) return;

        const lastOperation = this.retryQueue[this.retryQueue.length - 1];
        this.retryQueue = []; // Clear queue

        if (lastOperation.operation === 'start') {
            await this.startSession();
        } else if (lastOperation.operation === 'stop') {
            await this.stopSession();
        }
    }

    /**
     * Handle session conflicts between tabs
     */
    handleSessionConflict(data) {
        if (this.isActive) {
            this.showError('Another tab has started a learning session. This session will be paused.');
            this.setActiveState(false);
        }
    }

    /**
     * Handle connection lost
     */
    handleConnectionLost() {
        this.updateStatus('Connection lost - working offline');
    }

    /**
     * Handle connection restored
     */
    handleConnectionRestored() {
        this.updateStatus('Connection restored');
        // Sync with server
        this.sessionStateManager.syncWithServer();
    }

    /**
     * Handle session discrepancies
     */
    handleSessionDiscrepancy(data) {
        console.warn('Session discrepancy detected:', data);
        
        if (data.type === 'local_active_server_inactive') {
            this.showError('Session mismatch detected. Please restart your session.');
            this.setActiveState(false);
        }
    }

    /**
     * Set active state without API call
     */
    setActiveState(active) {
        this.isActive = active;
        
        if (active) {
            this.updateButtonForActiveState();
            this.startTimeUpdate();
        } else {
            this.updateButtonForInactiveState();
            this.stopTimeUpdate();
            this.currentSessionId = null;
            this.startTime = null;
            this.elapsedTime = 0;
            this.timeDisplay.textContent = '00:00:00';
            this.sessionStateManager.clearState();
        }
    }

    /**
     * Make API call with timeout and error handling
     */
    async makeApiCall(endpoint, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.apiTimeout);

        try {
            const response = await fetch(endpoint, {
                ...options,
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();

        } catch (error) {
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                throw new Error('Request timed out. Please check your connection.');
            }
            
            throw error;
        }
    }

    /**
     * Format duration in seconds to HH:MM:SS
     */
    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;

        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    /**
     * Destroy the component and clean up resources
     */
    destroy() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.sessionStateManager.destroy();
        
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TimeTrackerComponent;
} else if (typeof window !== 'undefined') {
    window.TimeTrackerComponent = TimeTrackerComponent;
}
