// ============================================
// DOM Elements
// ============================================
const elements = {
  // Sidebar
  modelSelect: document.getElementById('model-select'),
  modelSelectorBtn: document.getElementById('model-selector-btn'),
  modelSelectorTitle: document.getElementById('model-selector-title'),
  modelSelectorDesc: document.getElementById('model-selector-desc'),
  modelSelectDropdown: document.getElementById('model-select-dropdown'),
  newChatBtn: document.getElementById('new-chat-btn'),
  ollamaStatus: document.getElementById('ollama-status'),
  modelInfoSection: document.getElementById('model-info-section'),
  modelInfoContent: document.getElementById('model-info-content'),
  modelStatus: document.getElementById('model-status'),
  unloadModelBtn: document.getElementById('unload-model-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  helpBtn: document.getElementById('help-btn'),
  chatList: document.getElementById('chat-list'),
  clearAllChatsBtn: document.getElementById('clear-all-chats-btn'),
  
  // Chat
  messages: document.getElementById('messages'),
  chatInput: document.getElementById('chat-input'),
  sendBtn: document.getElementById('send-btn'),
  stopBtn: document.getElementById('stop-btn'),
  sendIcon: document.getElementById('send-icon'),
  loadingIcon: document.getElementById('loading-icon'),
  charCount: document.getElementById('char-count'),
  generationStats: document.getElementById('generation-stats'),
  
  // Attachments (Multimodal)
  attachBtn: document.getElementById('attach-btn'),
  fileInput: document.getElementById('file-input'),
  attachmentPreview: document.getElementById('attachment-preview'),
  attachmentList: document.getElementById('attachment-list'),
  visionIndicator: document.getElementById('vision-indicator'),
  
  // Warnings
  noModelsWarning: document.getElementById('no-models-warning'),
  refreshModelsBtn: document.getElementById('refresh-models-btn'),
  
  // Modals
  helpModal: document.getElementById('help-modal'),
  closeHelpModal: document.getElementById('close-help-modal'),
  settingsModal: document.getElementById('settings-modal'),
  closeSettingsModal: document.getElementById('close-settings-modal'),
  modelSelectList: document.getElementById('model-select-list'),
  resetSettingsBtn: document.getElementById('reset-settings-btn'),
  applySettingsBtn: document.getElementById('apply-settings-btn'),
};

let isModelDropdownOpen = false;

function closeModelSelectDropdown({ focusButton = false, focusChatInput = false } = {}) {
  if (!elements.modelSelectDropdown) return;
  elements.modelSelectDropdown.style.display = 'none';
  isModelDropdownOpen = false;
  if (elements.modelSelectorBtn) {
    elements.modelSelectorBtn.setAttribute('aria-expanded', 'false');
    if (focusButton) {
      elements.modelSelectorBtn.focus();
    } else if (focusChatInput && !elements.chatInput.disabled) {
      elements.chatInput.focus();
    }
  }
}

function openModelSelectDropdown() {
  if (elements.modelSelectorBtn.disabled) return;
  renderModelSelectList(state.models);
  elements.modelSelectDropdown.style.display = 'block';
  isModelDropdownOpen = true;
  elements.modelSelectorBtn.setAttribute('aria-expanded', 'true');
}

function toggleModelSelectDropdown() {
  if (isModelDropdownOpen) {
    closeModelSelectDropdown({ focusButton: true });
  } else {
    openModelSelectDropdown();
  }
}

function handleDocumentClickForModelDropdown(e) {
  if (!isModelDropdownOpen) return;
  const clickedInside = elements.modelSelectDropdown?.contains(e.target) || elements.modelSelectorBtn?.contains(e.target);
  // Check if clicking on the chat input - don't interfere with its focus
  const clickedChatInput = elements.chatInput?.contains(e.target);
  if (!clickedInside) {
    closeModelSelectDropdown({ focusChatInput: !clickedChatInput });
  }
}

// ============================================
// Application State
// ============================================
const state = {
  isOllamaRunning: false,
  currentModel: null,
  models: [],
  conversationHistory: [],
  isGenerating: false,
  currentChatId: null,
  savedChats: [],
  modelLoaded: false,
  modelStatusInterval: null,
  // Track active generations by chat ID
  activeGenerations: new Map(), // chatId -> { fullResponse, fullThinking, assistantDiv }
  // Multimodal attachments
  pendingAttachments: [], // Array of { base64, mimeType, name } for current message
  isVisionModel: false, // Whether current model supports vision/multimodal
};

// ============================================
// Vision-capable models (multimodal)
// ============================================
const VISION_MODEL_PATTERNS = [
  'llava',
  'bakllava', 
  'gemma3', // gemma3 supports vision
  'moondream',
  'minicpm-v',
  'llama3.2-vision',
  'granite3.2-vision',
];

// ============================================
// Model Abilities (for the Model Info section)
// ============================================
// Per UI spec:
// - Thinking: Deepseek, Qwen
// - Tools: Qwen
// - Vision: Gemma
const THINKING_MODEL_PATTERNS = ['deepseek', 'qwen'];
const TOOLS_MODEL_PATTERNS = ['qwen'];
const ABILITY_VISION_MODEL_PATTERNS = ['gemma'];

function isThinkingModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return false;
  const lowerName = modelName.toLowerCase();
  return THINKING_MODEL_PATTERNS.some(pattern => lowerName.includes(pattern));
}

function isToolsModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return false;
  const lowerName = modelName.toLowerCase();
  return TOOLS_MODEL_PATTERNS.some(pattern => lowerName.includes(pattern));
}

function isVisionAbilityModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return false;
  const lowerName = modelName.toLowerCase();
  return ABILITY_VISION_MODEL_PATTERNS.some(pattern => lowerName.includes(pattern));
}

// ============================================
// Default Model Options
// ============================================
const defaultOptions = {
  temperature: 0.8,
  num_ctx: 4096,
  num_predict: -1,
  top_p: 0.9,
  top_k: 40,
  repeat_penalty: 1.1,
  repeat_last_n: 64,
  seed: 0,
  mirostat: 0,
  mirostat_tau: 5.0,
  mirostat_eta: 0.1,
  tfs_z: 1.0,
  num_gpu: -1,
  num_thread: 0,
  keep_alive: 5, // minutes, converted to string like "5m" when sent
  think: false, // Enable thinking mode for reasoning models (DeepSeek R1, Qwen3, etc.)
};

// Current model options (copy of defaults)
let modelOptions = { ...defaultOptions };

// Persist settings locally (separate from chat storage), per model
const SETTINGS_STORE_KEY = 'locallm-model-options-by-model-v1';
const SETTINGS_LEGACY_KEY = 'locallm-model-options-v1';
const LAST_MODEL_KEY = 'locallm-last-model-v1';
const SETTINGS_GLOBAL_KEY = '__global__';

function sanitizeModelOptionsFromStored(parsed) {
  const next = { ...defaultOptions };
  if (!parsed || typeof parsed !== 'object') return next;

  for (const [key, defaultValue] of Object.entries(defaultOptions)) {
    if (!(key in parsed)) continue;
    const storedValue = parsed[key];

    if (typeof defaultValue === 'boolean') {
      next[key] = storedValue === true;
    } else if (typeof defaultValue === 'number') {
      const n = typeof storedValue === 'number' ? storedValue : parseFloat(storedValue);
      if (!Number.isNaN(n)) next[key] = n;
    } else {
      next[key] = storedValue;
    }
  }

  return next;
}

function readSettingsStore() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.warn('Failed to read settings store:', e);
    return {};
  }
}

function writeSettingsStore(store) {
  try {
    localStorage.setItem(SETTINGS_STORE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('Failed to write settings store:', e);
  }
}

function migrateLegacySettingsIfNeeded() {
  try {
    const legacyRaw = localStorage.getItem(SETTINGS_LEGACY_KEY);
    if (!legacyRaw) return;
    const store = readSettingsStore();
    // Only migrate if there is no global fallback already.
    if (store && typeof store === 'object' && store[SETTINGS_GLOBAL_KEY]) return;

    const legacyParsed = JSON.parse(legacyRaw);
    const nextStore = { ...(store || {}) };
    nextStore[SETTINGS_GLOBAL_KEY] = legacyParsed;
    writeSettingsStore(nextStore);
  } catch (e) {
    console.warn('Failed to migrate legacy settings:', e);
  }
}

function getLastSelectedModelFromStorage() {
  try {
    const v = localStorage.getItem(LAST_MODEL_KEY);
    return typeof v === 'string' && v.trim() ? v : null;
  } catch {
    return null;
  }
}

function setLastSelectedModelInStorage(modelName) {
  try {
    if (!modelName) return;
    localStorage.setItem(LAST_MODEL_KEY, modelName);
  } catch {
    // ignore
  }
}

function loadSettingsForModel(modelName) {
  try {
    const store = readSettingsStore();
    const rawOptions =
      (modelName && store && typeof store === 'object' ? store[modelName] : null) ||
      (store && typeof store === 'object' ? store[SETTINGS_GLOBAL_KEY] : null) ||
      null;
    modelOptions = sanitizeModelOptionsFromStored(rawOptions);
  } catch (e) {
    console.warn('Failed to load settings for model:', modelName, e);
    modelOptions = { ...defaultOptions };
  }
}

function saveSettingsForModel(modelName) {
  try {
    const store = readSettingsStore();
    const nextStore = { ...(store || {}) };
    const key = modelName || SETTINGS_GLOBAL_KEY;
    nextStore[key] = { ...modelOptions };
    writeSettingsStore(nextStore);
  } catch (e) {
    console.warn('Failed to save settings for model:', modelName, e);
  }
}

// One-time migration + load a safe default (global fallback) before we know the model.
migrateLegacySettingsIfNeeded();
loadSettingsForModel(null);

// ============================================
// Chat Persistence
// ============================================
const STORAGE_KEY = 'locallm-saved-chats';

// Cache only full message history for a handful of chats.
// Everything else stays as lightweight summaries in `state.savedChats`.
const MAX_CACHED_CHATS = 5;
const chatCache = new Map(); // chatId -> { chat, lastAccess }

function getCachedChat(chatId) {
  const entry = chatCache.get(chatId);
  if (!entry) return null;
  entry.lastAccess = Date.now();
  return entry.chat;
}

function setCachedChat(chat) {
  if (!chat?.id) return;
  chatCache.set(chat.id, { chat, lastAccess: Date.now() });
  pruneChatCache();
}

function pruneChatCache() {
  const pinnedIds = new Set([
    state.currentChatId,
    ...Array.from(state.activeGenerations.keys()),
  ].filter(Boolean));

  if (chatCache.size <= MAX_CACHED_CHATS) return;

  const entries = Array.from(chatCache.entries())
    .map(([id, v]) => ({ id, lastAccess: v.lastAccess }))
    .sort((a, b) => a.lastAccess - b.lastAccess);

  for (const { id } of entries) {
    if (chatCache.size <= MAX_CACHED_CHATS) break;
    if (pinnedIds.has(id)) continue;
    chatCache.delete(id);
  }
}

function upsertChatSummary(summary) {
  if (!summary?.id) return;
  const idx = state.savedChats.findIndex(c => c.id === summary.id);
  if (idx === -1) {
    state.savedChats.unshift(summary);
  } else {
    state.savedChats[idx] = { ...state.savedChats[idx], ...summary };
  }
  // Keep newest first
  state.savedChats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function loadSavedChats() {
  // Load summaries from disk (main process)
  try {
    const result = await window.electronAPI.listChats();
    state.savedChats = result?.success ? (result.chats || []) : [];

    // One-time migration from legacy localStorage if disk store is empty.
    if (state.savedChats.length === 0) {
      const legacyRaw = localStorage.getItem(STORAGE_KEY);
      if (legacyRaw) {
        try {
          const legacy = JSON.parse(legacyRaw);
          if (Array.isArray(legacy) && legacy.length > 0) {
            const importResult = await window.electronAPI.importChats(legacy);
            if (importResult?.success) {
              state.savedChats = importResult.chats || [];
              localStorage.removeItem(STORAGE_KEY);
            }
          }
        } catch (e) {
          console.warn('Legacy chat migration failed:', e);
        }
      }
    }
  } catch (e) {
    console.error('Failed to load saved chats:', e);
    state.savedChats = [];
  }
}

async function getOrLoadChat(chatId) {
  const cached = getCachedChat(chatId);
  if (cached) return cached;

  const result = await window.electronAPI.loadChat(chatId);
  if (!result?.success || !result.chat) {
    console.error('Failed to load chat:', result?.error);
    return null;
  }
  setCachedChat(result.chat);
  return result.chat;
}

async function persistChat(chat) {
  if (!chat?.id) return;
  try {
    const result = await window.electronAPI.updateChat(chat);
    if (result?.success && result.summary) {
      upsertChatSummary(result.summary);
    }
  } catch (e) {
    console.error('Failed to persist chat:', e);
  }
}

async function createNewChat() {
  const result = await window.electronAPI.createChat(state.currentModel);
  if (!result?.success || !result.chat) {
    throw new Error(result?.error || 'Failed to create chat');
  }

  setCachedChat(result.chat);
  if (result.summary) {
    upsertChatSummary(result.summary);
  } else {
    upsertChatSummary({
      id: result.chat.id,
      title: result.chat.title,
      model: result.chat.model,
      createdAt: result.chat.createdAt,
      updatedAt: result.chat.updatedAt,
      messageCount: result.chat.messages?.length || 0,
    });
  }
  return result.chat;
}

async function updateCurrentChat() {
  if (!state.currentChatId) return;
  const chat = await getOrLoadChat(state.currentChatId);
  if (!chat) return;

  chat.messages = [...state.conversationHistory];
  chat.model = state.currentModel;
  chat.updatedAt = new Date().toISOString();

  // Update title from first user message if still "New Chat"
  if (chat.title === 'New Chat' && chat.messages.length > 0) {
    const firstUserMsg = chat.messages.find(m => m.role === 'user');
    if (firstUserMsg) {
      chat.title = firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
    }
  }

  setCachedChat(chat);
  await persistChat(chat);
  renderChatList();
}

async function loadChat(chatId) {
  const chat = await getOrLoadChat(chatId);
  if (!chat) return;
  
  // Allow switching even during generation - the generation will continue in background
  state.currentChatId = chatId;
  state.conversationHistory = [...chat.messages];
  
  // Set model if available
  if (chat.model && state.models.some(m => m.name === chat.model)) {
    state.currentModel = chat.model;
    elements.modelSelect.value = chat.model;
    setLastSelectedModelInStorage(chat.model);
    loadSettingsForModel(chat.model);
    if (elements.settingsModal && elements.settingsModal.style.display !== 'none') {
      loadSettingsToUI();
    }
    const model = state.models.find(m => m.name === chat.model);
    if (model) {
      updateModelInfo(model);
      updateModelSelectorUI(model);
      checkModelStatus();
    }
  }
  
  // Update vision UI for current model
  updateVisionUI();
  
  // Render messages
  renderChatMessages();
  renderChatList();
  
  // Update UI and state based on whether THIS chat has an active generation
  const hasActiveGeneration = state.activeGenerations.has(chatId);
  state.isGenerating = hasActiveGeneration;
  updateGeneratingUI(hasActiveGeneration);
}

async function deleteChat(chatId) {
  const index = state.savedChats.findIndex(c => c.id === chatId);
  if (index === -1) return;

  try {
    const result = await window.electronAPI.deleteChat(chatId);
    if (!result?.success) {
      showNotification(`Failed to delete chat: ${result?.error || 'Unknown error'}`);
      return;
    }
  } catch (e) {
    showNotification(`Failed to delete chat: ${e.message}`);
    return;
  }

  state.savedChats.splice(index, 1);
  chatCache.delete(chatId);
  
  // If deleted current chat, start new one
  if (state.currentChatId === chatId) {
    if (state.savedChats.length > 0) {
      await loadChat(state.savedChats[0].id);
    } else {
      await startNewChat();
    }
  } else {
    renderChatList();
  }
}

async function clearAllChats() {
  if (!confirm('Are you sure you want to delete all conversations? This cannot be undone.')) {
    return;
  }
  try {
    const result = await window.electronAPI.clearChats();
    if (!result?.success) {
      showNotification(`Failed to clear chats: ${result?.error || 'Unknown error'}`);
      return;
    }
  } catch (e) {
    showNotification(`Failed to clear chats: ${e.message}`);
    return;
  }

  state.savedChats = [];
  chatCache.clear();
  await startNewChat();
}

async function renameChat(chatId, newTitle) {
  const chatSummary = state.savedChats.find(c => c.id === chatId);
  if (!chatSummary) return;

  const title = (newTitle || '').trim() || 'Untitled Chat';
  try {
    const result = await window.electronAPI.renameChat(chatId, title);
    if (!result?.success) {
      showNotification(`Failed to rename chat: ${result?.error || 'Unknown error'}`);
      return;
    }
  } catch (e) {
    showNotification(`Failed to rename chat: ${e.message}`);
    return;
  }

  // Update cached full chat if present
  const cached = getCachedChat(chatId);
  if (cached) {
    cached.title = title;
    cached.updatedAt = new Date().toISOString();
    setCachedChat(cached);
  }

  chatSummary.title = title;
  chatSummary.updatedAt = new Date().toISOString();
  renderChatList();
}

function renderChatList() {
  if (state.savedChats.length === 0) {
    elements.chatList.innerHTML = '<div class="chat-list-empty">No conversations yet</div>';
    return;
  }
  
  elements.chatList.innerHTML = state.savedChats.map(chat => {
    const isActive = chat.id === state.currentChatId;
    const isGenerating = state.activeGenerations.has(chat.id);
    const date = new Date(chat.updatedAt);
    const timeStr = formatRelativeTime(date);
    const msgCount = typeof chat.messageCount === 'number' ? chat.messageCount : (chat.messages?.length || 0);
    const generatingIndicator = isGenerating ? '<span class=\"chat-generating-indicator\">●</span>' : '';
    
    return `
      <div class="chat-item ${isActive ? 'active' : ''} ${isGenerating ? 'generating' : ''}" data-chat-id="${chat.id}">
        <div class="chat-item-content" onclick="window.loadChat('${chat.id}')">
          <div class="chat-item-title">${generatingIndicator}${escapeHtml(chat.title)}</div>
          <div class="chat-item-meta">${isGenerating ? 'Generating...' : timeStr} · ${msgCount} messages</div>
        </div>
        <div class="chat-item-actions">
          <button class="chat-item-btn" onclick="window.promptRenameChat('${chat.id}')" title="Rename">✏️</button>
          <button class="chat-item-btn delete" onclick="window.deleteChat('${chat.id}')" title="Delete">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function formatRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function renderChatMessages() {
  // Clear messages area
  elements.messages.innerHTML = '';
  
  if (state.conversationHistory.length === 0) {
    elements.messages.innerHTML = `
      <div class="welcome-message">
        <h2>Welcome to LocalLM Agent</h2>
        <p>Select a model and start chatting with your local AI.</p>
      </div>
    `;
    return;
  }
  
  // Render each message
  for (const msg of state.conversationHistory) {
    // Pass attachments for displaying images in user messages
    appendMessage(msg.role, msg.content, false, { 
      model: msg.model,
      attachments: msg.attachments,
    });
  }
  
  // If this chat has an active generation, show the in-progress response
  const genState = state.activeGenerations.get(state.currentChatId);
  if (genState) {
    // Re-create the assistant message div for the active generation
    genState.assistantDiv = appendMessage('assistant', '', true, { model: genState.model });
    const displayContent = buildDisplayContent(genState.fullThinking, genState.fullResponse, true);
    updateMessageContent(genState.assistantDiv, displayContent, false);
  }
}

// Expose functions to window for onclick handlers
window.loadChat = loadChat;
window.deleteChat = deleteChat;
window.promptRenameChat = function(chatId) {
  const chat = state.savedChats.find(c => c.id === chatId);
  if (!chat) return;
  const newTitle = prompt('Enter new name:', chat.title);
  if (newTitle !== null) {
    void renameChat(chatId, newTitle.trim());
  }
};

// Settings element mappings
const settingsMap = {
  temperature: { range: 'setting-temperature', value: 'setting-temperature-value' },
  num_ctx: { range: 'setting-num-ctx', value: 'setting-num-ctx-value' },
  num_predict: { range: 'setting-num-predict', value: 'setting-num-predict-value' },
  top_p: { range: 'setting-top-p', value: 'setting-top-p-value' },
  top_k: { range: 'setting-top-k', value: 'setting-top-k-value' },
  repeat_penalty: { range: 'setting-repeat-penalty', value: 'setting-repeat-penalty-value' },
  repeat_last_n: { range: 'setting-repeat-last-n', value: 'setting-repeat-last-n-value' },
  seed: { value: 'setting-seed-value' },
  mirostat: { select: 'setting-mirostat' },
  mirostat_tau: { range: 'setting-mirostat-tau', value: 'setting-mirostat-tau-value' },
  mirostat_eta: { range: 'setting-mirostat-eta', value: 'setting-mirostat-eta-value' },
  tfs_z: { range: 'setting-tfs-z', value: 'setting-tfs-z-value' },
  num_gpu: { range: 'setting-num-gpu', value: 'setting-num-gpu-value' },
  num_thread: { range: 'setting-num-thread', value: 'setting-num-thread-value' },
  keep_alive: { select: 'setting-keep-alive' },
  think: { checkbox: 'setting-think' },
};

// ============================================
// Multimodal / Vision Support Functions
// ============================================

/**
 * Check if a model name indicates vision/multimodal capability
 */
function isVisionCapableModel(modelName) {
  if (!modelName) return false;
  const lowerName = modelName.toLowerCase();
  return VISION_MODEL_PATTERNS.some(pattern => lowerName.includes(pattern));
}

/**
 * Update vision-related UI based on current model
 */
function updateVisionUI() {
  state.isVisionModel = isVisionCapableModel(state.currentModel);
  
  // Enable/disable attach button
  if (elements.attachBtn) {
    elements.attachBtn.disabled = !state.isVisionModel || state.isGenerating;
    elements.attachBtn.title = state.isVisionModel 
      ? 'Attach image' 
      : 'Attach image (vision models only)';
  }
  
  // Show/hide vision indicator
  if (elements.visionIndicator) {
    elements.visionIndicator.style.display = state.isVisionModel ? 'inline' : 'none';
  }
  
  // Clear attachments if switching to non-vision model
  if (!state.isVisionModel && state.pendingAttachments.length > 0) {
    clearAttachments();
  }
}

/**
 * Convert a File to base64
 */
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Extract base64 data (remove data:mime;base64, prefix)
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Handle file selection from file input
 */
async function handleFileSelect(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;
  
  for (const file of files) {
    await addAttachment(file);
  }
  
  // Reset file input so same file can be selected again
  event.target.value = '';
}

/**
 * Handle drag over event
 */
function handleDragOver(event) {
  if (!state.isVisionModel) return;
  
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.add('drag-over');
}

/**
 * Handle drag leave event
 */
function handleDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-over');
}

/**
 * Handle drop event
 */
async function handleDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-over');
  
  if (!state.isVisionModel) {
    showNotification('Current model does not support images. Try gemma3:12b or llava.');
    return;
  }
  
  const files = event.dataTransfer.files;
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      await addAttachment(file);
    }
  }
}

/**
 * Handle paste event for images
 */
async function handlePaste(event) {
  if (!state.isVisionModel) return;
  
  const items = event.clipboardData?.items;
  if (!items) return;
  
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      event.preventDefault();
      const file = item.getAsFile();
      if (file) {
        await addAttachment(file);
      }
    }
  }
}

/**
 * Add an attachment (image file)
 */
async function addAttachment(file) {
  if (!file.type.startsWith('image/')) {
    showNotification('Only image files are supported');
    return;
  }
  
  // Limit file size (10MB)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    showNotification('Image file too large (max 10MB)');
    return;
  }
  
  // Limit number of attachments
  const MAX_ATTACHMENTS = 5;
  if (state.pendingAttachments.length >= MAX_ATTACHMENTS) {
    showNotification(`Maximum ${MAX_ATTACHMENTS} images allowed per message`);
    return;
  }
  
  try {
    const base64 = await fileToBase64(file);
    const attachment = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      base64,
      mimeType: file.type,
      name: file.name,
      size: file.size,
    };
    
    state.pendingAttachments.push(attachment);
    renderAttachmentPreviews();
  } catch (error) {
    console.error('Failed to process image:', error);
    showNotification('Failed to process image');
  }
}

/**
 * Remove an attachment by ID
 */
function removeAttachment(attachmentId) {
  state.pendingAttachments = state.pendingAttachments.filter(a => a.id !== attachmentId);
  renderAttachmentPreviews();
}

/**
 * Clear all pending attachments
 */
function clearAttachments() {
  state.pendingAttachments = [];
  renderAttachmentPreviews();
}

/**
 * Render attachment preview thumbnails
 */
function renderAttachmentPreviews() {
  if (!elements.attachmentPreview || !elements.attachmentList) return;
  
  if (state.pendingAttachments.length === 0) {
    elements.attachmentPreview.style.display = 'none';
    elements.attachmentList.innerHTML = '';
    return;
  }
  
  elements.attachmentPreview.style.display = 'flex';
  elements.attachmentList.innerHTML = state.pendingAttachments.map(att => `
    <div class="attachment-item" data-attachment-id="${att.id}">
      <img src="data:${att.mimeType};base64,${att.base64}" alt="${escapeHtml(att.name)}" />
      <button class="attachment-remove" onclick="window.removeAttachment('${att.id}')" title="Remove">&times;</button>
      <div class="attachment-name">${escapeHtml(att.name.slice(0, 15))}${att.name.length > 15 ? '...' : ''}</div>
    </div>
  `).join('');
}

// Expose attachment removal to window for onclick handlers
window.removeAttachment = removeAttachment;

// ============================================
// Initialization
// ============================================
async function init() {
  setupEventListeners();
  await loadSavedChats();
  await checkOllamaStatus();
  
  if (state.isOllamaRunning) {
    await loadModels();
    startModelStatusChecking();
  }
  
  // Load most recent chat or create new one
  if (state.savedChats.length > 0) {
    await loadChat(state.savedChats[0].id);
  } else {
    await startNewChat();
  }
}

function setupEventListeners() {
  // Send message
  elements.sendBtn.addEventListener('click', sendMessage);
  elements.chatInput.addEventListener('keydown', handleInputKeydown);
  elements.chatInput.addEventListener('input', handleInputChange);
  
  // Model selection
  elements.modelSelect.addEventListener('change', handleModelChange);
  elements.modelSelectorBtn.addEventListener('click', toggleModelSelectDropdown);
  document.addEventListener('click', handleDocumentClickForModelDropdown);
  elements.modelSelectList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-model-name]');
    if (!btn) return;
    const modelName = btn.getAttribute('data-model-name');
    selectModelByName(modelName);
  });
  
  // New chat
  elements.newChatBtn.addEventListener('click', startNewChat);
  
  // Clear all chats
  elements.clearAllChatsBtn.addEventListener('click', clearAllChats);
  
  // Stop generation
  elements.stopBtn.addEventListener('click', stopGeneration);
  
  // Unload model from VRAM
  elements.unloadModelBtn.addEventListener('click', unloadModel);
  
  // Refresh models
  elements.refreshModelsBtn.addEventListener('click', refreshModels);
  
  // Help modal
  elements.helpBtn.addEventListener('click', () => showModal(elements.helpModal));
  elements.closeHelpModal.addEventListener('click', () => hideModal(elements.helpModal));
  elements.helpModal.addEventListener('click', (e) => {
    if (e.target === elements.helpModal) hideModal(elements.helpModal);
  });
  
  // Settings modal
  elements.settingsBtn.addEventListener('click', () => {
    // Ensure we show the saved settings for the active model.
    loadSettingsForModel(state.currentModel);
    loadSettingsToUI();
    showModal(elements.settingsModal);
  });
  elements.closeSettingsModal.addEventListener('click', () => hideModal(elements.settingsModal));
  elements.settingsModal.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) hideModal(elements.settingsModal);
  });
  elements.resetSettingsBtn.addEventListener('click', resetSettings);
  elements.applySettingsBtn.addEventListener('click', applySettings);
  
  // Setup settings input synchronization
  setupSettingsSync();
  
  // Keyboard shortcuts
  document.addEventListener('keydown', handleGlobalKeydown);
  
  // Multimodal attachments
  if (elements.attachBtn && elements.fileInput) {
    elements.attachBtn.addEventListener('click', () => elements.fileInput.click());
    elements.fileInput.addEventListener('change', handleFileSelect);
  }
  
  // Drag and drop for images
  const inputContainer = document.querySelector('.input-container');
  if (inputContainer) {
    inputContainer.addEventListener('dragover', handleDragOver);
    inputContainer.addEventListener('dragleave', handleDragLeave);
    inputContainer.addEventListener('drop', handleDrop);
  }
  
  // Also support drag/drop on the whole chat area
  const chatContainer = document.querySelector('.chat-container');
  if (chatContainer) {
    chatContainer.addEventListener('dragover', handleDragOver);
    chatContainer.addEventListener('dragleave', handleDragLeave);
    chatContainer.addEventListener('drop', handleDrop);
  }
  
  // Paste images from clipboard
  elements.chatInput.addEventListener('paste', handlePaste);
  
  // Focus chat input when clicking on the messages wrapper (if no text is selected)
  const messagesWrapper = document.querySelector('.messages-wrapper');
  if (messagesWrapper) {
    messagesWrapper.addEventListener('click', (e) => {
      // Don't steal focus if user clicked on an interactive element or is selecting text
      const selection = window.getSelection();
      const hasTextSelection = selection && selection.toString().length > 0;
      const clickedInteractive = e.target.closest('button, a, code, .code-block-wrapper');
      
      if (!hasTextSelection && !clickedInteractive && !elements.chatInput.disabled) {
        // Small delay to allow any selection to complete
        setTimeout(() => {
          const currentSelection = window.getSelection();
          if (!currentSelection || currentSelection.toString().length === 0) {
            elements.chatInput.focus();
          }
        }, 10);
      }
    });
  }
}

function getModelDescriptor(model) {
  if (!model) return '';
  const parts = [];
  if (typeof model.size === 'number') {
    const sizeGB = (model.size / 1e9).toFixed(1);
    parts.push(`${sizeGB} GB`);
  }
  return parts.join(' • ');
}

function updateModelSelectorUI(model) {
  if (!elements.modelSelectorTitle || !elements.modelSelectorDesc) return;
  if (!model) {
    elements.modelSelectorTitle.textContent = 'Select a model';
    elements.modelSelectorDesc.textContent = '';
    return;
  }
  elements.modelSelectorTitle.textContent = model.name || 'Select a model';
  elements.modelSelectorDesc.textContent = getModelDescriptor(model);
}

function renderModelSelectList(models) {
  if (!elements.modelSelectList) return;
  if (!Array.isArray(models) || models.length === 0) {
    elements.modelSelectList.innerHTML = '<p style="color: var(--text-secondary); padding: 6px 4px;">No models found.</p>';
    return;
  }

  elements.modelSelectList.innerHTML = models.map(m => {
    const isActive = m.name === state.currentModel;
    const desc = escapeHtml(getModelDescriptor(m));
    return `
      <button
        type="button"
        class="model-select-item ${isActive ? 'active' : ''}"
        data-model-name="${escapeHtml(m.name)}"
        aria-selected="${isActive ? 'true' : 'false'}"
      >
        <div class="model-select-item-text">
          <div class="model-select-item-name">${escapeHtml(m.name)}</div>
          <div class="model-select-item-desc">${desc}</div>
        </div>
        <div class="model-select-item-check" aria-hidden="true">✓</div>
      </button>
    `;
  }).join('');
}

function selectModelByName(modelName) {
  if (!modelName) return;
  // Update hidden select so existing logic continues to work
  elements.modelSelect.value = modelName;
  closeModelSelectDropdown({ focusButton: true });
  elements.modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
}

// ============================================
// Ollama Status & Models
// ============================================
async function checkOllamaStatus() {
  updateStatus('checking', 'Checking Ollama...');
  
  try {
    const result = await window.electronAPI.pingOllama();
    
    if (result.running) {
      state.isOllamaRunning = true;
      updateStatus('connected', 'Ollama Connected');
    } else {
      state.isOllamaRunning = false;
      updateStatus('disconnected', 'Ollama Not Running');
      showOllamaNotRunningError();
    }
  } catch (error) {
    state.isOllamaRunning = false;
    updateStatus('disconnected', 'Connection Failed');
    console.error('Failed to check Ollama status:', error);
  }
}

async function loadModels() {
  try {
    const result = await window.electronAPI.getModels();
    
    if (result.success && result.models.length > 0) {
      state.models = result.models;
      populateModelSelect(result.models);
      enableChat();
      elements.noModelsWarning.style.display = 'none';
    } else {
      state.models = [];
      elements.modelSelect.innerHTML = '<option value="">No models found</option>';
      elements.modelSelect.disabled = true;
      elements.modelSelectorBtn.disabled = true;
      closeModelSelectDropdown();
      updateModelSelectorUI(null);
      elements.noModelsWarning.style.display = 'block';
      disableChat();
    }
  } catch (error) {
    console.error('Failed to load models:', error);
    elements.modelSelect.innerHTML = '<option value="">Error loading models</option>';
    elements.modelSelect.disabled = true;
    elements.modelSelectorBtn.disabled = true;
    closeModelSelectDropdown();
    updateModelSelectorUI(null);
  }
}

async function refreshModels() {
  elements.refreshModelsBtn.disabled = true;
  elements.refreshModelsBtn.textContent = 'Refreshing...';
  
  await checkOllamaStatus();
  
  if (state.isOllamaRunning) {
    await loadModels();
  }
  
  elements.refreshModelsBtn.disabled = false;
  elements.refreshModelsBtn.textContent = '🔄 Refresh Models';
}

function populateModelSelect(models) {
  elements.modelSelect.innerHTML = models
    .map(m => `<option value="${m.name}">${m.name}</option>`)
    .join('');
  elements.modelSelect.disabled = false;
  elements.modelSelectorBtn.disabled = false;
  
  // Select last-used model if available, otherwise first model
  if (models.length > 0) {
    const lastModel = getLastSelectedModelFromStorage();
    const preferred = lastModel && models.some(m => m.name === lastModel) ? lastModel : models[0].name;

    state.currentModel = preferred;
    elements.modelSelect.value = preferred;
    setLastSelectedModelInStorage(preferred);
    loadSettingsForModel(preferred);

    const model = models.find(m => m.name === preferred) || models[0];
    updateModelInfo(model);
    updateModelSelectorUI(model);
    
    // Update vision UI for selected model
    updateVisionUI();
  }
}

async function handleModelChange() {
  const modelName = elements.modelSelect.value;
  state.currentModel = modelName;
  setLastSelectedModelInStorage(modelName);
  loadSettingsForModel(modelName);
  if (elements.settingsModal && elements.settingsModal.style.display !== 'none') {
    loadSettingsToUI();
  }
  
  // Update vision/multimodal UI
  updateVisionUI();
  
  // Find model in list and update info
  const model = state.models.find(m => m.name === modelName);
  if (model) {
    updateModelInfo(model);
    updateModelSelectorUI(model);
  } else {
    updateModelSelectorUI(null);
  }
  
  // Check if new model is loaded
  checkModelStatus();
}

function updateModelInfo(model) {
  if (!model) {
    elements.modelInfoSection.style.display = 'none';
    return;
  }

  const abilities = [];
  if (isThinkingModel(model.name)) abilities.push('Thinking');
  if (isToolsModel(model.name)) abilities.push('Tools');
  if (isVisionAbilityModel(model.name)) abilities.push('Vision');

  elements.modelInfoContent.innerHTML = `
    <p><strong>Abilities:</strong> ${abilities.length ? abilities.join(', ') : 'None'}</p>
  `;
  elements.modelInfoSection.style.display = 'block';
}

// ============================================
// Model Status (isAlive) Checking
// ============================================
function startModelStatusChecking() {
  // Check immediately
  checkModelStatus();
  
  // Then check every 5 seconds
  if (state.modelStatusInterval) {
    clearInterval(state.modelStatusInterval);
  }
  state.modelStatusInterval = setInterval(checkModelStatus, 5000);
}

async function checkModelStatus() {
  if (!state.isOllamaRunning || !state.currentModel) {
    updateModelStatusUI('unloaded', 'No model selected');
    state.modelLoaded = false;
    return;
  }
  
  try {
    const result = await window.electronAPI.getRunningModels();
    
    if (result.success && result.models) {
      // Check if current model is in the running models list
      const runningModel = result.models.find(m => 
        m.name === state.currentModel || 
        m.model === state.currentModel ||
        m.name?.startsWith(state.currentModel.split(':')[0])
      );
      
      if (runningModel) {
        state.modelLoaded = true;
        
        // Calculate VRAM usage if available
        let statusText = `${state.currentModel.split(':')[0]} loaded`;
        if (runningModel.size_vram) {
          const vramGB = (runningModel.size_vram / 1e9).toFixed(1);
          statusText += ` (${vramGB}GB VRAM)`;
        } else if (runningModel.size) {
          const sizeGB = (runningModel.size / 1e9).toFixed(1);
          statusText += ` (${sizeGB}GB)`;
        }
        
        // Show expiry time if available
        if (runningModel.expires_at) {
          const expiresAt = new Date(runningModel.expires_at);
          const now = new Date();
          const secondsLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
          
          if (secondsLeft > 0 && secondsLeft < 600) { // Show if less than 10 min
            const minsLeft = Math.floor(secondsLeft / 60);
            const secsLeft = secondsLeft % 60;
            statusText += ` • ${minsLeft}:${secsLeft.toString().padStart(2, '0')}`;
          }
        }
        
        updateModelStatusUI('loaded', statusText);
      } else {
        state.modelLoaded = false;
        updateModelStatusUI('unloaded', `${state.currentModel.split(':')[0]} not loaded`);
      }
    } else {
      state.modelLoaded = false;
      updateModelStatusUI('unloaded', 'Unable to check status');
    }
  } catch (error) {
    console.error('Failed to check model status:', error);
    state.modelLoaded = false;
    updateModelStatusUI('unloaded', 'Status check failed');
  }
}

function updateModelStatusUI(status, text) {
  elements.modelStatus.className = `status status-${status}`;
  elements.modelStatus.querySelector('.status-text').textContent = text;
  // Show unload button only when model is loaded
  if (elements.unloadModelBtn) {
    elements.unloadModelBtn.style.display = status === 'loaded' ? 'flex' : 'none';
  }
}

// Update status when generation starts/ends
function setModelStatusGenerating(isGenerating) {
  if (isGenerating) {
    updateModelStatusUI('loading', `${state.currentModel.split(':')[0]} generating...`);
  } else {
    // Re-check status after generation
    checkModelStatus();
  }
}

// Unload model from VRAM
async function unloadModel() {
  if (!state.currentModel || state.isGenerating) return;
  
  updateModelStatusUI('loading', 'Unloading...');
  
  try {
    const result = await window.electronAPI.unloadModel(state.currentModel);
    if (result.success) {
      updateModelStatusUI('unloaded', `${state.currentModel.split(':')[0]} unloaded`);
      state.modelLoaded = false;
      showNotification('Model unloaded from VRAM');
    } else {
      updateModelStatusUI('unloaded', 'Unload failed');
      showNotification(`Failed to unload: ${result.error}`);
    }
  } catch (error) {
    updateModelStatusUI('unloaded', 'Unload failed');
    showNotification(`Error: ${error.message}`);
  }
}

// ============================================
// Chat Functions
// ============================================
async function sendMessage() {
  const content = elements.chatInput.value.trim();
  const hasAttachments = state.pendingAttachments.length > 0;
  
  // Need either content or attachments (with content) for vision models
  if (!content || !state.currentModel) return;
  
  // Check if THIS chat already has an active generation
  if (state.activeGenerations.has(state.currentChatId)) return;
  
  // Capture the chat ID this generation belongs to
  const generatingChatId = state.currentChatId;
  // Capture the model used for this generation (even if the user switches later)
  const generatingModel = state.currentModel;
  
  // Capture attachments for this message
  const messageImages = hasAttachments 
    ? state.pendingAttachments.map(att => att.base64) 
    : undefined;
  const attachmentsForDisplay = hasAttachments 
    ? [...state.pendingAttachments] 
    : undefined;
  
  // Build the user message with optional images
  const userMessage = { role: 'user', content };
  if (messageImages && messageImages.length > 0) {
    userMessage.images = messageImages;
  }
  
  // Store attachment metadata for chat history (to display in UI later)
  if (attachmentsForDisplay) {
    userMessage.attachments = attachmentsForDisplay.map(att => ({
      id: att.id,
      mimeType: att.mimeType,
      name: att.name,
      base64: att.base64, // Store for display
    }));
  }
  
  // Add user message
  state.conversationHistory.push(userMessage);
  appendMessage('user', content, false, { attachments: attachmentsForDisplay });
  
  // Clear attachments
  clearAttachments();
  
  // Save the user message immediately
  await updateCurrentChat();
  
  // Clear input
  elements.chatInput.value = '';
  handleInputChange();
  
  // Hide welcome message
  hideWelcomeMessage();
  
  // Create assistant message placeholder
  const assistantDiv = appendMessage('assistant', '', true, { model: generatingModel });
  
  // Track this generation
  const generationState = {
    fullResponse: '',
    fullThinking: '',
    assistantDiv: assistantDiv,
    chatId: generatingChatId,
    model: generatingModel,
    conversationHistory: [...state.conversationHistory], // Snapshot of history
  };
  state.activeGenerations.set(generatingChatId, generationState);
  
  // Start generation UI
  setGenerating(true);
  
  // Set up stream listener
  window.electronAPI.onStreamChunk((chunk) => {
    // Get the generation state (might be in background now)
    const genState = state.activeGenerations.get(generatingChatId);
    if (!genState) return; // Generation was cancelled
    
    // Handle thinking content (separate field in newer Ollama)
    if (chunk.thinking) {
      genState.fullThinking += chunk.thinking;
    }
    
    if (chunk.content) {
      genState.fullResponse += chunk.content;
    }
    
    // Only update UI if we're still viewing this chat
    if (state.currentChatId === generatingChatId) {
      const displayContent = buildDisplayContent(genState.fullThinking, genState.fullResponse, !chunk.done);
      updateMessageContent(genState.assistantDiv, displayContent, false);
    }
    
    if (chunk.done) {
      // Final content
      const finalContent = buildDisplayContent(genState.fullThinking, genState.fullResponse, false);
      
      // Update UI if still viewing this chat
      if (state.currentChatId === generatingChatId) {
        updateMessageContent(genState.assistantDiv, finalContent, true);
        
        // Update stats
        if (!chunk.aborted && chunk.evalCount && chunk.evalDuration) {
          const tokensPerSecond = (chunk.evalCount / (chunk.evalDuration / 1e9)).toFixed(1);
          elements.generationStats.textContent = `${chunk.evalCount} tokens @ ${tokensPerSecond} tok/s`;
        } else if (chunk.aborted) {
          elements.generationStats.textContent = 'Generation stopped';
        }
        
        removeTypingIndicator(genState.assistantDiv);
      }
      
      // Store full response with thinking for history
      const historyContent = genState.fullThinking 
        ? `<think>${genState.fullThinking}</think>${genState.fullResponse}`
        : genState.fullResponse;
      
      // Update the saved chat directly (not relying on current state)
      const finalize = async () => {
        if (!(genState.fullResponse.trim() || genState.fullThinking.trim())) return;

        const chat = await getOrLoadChat(generatingChatId);
        if (!chat) return;

        chat.messages.push({ role: 'assistant', content: historyContent, model: genState.model || generatingModel });
        chat.model = chat.model || genState.model || generatingModel;
        chat.updatedAt = new Date().toISOString();
        setCachedChat(chat);

        await persistChat(chat);

        // If we're viewing this chat, sync conversation history
        if (state.currentChatId === generatingChatId) {
          state.conversationHistory = [...chat.messages];
        }
      };
      void finalize();
      
      // Clean up
      window.electronAPI.removeStreamListener();
      state.activeGenerations.delete(generatingChatId);
      
      // Update UI if still viewing this chat
      if (state.currentChatId === generatingChatId) {
        setGenerating(false);
      }
      
      // Re-render chat list to show updated status
      renderChatList();
    }
  });
  
  // Start streaming
  try {
    // Get active options (think mode is included if enabled in settings)
    const options = getActiveOptions();

    // Build API messages - include images for vision models
    const apiMessages = state.conversationHistory.map(m => {
      const msg = { role: m.role, content: m.content };
      // Include images if present (for multimodal/vision models)
      if (m.images && m.images.length > 0) {
        msg.images = m.images;
      }
      return msg;
    });
    
    const result = await window.electronAPI.chatStream(
      generatingModel,
      apiMessages,
      options
    );
    
    if (!result.success) {
      if (state.currentChatId === generatingChatId) {
        updateMessageContent(assistantDiv, `Error: ${result.error}`);
      }
      // Remove the failed user message from saved chat
      const rollback = async () => {
        const chat = await getOrLoadChat(generatingChatId);
        if (chat && Array.isArray(chat.messages) && chat.messages.length > 0) {
          chat.messages.pop();
          chat.updatedAt = new Date().toISOString();
          setCachedChat(chat);
          await persistChat(chat);
        }
      };
      void rollback();
      window.electronAPI.removeStreamListener();
      state.activeGenerations.delete(generatingChatId);
      if (state.currentChatId === generatingChatId) {
        setGenerating(false);
      }
    }
  } catch (error) {
    if (state.currentChatId === generatingChatId) {
      updateMessageContent(assistantDiv, `Error: ${error.message}`);
    }
    window.electronAPI.removeStreamListener();
    state.activeGenerations.delete(generatingChatId);
    if (state.currentChatId === generatingChatId) {
      setGenerating(false);
    }
  }
}

async function stopGeneration() {
  try {
    await window.electronAPI.abort();
  } catch (error) {
    console.error('Failed to abort:', error);
  }
}

async function startNewChat() {
  // Create new chat in storage
  const chat = await createNewChat();
  state.currentChatId = chat.id;
  state.conversationHistory = [];
  
  elements.messages.innerHTML = `
    <div class="welcome-message">
      <h2>Welcome to LocalLM Agent</h2>
      <p>Select a model and start chatting with your local AI.</p>
    </div>
  `;
  elements.generationStats.textContent = '';
  elements.chatInput.focus();
  renderChatList();
  
  // New chat has no active generation
  updateGeneratingUI(false);
}

// ============================================
// UI Helpers
// ============================================
function appendMessage(role, content, showTyping = false, meta = {}) {
  const div = document.createElement('div');
  div.className = `message message-${role}`;
  
  const header = document.createElement('div');
  header.className = 'message-header';

  const roleSpan = document.createElement('span');
  roleSpan.className = 'message-role';

  if (role === 'user') {
    roleSpan.textContent = '👤 You';
  } else if (role === 'assistant') {
    const chatModel = state.savedChats.find(c => c.id === state.currentChatId)?.model;
    const modelName = meta?.model || chatModel || state.currentModel || 'Assistant';
    roleSpan.textContent = `🤖 ${modelName}`;
  } else {
    roleSpan.textContent = role;
  }

  header.appendChild(roleSpan);
  
  // Show image attachments if present (for user messages with images)
  if (meta.attachments && meta.attachments.length > 0) {
    const attachmentsDiv = document.createElement('div');
    attachmentsDiv.className = 'message-attachments';
    
    for (const att of meta.attachments) {
      const imgWrapper = document.createElement('div');
      imgWrapper.className = 'message-image-wrapper';
      
      const img = document.createElement('img');
      img.src = `data:${att.mimeType};base64,${att.base64}`;
      img.alt = att.name;
      img.className = 'message-image';
      img.loading = 'lazy';
      
      imgWrapper.appendChild(img);
      attachmentsDiv.appendChild(imgWrapper);
    }
    
    div.appendChild(attachmentsDiv);
  }
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  
  if (showTyping && !content) {
    contentDiv.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
  } else if (role === 'assistant') {
    // Render markdown for assistant messages
    contentDiv.innerHTML = renderMarkdown(content);
  } else {
    // Plain text for user messages (or could also render markdown)
    contentDiv.textContent = content;
  }
  
  div.appendChild(header);
  div.appendChild(contentDiv);
  elements.messages.appendChild(div);
  
  scrollToBottom();
  
  return div;
}

// Build display content combining thinking and response
// For reasoning models, thinking comes as a separate stream
function buildDisplayContent(thinking, content, isStreaming) {
  if (!thinking && !content) {
    return '';
  }
  
  // If we have thinking content, wrap it in think tags for processing
  if (thinking) {
    if (isStreaming && !content) {
      // Still in thinking phase - use incomplete think tag
      return `<think>${thinking}`;
    } else {
      // Thinking complete, combine with content
      return `<think>${thinking}</think>${content || ''}`;
    }
  }
  
  // No thinking, just return content
  return content || '';
}

// Debounce timer for markdown rendering
let renderDebounceTimer = null;
let lastRenderLength = 0;

function updateMessageContent(messageDiv, content, isComplete = false) {
  const contentDiv = messageDiv.querySelector('.message-content');
  if (!contentDiv) return;
  
  if (isComplete) {
    // Final render - always do full markdown processing
    clearTimeout(renderDebounceTimer);
    contentDiv.innerHTML = renderMarkdown(content);
    lastRenderLength = 0;
    scrollToBottom();
    return;
  }
  
  // During streaming - use smart incremental rendering
  // Render markdown when significant content is added
  const shouldRenderNow = content.length - lastRenderLength >= 5;
  
  if (shouldRenderNow) {
    clearTimeout(renderDebounceTimer);
    contentDiv.innerHTML = renderMarkdown(content);
    lastRenderLength = content.length;
    scrollToBottom();
  } else {
    // Debounced render for smooth updates
    clearTimeout(renderDebounceTimer);
    renderDebounceTimer = setTimeout(() => {
      contentDiv.innerHTML = renderMarkdown(content);
      lastRenderLength = content.length;
      scrollToBottom();
    }, 150);
  }
}

function removeTypingIndicator(messageDiv) {
  const typing = messageDiv.querySelector('.typing-indicator');
  if (typing) {
    typing.remove();
  }
}

function hideWelcomeMessage() {
  const welcome = elements.messages.querySelector('.welcome-message');
  if (welcome) {
    welcome.remove();
  }
}

function scrollToBottom() {
  const wrapper = document.querySelector('.messages-wrapper');
  wrapper.scrollTop = wrapper.scrollHeight;
}

function updateStatus(type, text) {
  elements.ollamaStatus.className = `status status-${type}`;
  elements.ollamaStatus.querySelector('.status-text').textContent = text;
}

// Update UI for generating state (separate from global state for per-chat tracking)
function updateGeneratingUI(isGenerating) {
  // Only disable if generating; otherwise check if we have models
  const shouldDisable = isGenerating || state.models.length === 0;
  
  elements.sendBtn.disabled = shouldDisable;
  elements.chatInput.disabled = shouldDisable;
  elements.sendIcon.style.display = isGenerating ? 'none' : 'inline';
  elements.loadingIcon.style.display = isGenerating ? 'inline-block' : 'none';
  elements.stopBtn.style.display = isGenerating ? 'inline-flex' : 'none';
  
  // Update attach button state (vision models only, but also disabled during generation)
  if (elements.attachBtn) {
    elements.attachBtn.disabled = !state.isVisionModel || isGenerating || state.models.length === 0;
  }
  
  // Update placeholder based on state
  if (state.models.length === 0) {
    elements.chatInput.placeholder = 'Please install a model first...';
  } else {
    elements.chatInput.placeholder = 'Type your message... (Shift+Enter for new line)';
  }
  
  // Update model status indicator
  setModelStatusGenerating(isGenerating);
  
  if (!isGenerating && !shouldDisable) {
    elements.chatInput.focus();
  }
}

function setGenerating(isGenerating) {
  state.isGenerating = isGenerating;
  updateGeneratingUI(isGenerating);
}

function enableChat() {
  // Re-evaluate based on current chat's generation state
  const hasActiveGeneration = state.activeGenerations.has(state.currentChatId);
  updateGeneratingUI(hasActiveGeneration);
}

function disableChat() {
  elements.chatInput.disabled = true;
  elements.sendBtn.disabled = true;
  elements.chatInput.placeholder = 'Please install a model first...';
  if (elements.attachBtn) {
    elements.attachBtn.disabled = true;
  }
}

function showOllamaNotRunningError() {
  const welcome = elements.messages.querySelector('.welcome-message');
  if (welcome) {
    welcome.innerHTML = `
      <h2>⚠️ Ollama Not Running</h2>
      <p>Please start Ollama to use LocalLM Agent.</p>
      <div class="warning-box">
        <p>Make sure Ollama is installed and running:</p>
        <ol>
          <li>Open a terminal</li>
          <li>Run: <code>ollama serve</code></li>
          <li>Or start the Ollama application</li>
        </ol>
        <button id="retry-connection-btn" class="btn btn-secondary">🔄 Retry Connection</button>
      </div>
    `;
    
    document.getElementById('retry-connection-btn')?.addEventListener('click', async () => {
      await checkOllamaStatus();
      if (state.isOllamaRunning) {
        await loadModels();
        startNewChat();
      }
    });
  }
}

// ============================================
// Modal Functions
// ============================================
function showModal(modal) {
  modal.style.display = 'flex';
}

function hideModal(modal) {
  modal.style.display = 'none';
  // Restore focus to the chat input after closing modal
  if (!elements.chatInput.disabled) {
    elements.chatInput.focus();
  }
}

// ============================================
// Settings Functions
// ============================================
function setupSettingsSync() {
  // Sync range sliders with number inputs
  for (const [key, ids] of Object.entries(settingsMap)) {
    if (ids.range && ids.value) {
      const rangeEl = document.getElementById(ids.range);
      const valueEl = document.getElementById(ids.value);
      
      if (rangeEl && valueEl) {
        rangeEl.addEventListener('input', () => {
          valueEl.value = rangeEl.value;
        });
        
        valueEl.addEventListener('input', () => {
          const val = parseFloat(valueEl.value);
          if (!isNaN(val)) {
            rangeEl.value = Math.max(rangeEl.min, Math.min(rangeEl.max, val));
          }
        });
      }
    }
  }
}

function loadSettingsToUI() {
  for (const [key, ids] of Object.entries(settingsMap)) {
    const value = modelOptions[key];
    
    if (ids.range) {
      const rangeEl = document.getElementById(ids.range);
      if (rangeEl) rangeEl.value = value;
    }
    if (ids.value) {
      const valueEl = document.getElementById(ids.value);
      if (valueEl) valueEl.value = value;
    }
    if (ids.select) {
      const selectEl = document.getElementById(ids.select);
      if (selectEl) selectEl.value = value;
    }
    if (ids.checkbox) {
      const checkboxEl = document.getElementById(ids.checkbox);
      if (checkboxEl) checkboxEl.checked = value;
    }
  }
}

function applySettings() {
  for (const [key, ids] of Object.entries(settingsMap)) {
    let value;
    
    if (ids.checkbox) {
      const checkboxEl = document.getElementById(ids.checkbox);
      if (checkboxEl) value = checkboxEl.checked;
      if (value !== undefined) {
        modelOptions[key] = value;
      }
    } else if (ids.value) {
      const valueEl = document.getElementById(ids.value);
      if (valueEl) value = parseFloat(valueEl.value);
      if (value !== undefined && !isNaN(value)) {
        modelOptions[key] = value;
      }
    } else if (ids.select) {
      const selectEl = document.getElementById(ids.select);
      if (selectEl) value = parseInt(selectEl.value);
      if (value !== undefined && !isNaN(value)) {
        modelOptions[key] = value;
      }
    }
  }

  saveSettingsForModel(state.currentModel);
  hideModal(elements.settingsModal);
  showNotification('Settings applied');
}

function resetSettings() {
  modelOptions = { ...defaultOptions };
  saveSettingsForModel(state.currentModel);
  loadSettingsToUI();
  showNotification('Settings restored to defaults');
}

function showNotification(message) {
  // Simple notification - could be enhanced
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();
  
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 20px;
    background: var(--accent-primary);
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    animation: fadeIn 0.3s ease;
    z-index: 1001;
  `;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s';
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

function getActiveOptions() {
  // Return only non-default options to avoid sending unnecessary params
  const options = {};
  for (const [key, value] of Object.entries(modelOptions)) {
    if (value !== defaultOptions[key]) {
      // keep_alive needs special formatting (convert minutes to string)
      if (key === 'keep_alive') {
        if (value === -1) {
          options[key] = -1; // Forever
        } else {
          options[key] = `${value}m`; // e.g., "5m"
        }
      } else {
        options[key] = value;
      }
    }
  }
  // Always include think parameter - some models (Qwen3) think by default
  // so we need to explicitly pass false to disable it
  options.think = modelOptions.think === true;
  return options;
}

// ============================================
// Event Handlers
// ============================================
function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function handleInputChange() {
  // Auto-resize textarea
  const textarea = elements.chatInput;
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  
  // Update character count
  elements.charCount.textContent = textarea.value.length;
}

function handleGlobalKeydown(e) {
  // Ctrl+N for new chat
  if (e.ctrlKey && e.key === 'n') {
    e.preventDefault();
    startNewChat();
  }
  
  // Escape to close modals
  if (e.key === 'Escape') {
    hideModal(elements.helpModal);
    hideModal(elements.settingsModal);
    closeModelSelectDropdown();
  }
}

// ============================================
// Markdown & LaTeX Rendering
// ============================================

// Configure marked.js
marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false,
});

// Custom renderer for code blocks with copy button and language label
const renderer = new marked.Renderer();

renderer.code = function(code, language) {
  // Handle the case where code might be an object (marked v12+)
  let codeText = code;
  let lang = language;
  
  if (typeof code === 'object') {
    codeText = code.text || '';
    lang = code.lang || '';
  }
  
  const validLang = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const displayLang = lang || 'code';
  
  let highlighted;
  try {
    highlighted = hljs.highlight(codeText, { language: validLang }).value;
  } catch (e) {
    highlighted = escapeHtml(codeText);
  }
  
  const id = 'code-' + Math.random().toString(36).substr(2, 9);
  
  return `
    <div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-block-lang">${escapeHtml(displayLang)}</span>
        <button class="code-block-copy" onclick="copyCode('${id}')" title="Copy code">📋 Copy</button>
      </div>
      <pre><code id="${id}" class="hljs language-${validLang}">${highlighted}</code></pre>
    </div>
  `;
};

// Disallow raw HTML in markdown output.
// Marked renders inline HTML by default; in an Electron renderer this can create
// accidental (or malicious) overlays that steal clicks/focus.
renderer.html = function(html) {
  const raw = typeof html === 'string' ? html : (html?.text ?? '');
  return escapeHtml(raw);
};

function sanitizeHref(href) {
  if (!href) return '';
  const trimmed = String(href).trim();
  // Allow in-page anchors and relative links.
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return trimmed;

  try {
    const url = new URL(trimmed, 'https://example.invalid');
    const protocol = url.protocol.toLowerCase();
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
      return trimmed;
    }
  } catch {
    // If it isn't a valid URL, just treat it as plain text.
  }
  return '';
}

// Sanitize links so javascript:/data:/file: etc can't be clicked.
renderer.link = function(hrefOrToken, title, text) {
  // Marked v12 may pass a token object.
  let href = hrefOrToken;
  let linkText = text;
  let linkTitle = title;

  if (typeof hrefOrToken === 'object' && hrefOrToken) {
    href = hrefOrToken.href;
    linkText = hrefOrToken.text;
    linkTitle = hrefOrToken.title;
  }

  const safeHref = sanitizeHref(href);
  const safeText = escapeHtml(linkText ?? '');

  // If the URL is unsafe/empty, render just the text.
  if (!safeHref) return safeText;

  const safeTitle = linkTitle ? ` title="${escapeHtml(linkTitle)}"` : '';
  return `<a href="${escapeHtml(safeHref)}"${safeTitle} target="_blank" rel="noopener noreferrer">${safeText}</a>`;
};

marked.use({ renderer });

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Copy code to clipboard
window.copyCode = async function(id) {
  const codeEl = document.getElementById(id);
  if (codeEl) {
    try {
      await navigator.clipboard.writeText(codeEl.textContent);
      const btn = codeEl.closest('.code-block-wrapper').querySelector('.code-block-copy');
      const originalText = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => btn.textContent = originalText, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }
};

// Render markdown with LaTeX support
function renderMarkdown(text) {
  if (!text) return '';
  
  // Process <think> tags into collapsible sections
  let processed = text;
  const thinkBlocks = [];
  const incompleteThinkBlocks = [];
  
  // Extract and replace complete <think>...</think> blocks
  processed = processed.replace(/<think>([\s\S]*?)<\/think>/gi, (match, thinkContent) => {
    thinkBlocks.push(thinkContent.trim());
    return `%%THINK_BLOCK_${thinkBlocks.length - 1}%%`;
  });
  
  // Handle incomplete/streaming <think> tags (opened but not yet closed)
  processed = processed.replace(/<think>([\s\S]*)$/gi, (match, thinkContent) => {
    incompleteThinkBlocks.push(thinkContent.trim());
    return `%%INCOMPLETE_THINK_${incompleteThinkBlocks.length - 1}%%`;
  });
  
  // Protect LaTeX blocks from markdown processing
  const latexBlocks = [];
  
  // Protect display math \[...\] (common in DeepSeek, GPT outputs)
  processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (match, p1) => {
    latexBlocks.push({ type: 'display', content: p1.trim() });
    return `%%LATEX_BLOCK_${latexBlocks.length - 1}%%`;
  });
  
  // Protect display math $$...$$ 
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (match, p1) => {
    latexBlocks.push({ type: 'display', content: p1.trim() });
    return `%%LATEX_BLOCK_${latexBlocks.length - 1}%%`;
  });
  
  // Protect inline math \(...\) (common in DeepSeek, GPT outputs)
  processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (match, p1) => {
    latexBlocks.push({ type: 'inline', content: p1.trim() });
    return `%%LATEX_BLOCK_${latexBlocks.length - 1}%%`;
  });
  
  // Protect inline math $...$ - be careful not to match currency
  processed = processed.replace(/\$([^$\n]+?)\$/g, (match, p1) => {
    // Skip if it looks like currency (number followed by space)
    if (/^\d+\.?\d*\s/.test(p1)) return match;
    latexBlocks.push({ type: 'inline', content: p1.trim() });
    return `%%LATEX_BLOCK_${latexBlocks.length - 1}%%`;
  });
  
  // Render markdown
  let html = marked.parse(processed);
  
  // Restore and render LaTeX blocks
  html = html.replace(/%%LATEX_BLOCK_(\d+)%%/g, (match, index) => {
    const block = latexBlocks[parseInt(index)];
    try {
      return katex.renderToString(block.content, {
        displayMode: block.type === 'display',
        throwOnError: false,
        strict: false,
      });
    } catch (e) {
      console.error('KaTeX error:', e);
      return `<code>${escapeHtml(block.content)}</code>`;
    }
  });
  
  // Restore and render think blocks as collapsible sections
  html = html.replace(/%%THINK_BLOCK_(\d+)%%/g, (match, index) => {
    const thinkContent = thinkBlocks[parseInt(index)];
    // Render the think content as markdown too
    const renderedThink = marked.parse(thinkContent);
    return `
      <details class="think-block">
        <summary class="think-summary">
          <span class="think-icon">💭</span>
          <span class="think-label">Thinking</span>
          <span class="think-chevron">▶</span>
        </summary>
        <div class="think-content">${renderedThink}</div>
      </details>
    `;
  });
  
  // Render incomplete (streaming) think blocks - shown open with a "thinking..." indicator
  html = html.replace(/%%INCOMPLETE_THINK_(\d+)%%/g, (match, index) => {
    const thinkContent = incompleteThinkBlocks[parseInt(index)];
    const renderedThink = thinkContent ? marked.parse(thinkContent) : '';
    return `
      <details class="think-block think-block-streaming" open>
        <summary class="think-summary">
          <span class="think-icon">💭</span>
          <span class="think-label">Thinking<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span></span>
          <span class="think-chevron">▶</span>
        </summary>
        <div class="think-content">${renderedThink || '<em>Processing...</em>'}</div>
      </details>
    `;
  });
  
  return html;
}

// ============================================
// Start Application
// ============================================
init();
