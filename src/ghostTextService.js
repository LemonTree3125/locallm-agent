/**
 * Ghost Text Native Addon - JavaScript Wrapper
 * 
 * This module provides a clean API for the native addon that handles
 * global keyboard monitoring and overlay rendering.
 */

const path = require('path');
const { EventEmitter } = require('events');

// Load the native addon
let ghostText = null;
try {
    ghostText = require('../native/build/Release/ghost_text.node');
} catch (err) {
    try {
        // Try debug build
        ghostText = require('../native/build/Debug/ghost_text.node');
    } catch (err2) {
        console.error('Failed to load ghost_text native addon:', err.message);
        console.error('Make sure to run: npm run build:native');
    }
}

class GhostTextService extends EventEmitter {
    constructor() {
        super();
        this._initialized = false;
        this._monitoring = false;
    }

    /**
     * Initialize the native addon
     * @returns {boolean} true if successful
     */
    initialize() {
        if (!ghostText) {
            throw new Error('Native addon not loaded');
        }

        if (this._initialized) {
            return true;
        }

        try {
            const result = ghostText.initialize();
            this._initialized = result;
            return result;
        } catch (err) {
            console.error('Failed to initialize ghost text:', err);
            throw err;
        }
    }

    /**
     * Start monitoring keyboard input
     * Emits 'typingPaused' event with context data when user stops typing
     */
    startMonitoring() {
        if (!this._initialized) {
            throw new Error('Not initialized. Call initialize() first.');
        }

        if (this._monitoring) {
            return true;
        }

        try {
            const result = ghostText.startMonitoring((event, data) => {
                this.emit(event, data);
            });
            
            this._monitoring = result;
            return result;
        } catch (err) {
            console.error('Failed to start monitoring:', err);
            throw err;
        }
    }

    /**
     * Stop monitoring keyboard input
     */
    stopMonitoring() {
        if (!this._monitoring) {
            return true;
        }

        try {
            const result = ghostText.stopMonitoring();
            this._monitoring = false;
            return result;
        } catch (err) {
            console.error('Failed to stop monitoring:', err);
            throw err;
        }
    }

    /**
     * Update the ghost text overlay
     * @param {string} text - The completion text to display
     * @param {number} x - Screen X coordinate
     * @param {number} y - Screen Y coordinate
     * @param {number} [fontSize=14] - Font size in points
     */
    updateOverlay(text, x, y, fontSize = 14) {
        if (!this._initialized) {
            throw new Error('Not initialized. Call initialize() first.');
        }

        try {
            return ghostText.updateOverlay(text, x, y, fontSize);
        } catch (err) {
            console.error('Failed to update overlay:', err);
            throw err;
        }
    }

    /**
     * Hide the ghost text overlay
     */
    hideOverlay() {
        if (!this._initialized) {
            return true;
        }

        try {
            return ghostText.hideOverlay();
        } catch (err) {
            console.error('Failed to hide overlay:', err);
            throw err;
        }
    }

    /**
     * Manually get the current text context
     * @param {number} [contextLength=100] - Maximum characters to retrieve
     * @returns {Object|null} Context object or null if unavailable
     */
    getTextContext(contextLength = 100) {
        if (!this._initialized) {
            throw new Error('Not initialized. Call initialize() first.');
        }

        try {
            return ghostText.getTextContext(contextLength);
        } catch (err) {
            console.error('Failed to get text context:', err);
            throw err;
        }
    }

    /**
     * Shutdown and cleanup
     */
    shutdown() {
        if (!this._initialized) {
            return true;
        }

        try {
            this.stopMonitoring();
            const result = ghostText.shutdown();
            this._initialized = false;
            return result;
        } catch (err) {
            console.error('Failed to shutdown:', err);
            throw err;
        }
    }

    /**
     * Check if initialized
     */
    get isInitialized() {
        return this._initialized;
    }

    /**
     * Check if monitoring
     */
    get isMonitoring() {
        return this._monitoring;
    }
}

// Export singleton instance
const ghostTextService = new GhostTextService();

module.exports = {
    GhostTextService,
    ghostTextService
};
