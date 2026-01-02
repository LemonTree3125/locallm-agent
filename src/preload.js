const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer process via contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
  // ============================================
  // Ollama Status & Models
  // ============================================
  
  /**
   * Check if Ollama service is running
   * @returns {Promise<{running: boolean, error?: string}>}
   */
  pingOllama: () => ipcRenderer.invoke('ollama:ping'),

  /**
   * Get list of available models
   * @returns {Promise<{success: boolean, models: Array, error?: string}>}
   */
  getModels: () => ipcRenderer.invoke('ollama:models'),

  /**
   * Get detailed information about a specific model
   * @param {string} modelName - Name of the model
   * @returns {Promise<{success: boolean, info?: object, error?: string}>}
   */
  getModelInfo: (modelName) => ipcRenderer.invoke('ollama:model-info', modelName),

  /**
   * Get currently running/loaded models
   * @returns {Promise<{success: boolean, models: Array, error?: string}>}
   */
  getRunningModels: () => ipcRenderer.invoke('ollama:ps'),

  /**
   * Unload a model from VRAM
   * @param {string} modelName - Name of the model to unload
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  unloadModel: (modelName) => ipcRenderer.invoke('ollama:unload', modelName),

  // ============================================
  // Chat Functions
  // ============================================

  /**
   * Send a chat message with streaming response
   * @param {string} model - Model name to use
   * @param {Array<{role: string, content: string}>} messages - Conversation history
   * @param {object} options - Optional model parameters (temperature, etc.)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  chatStream: (model, messages, options = {}) => 
    ipcRenderer.invoke('ollama:chat-stream', { model, messages, options }),

  /**
   * Send a chat message without streaming (waits for full response)
   * @param {string} model - Model name to use
   * @param {Array<{role: string, content: string}>} messages - Conversation history
   * @param {object} options - Optional model parameters
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  chat: (model, messages, options = {}) => 
    ipcRenderer.invoke('ollama:chat', { model, messages, options }),

  /**
   * Listen for streaming response chunks
   * @param {function} callback - Called with each chunk {content: string, done: boolean}
   */
  onStreamChunk: (callback) => {
    ipcRenderer.on('ollama:stream-chunk', (_event, chunk) => callback(chunk));
  },

  /**
   * Remove stream chunk listener
   */
  removeStreamListener: () => {
    ipcRenderer.removeAllListeners('ollama:stream-chunk');
  },

  // ============================================
  // Advanced Functions
  // ============================================

  /**
   * Generate embeddings for text
   * @param {string} model - Embedding model to use
   * @param {string|Array<string>} input - Text to embed
   * @returns {Promise<{success: boolean, embeddings?: Array, error?: string}>}
   */
  embed: (model, input) => ipcRenderer.invoke('ollama:embed', { model, input }),

  /**
   * Abort current generation
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  abort: () => ipcRenderer.invoke('ollama:abort'),

  // ============================================
  // Chat Storage (File-based)
  // ============================================

  listChats: () => ipcRenderer.invoke('chats:list'),
  loadChat: (chatId) => ipcRenderer.invoke('chats:load', chatId),
  createChat: (model = null) => ipcRenderer.invoke('chats:create', { model }),
  updateChat: (chat) => ipcRenderer.invoke('chats:update', chat),
  renameChat: (chatId, title) => ipcRenderer.invoke('chats:rename', { chatId, title }),
  deleteChat: (chatId) => ipcRenderer.invoke('chats:delete', chatId),
  clearChats: () => ipcRenderer.invoke('chats:clear'),
  importChats: (legacyChats) => ipcRenderer.invoke('chats:import', legacyChats),

  // ============================================
  // AI Council - Dynamic Multi-Agent System
  // ============================================

  /**
   * Check AI Council service health and model availability
   * @returns {Promise<{success: boolean, healthy: boolean, requiredModels: object}>}
   */
  councilHealthCheck: () => ipcRenderer.invoke('council:health-check'),

  /**
   * Process a query using the AI Council workflow
   * @param {string} query - The user's query to process
   * @param {object} options - Optional configuration overrides
   * @returns {Promise<{success: boolean, finalResponse?: string, plan?: array, councilResults?: array}>}
   */
  councilProcess: (query, options = {}) => 
    ipcRenderer.invoke('council:process', { query, options }),

  /**
   * Get current AI Council configuration
   * @returns {Promise<{success: boolean, config: object}>}
   */
  councilGetConfig: () => ipcRenderer.invoke('council:get-config'),

  /**
   * Update AI Council configuration
   * @param {object} config - Configuration to update
   * @returns {Promise<{success: boolean, config: object}>}
   */
  councilSetConfig: (config) => ipcRenderer.invoke('council:set-config', config),

  /**
   * Listen for council phase start events
   * @param {function} callback - Called with phase data {phase, name, taskCount?}
   */
  onCouncilPhaseStart: (callback) => {
    ipcRenderer.on('council:phase-start', (_event, data) => callback(data));
  },

  /**
   * Listen for council phase complete events
   * @param {function} callback - Called with phase data {phase, result|results}
   */
  onCouncilPhaseComplete: (callback) => {
    ipcRenderer.on('council:phase-complete', (_event, data) => callback(data));
  },

  /**
   * Listen for council task start events
   * @param {function} callback - Called with task data {taskIndex, role, task_description}
   */
  onCouncilTaskStart: (callback) => {
    ipcRenderer.on('council:task-start', (_event, data) => callback(data));
  },

  /**
   * Listen for council task complete events
   * @param {function} callback - Called with task data {taskIndex, role, success, error?}
   */
  onCouncilTaskComplete: (callback) => {
    ipcRenderer.on('council:task-complete', (_event, data) => callback(data));
  },

  /**
   * Listen for council tool call events
   * @param {function} callback - Called with tool data {taskIndex, toolName, args}
   */
  onCouncilToolCall: (callback) => {
    ipcRenderer.on('council:tool-call', (_event, data) => callback(data));
  },

  /**
   * Remove all council event listeners
   */
  removeCouncilListeners: () => {
    ipcRenderer.removeAllListeners('council:phase-start');
    ipcRenderer.removeAllListeners('council:phase-complete');
    ipcRenderer.removeAllListeners('council:task-start');
    ipcRenderer.removeAllListeners('council:task-complete');
    ipcRenderer.removeAllListeners('council:tool-call');
  },
});
