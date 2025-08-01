/**
 * Session State Management for Time Tracking
 * Handles browser-side session persistence, recovery, and synchronization
 */

class SessionStateManager {
    constructor() {
        this.storageKey = 'learning_session_state';
        this.heartbeatInterval = 30000; // 30 seconds
        this.heartbeatTimer = null;
        this.syncInProgress = false;
        this.eventListeners = new Map();
        
        // Initialize state management
        this.initializeStateManagement();
        this.setupEventListeners();
    }

    /**
     * Initialize session state management
     */
    initializeStateManagement() {
        // Check for existing state on page load
        this.loadState();
        
        // Setup periodic heartbeat to sync with server
        this.startHeartbeat();
        
        // Setup visibility change handling
        this.setupVisibilityHandling();
    }

    /**
     * Setup event listeners for state management
     */
    setupEventListeners() {
        // Handle page unload (beforeunload)
        window.addEventListener('beforeunload', (event) => {
            this.handlePageUnload(event);
        });

        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            this.handleVisibilityChange();
        });

        // Handle storage changes (for multi-tab support)
        window.addEventListener('storage', (event) => {
            this.handleStorageChange(event);
        });

        // Handle online/offline status
        window.addEventListener('online', () => {
            this.handleOnlineStatusChange(true);
        });

        window.addEventListener('offline', () => {
            this.handleOnlineStatusChange(false);
        });
    }

    /**
     * Save session state to localStorage
     * @param {Object} sessionData - Session data to save
     */
    saveState(sessionData) {
        try {
            const stateData = {
                ...sessionData,
                lastUpdated: new Date().toISOString(),
                tabId: this.getTabId(),
                version: 1
            };

            localStorage.setItem(this.storageKey, JSON.stringify(stateData));
            
            // Trigger custom event for other components
            this.triggerEvent('sessionStateSaved', stateData);
            
        } catch (error) {
            console.error('Error saving session state:', error);
        }
    }

    /**
     * Load session state from localStorage
     * @returns {Object|null} Loaded session state or null
     */
    loadState() {
        try {
            const stateJson = localStorage.getItem(this.storageKey);
            if (!stateJson) return null;

            const stateData = JSON.parse(stateJson);
            
            // Validate state data
            if (!this.validateStateData(stateData)) {
                this.clearState();
                return null;
            }

            // Check if state is too old (more than 24 hours)
            const lastUpdated = new Date(stateData.lastUpdated);
            const now = new Date();
            const hoursDiff = (now - lastUpdated) / (1000 * 60 * 60);
            
            if (hoursDiff > 24) {
                console.warn('Session state is too old, clearing...');
                this.clearState();
                return null;
            }

            // Trigger custom event
            this.triggerEvent('sessionStateLoaded', stateData);
            
            return stateData;
            
        } catch (error) {
            console.error('Error loading session state:', error);
            this.clearState();
            return null;
        }
    }

    /**
     * Clear session state from localStorage
     */
    clearState() {
        try {
            localStorage.removeItem(this.storageKey);
            this.triggerEvent('sessionStateCleared');
        } catch (error) {
            console.error('Error clearing session state:', error);
        }
    }

    /**
     * Validate state data structure
     * @param {Object} stateData - State data to validate
     * @returns {boolean} Whether the state data is valid
     */
    validateStateData(stateData) {
        if (!stateData || typeof stateData !== 'object') return false;
        
        const requiredFields = ['lastUpdated', 'version'];
        return requiredFields.every(field => stateData[field] !== undefined);
    }

    /**
     * Handle page unload event
     * @param {Event} event - Beforeunload event
     */
    handlePageUnload(event) {
        const currentState = this.getCurrentSessionState();
        
        if (currentState && currentState.isActive) {
            // Save current state before unload
            this.saveState({
                ...currentState,
                status: 'interrupted',
                interruptedAt: new Date().toISOString()
            });

            // Show warning for active sessions
            const message = 'You have an active learning session. Are you sure you want to leave?';
            event.returnValue = message;
            return message;
        }
    }

    /**
     * Handle visibility change events
     */
    handleVisibilityChange() {
        if (document.hidden) {
            // Page became hidden - reduce heartbeat frequency
            this.pauseHeartbeat();
            this.triggerEvent('sessionPaused');
        } else {
            // Page became visible - resume normal operation
            this.resumeHeartbeat();
            this.syncWithServer();
            this.triggerEvent('sessionResumed');
        }
    }

    /**
     * Handle storage change events (multi-tab support)
     * @param {StorageEvent} event - Storage event
     */
    handleStorageChange(event) {
        if (event.key === this.storageKey) {
            // Another tab updated the session state
            const newState = event.newValue ? JSON.parse(event.newValue) : null;
            const oldState = event.oldValue ? JSON.parse(event.oldValue) : null;
            
            this.triggerEvent('sessionStateChanged', { newState, oldState });
            
            // Check for conflicts
            this.handleTabConflicts(newState, oldState);
        }
    }

    /**
     * Handle online/offline status changes
     * @param {boolean} isOnline - Whether the browser is online
     */
    handleOnlineStatusChange(isOnline) {
        if (isOnline) {
            // Back online - sync with server
            this.syncWithServer();
            this.triggerEvent('connectionRestored');
        } else {
            // Gone offline - switch to offline mode
            this.triggerEvent('connectionLost');
        }
    }

    /**
     * Handle conflicts between multiple tabs
     * @param {Object} newState - New state from another tab
     * @param {Object} oldState - Previous state
     */
    handleTabConflicts(newState, oldState) {
        const currentTabId = this.getTabId();
        
        if (newState && newState.tabId !== currentTabId && newState.isActive) {
            // Another tab has an active session
            this.triggerEvent('sessionConflict', {
                activeTab: newState.tabId,
                currentTab: currentTabId
            });
        }
    }

    /**
     * Start heartbeat for server synchronization
     */
    startHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }

        this.heartbeatTimer = setInterval(() => {
            this.performHeartbeat();
        }, this.heartbeatInterval);
    }

    /**
     * Pause heartbeat (when page is hidden)
     */
    pauseHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /**
     * Resume heartbeat (when page becomes visible)
     */
    resumeHeartbeat() {
        if (!this.heartbeatTimer) {
            this.startHeartbeat();
        }
    }

    /**
     * Perform heartbeat synchronization
     */
    async performHeartbeat() {
        if (this.syncInProgress) return;

        try {
            this.syncInProgress = true;
            await this.syncWithServer();
        } catch (error) {
            console.error('Heartbeat sync error:', error);
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Synchronize local state with server
     */
    async syncWithServer() {
        const localState = this.loadState();
        if (!localState || !localState.sessionId) return;

        try {
            // Check server state
            const response = await fetch('/api/learning-sessions/status', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Server sync failed: ${response.statusText}`);
            }

            const serverState = await response.json();
            
            // Compare states and resolve conflicts
            this.resolveStateConflicts(localState, serverState);
            
        } catch (error) {
            console.error('Server sync error:', error);
            // Handle offline scenario
            this.handleOfflineSync(localState);
        }
    }

    /**
     * Resolve conflicts between local and server state
     * @param {Object} localState - Local session state
     * @param {Object} serverState - Server session state
     */
    resolveStateConflicts(localState, serverState) {
        // If server has no active session but local does
        if (!serverState.data && localState.isActive) {
            this.triggerEvent('sessionDiscrepancy', {
                type: 'local_active_server_inactive',
                localState,
                serverState
            });
        }
        
        // If server has active session but local doesn't
        if (serverState.data && !localState.isActive) {
            this.triggerEvent('sessionDiscrepancy', {
                type: 'server_active_local_inactive',
                localState,
                serverState
            });
        }

        // Update local state if needed
        if (serverState.data) {
            this.saveState({
                ...localState,
                ...serverState.data,
                lastSyncedAt: new Date().toISOString()
            });
        }
    }

    /**
     * Handle offline synchronization
     * @param {Object} localState - Local session state
     */
    handleOfflineSync(localState) {
        // Mark state as pending sync
        this.saveState({
            ...localState,
            pendingSync: true,
            lastSyncAttempt: new Date().toISOString()
        });

        this.triggerEvent('syncPending', localState);
    }

    /**
     * Get current session state from the application
     * @returns {Object|null} Current session state
     */
    getCurrentSessionState() {
        // This should be implemented to get state from your main application
        // For now, return the stored state
        return this.loadState();
    }

    /**
     * Generate or get tab ID for multi-tab support
     * @returns {string} Unique tab identifier
     */
    getTabId() {
        if (!this.tabId) {
            // Try to get from sessionStorage first
            this.tabId = sessionStorage.getItem('tabId');
            
            if (!this.tabId) {
                // Generate new tab ID
                this.tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                sessionStorage.setItem('tabId', this.tabId);
            }
        }
        
        return this.tabId;
    }

    /**
     * Setup visibility handling for different browsers
     */
    setupVisibilityHandling() {
        // Handle different browser prefixes
        let hidden, visibilityChange;
        
        if (typeof document.hidden !== 'undefined') {
            hidden = 'hidden';
            visibilityChange = 'visibilitychange';
        } else if (typeof document.msHidden !== 'undefined') {
            hidden = 'msHidden';
            visibilityChange = 'msvisibilitychange';
        } else if (typeof document.webkitHidden !== 'undefined') {
            hidden = 'webkitHidden';
            visibilityChange = 'webkitvisibilitychange';
        }

        this.hiddenProperty = hidden;
        this.visibilityChangeEvent = visibilityChange;
    }

    /**
     * Add event listener for session state events
     * @param {string} eventName - Name of the event
     * @param {Function} callback - Event callback function
     */
    addEventListener(eventName, callback) {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, new Set());
        }
        
        this.eventListeners.get(eventName).add(callback);
    }

    /**
     * Remove event listener
     * @param {string} eventName - Name of the event
     * @param {Function} callback - Event callback function
     */
    removeEventListener(eventName, callback) {
        if (this.eventListeners.has(eventName)) {
            this.eventListeners.get(eventName).delete(callback);
        }
    }

    /**
     * Trigger custom event
     * @param {string} eventName - Name of the event
     * @param {*} data - Event data
     */
    triggerEvent(eventName, data = null) {
        if (this.eventListeners.has(eventName)) {
            this.eventListeners.get(eventName).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event listener for ${eventName}:`, error);
                }
            });
        }
    }

    /**
     * Check if there are pending sync operations
     * @returns {boolean} Whether there are pending syncs
     */
    hasPendingSync() {
        const state = this.loadState();
        return state && state.pendingSync === true;
    }

    /**
     * Mark sync as completed
     */
    markSyncCompleted() {
        const state = this.loadState();
        if (state) {
            this.saveState({
                ...state,
                pendingSync: false,
                lastSyncedAt: new Date().toISOString()
            });
        }
    }

    /**
     * Get session recovery data for user prompt
     * @returns {Object|null} Recovery data
     */
    getRecoveryData() {
        const state = this.loadState();
        if (!state || !state.sessionId) return null;

        const now = new Date();
        const lastUpdated = new Date(state.lastUpdated);
        const minutesAgo = Math.floor((now - lastUpdated) / (1000 * 60));

        return {
            sessionId: state.sessionId,
            startTime: state.startTime,
            lastUpdated: state.lastUpdated,
            minutesAgo: minutesAgo,
            canRecover: minutesAgo < 1440, // Less than 24 hours
            isInterrupted: state.status === 'interrupted'
        };
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }

        // Remove event listeners
        window.removeEventListener('beforeunload', this.handlePageUnload);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        window.removeEventListener('storage', this.handleStorageChange);
        window.removeEventListener('online', this.handleOnlineStatusChange);
        window.removeEventListener('offline', this.handleOnlineStatusChange);

        // Clear event listeners
        this.eventListeners.clear();
    }
}

// Export for use in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SessionStateManager;
} else if (typeof window !== 'undefined') {
    window.SessionStateManager = SessionStateManager;
}
