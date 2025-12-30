/**
 * Ghost Text Integration Example
 * 
 * This module demonstrates how to integrate the Ghost Text feature
 * with your Ollama LLM for system-wide completions.
 */

const { ghostTextService } = require('./ghostTextService');
const ollama = require('ollama').default;

class GhostTextIntegration {
    constructor() {
        this.completionInProgress = false;
        this.currentCompletion = null;
        this.abortController = null;
        
        // Configurable options
        this.options = {
            model: 'llama3.2',  // Ollama model to use
            maxTokens: 50,      // Max tokens for completion
            temperature: 0.3,   // Lower = more deterministic
            debounceMs: 300,    // Handled in native code
            minContextLength: 5 // Minimum chars before suggesting
        };
    }

    /**
     * Initialize the ghost text system
     */
    async initialize() {
        try {
            // Initialize the native addon
            ghostTextService.initialize();
            
            // Set up event handlers
            ghostTextService.on('typingPaused', (data) => {
                this.onTypingPaused(data);
            });
            
            // Start monitoring
            ghostTextService.startMonitoring();
            
            console.log('Ghost Text system initialized');
            return true;
        } catch (err) {
            console.error('Failed to initialize Ghost Text:', err);
            return false;
        }
    }

    /**
     * Handle typing paused event - request completion from Ollama
     */
    async onTypingPaused(data) {
        // Cancel any in-progress completion
        this.cancelCompletion();
        
        // Validate context
        if (!data || !data.text || data.text.length < this.options.minContextLength) {
            ghostTextService.hideOverlay();
            return;
        }
        
        // Check if caret position is available
        if (!data.caret || !data.caret.valid) {
            ghostTextService.hideOverlay();
            return;
        }
        
        // Skip certain applications if needed
        const skipApps = ['explorer.exe', 'taskmgr.exe'];
        if (skipApps.includes(data.processName?.toLowerCase())) {
            return;
        }
        
        console.log(`Ghost Text: Context from ${data.processName}: "${data.text.slice(-30)}..."`);
        
        try {
            this.completionInProgress = true;
            
            // Build prompt for completion
            const prompt = this.buildCompletionPrompt(data.text);
            
            // Request completion from Ollama
            const completion = await this.getCompletion(prompt);
            
            if (completion && this.completionInProgress) {
                // Show the completion overlay
                const x = data.caret.x + (data.caret.width || 0);
                const y = data.caret.y;
                
                ghostTextService.updateOverlay(completion, x, y);
                this.currentCompletion = completion;
                
                console.log(`Ghost Text: Showing "${completion}"`);
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Ghost Text completion error:', err);
            }
        } finally {
            this.completionInProgress = false;
        }
    }

    /**
     * Build a prompt for the LLM to complete text
     */
    buildCompletionPrompt(context) {
        // Use a fill-in-the-middle style prompt
        return `Continue the following text naturally. Output ONLY the completion, nothing else. Be brief (1-2 words or short phrase).

Text: ${context}
Completion:`;
    }

    /**
     * Get completion from Ollama
     */
    async getCompletion(prompt) {
        this.abortController = new AbortController();
        
        const response = await ollama.generate({
            model: this.options.model,
            prompt: prompt,
            stream: false,
            options: {
                num_predict: this.options.maxTokens,
                temperature: this.options.temperature,
                stop: ['\n', '.', '!', '?']  // Stop at sentence boundaries
            }
        });
        
        if (response && response.response) {
            // Clean up the completion
            let completion = response.response.trim();
            
            // Remove any leading punctuation or whitespace
            completion = completion.replace(/^[\s\.,;:]+/, '');
            
            // Limit length
            if (completion.length > 100) {
                completion = completion.slice(0, 100) + '...';
            }
            
            return completion;
        }
        
        return null;
    }

    /**
     * Cancel current completion request
     */
    cancelCompletion() {
        this.completionInProgress = false;
        this.currentCompletion = null;
        
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        
        ghostTextService.hideOverlay();
    }

    /**
     * Accept the current completion (user pressed Tab, etc.)
     * Note: Inserting text into other apps requires SendInput
     */
    acceptCompletion() {
        if (!this.currentCompletion) {
            return false;
        }
        
        // TODO: Implement text insertion using SendInput
        // This would type out the completion in the focused app
        console.log(`Would insert: "${this.currentCompletion}"`);
        
        this.cancelCompletion();
        return true;
    }

    /**
     * Shutdown the ghost text system
     */
    shutdown() {
        this.cancelCompletion();
        ghostTextService.shutdown();
        console.log('Ghost Text system shutdown');
    }

    /**
     * Update options
     */
    setOptions(options) {
        this.options = { ...this.options, ...options };
    }
}

// Export singleton
const ghostTextIntegration = new GhostTextIntegration();

module.exports = {
    GhostTextIntegration,
    ghostTextIntegration
};
