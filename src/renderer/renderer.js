// ============================================
// DOM Elements
// ============================================
const elements = {
  // Sidebar
  modelSelect: document.getElementById('model-select'),
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
  
  // Warnings
  noModelsWarning: document.getElementById('no-models-warning'),
  refreshModelsBtn: document.getElementById('refresh-models-btn'),
  
  // Modals
  helpModal: document.getElementById('help-modal'),
  closeHelpModal: document.getElementById('close-help-modal'),
  settingsModal: document.getElementById('settings-modal'),
  closeSettingsModal: document.getElementById('close-settings-modal'),
  resetSettingsBtn: document.getElementById('reset-settings-btn'),
  applySettingsBtn: document.getElementById('apply-settings-btn'),
};

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
};

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

// ============================================
// Chat Persistence
// ============================================
const STORAGE_KEY = 'locallm-saved-chats';

function generateChatId() {
  return 'chat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function loadSavedChats() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    state.savedChats = saved ? JSON.parse(saved) : [];
  } catch (e) {
    console.error('Failed to load saved chats:', e);
    state.savedChats = [];
  }
}

function saveChatsToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.savedChats));
  } catch (e) {
    console.error('Failed to save chats:', e);
  }
}

function createNewChat() {
  const chat = {
    id: generateChatId(),
    title: 'New Chat',
    messages: [],
    model: state.currentModel,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.savedChats.unshift(chat);
  saveChatsToStorage();
  return chat;
}

function updateCurrentChat() {
  if (!state.currentChatId) return;
  
  const chat = state.savedChats.find(c => c.id === state.currentChatId);
  if (chat) {
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
    
    saveChatsToStorage();
    renderChatList();
  }
}

function loadChat(chatId) {
  const chat = state.savedChats.find(c => c.id === chatId);
  if (!chat) return;
  
  // Allow switching even during generation - the generation will continue in background
  state.currentChatId = chatId;
  state.conversationHistory = [...chat.messages];
  
  // Set model if available
  if (chat.model && state.models.some(m => m.name === chat.model)) {
    state.currentModel = chat.model;
    elements.modelSelect.value = chat.model;
  }
  
  // Render messages
  renderChatMessages();
  renderChatList();
  
  // Update UI and state based on whether THIS chat has an active generation
  const hasActiveGeneration = state.activeGenerations.has(chatId);
  state.isGenerating = hasActiveGeneration;
  updateGeneratingUI(hasActiveGeneration);
}

function deleteChat(chatId) {
  const index = state.savedChats.findIndex(c => c.id === chatId);
  if (index === -1) return;
  
  state.savedChats.splice(index, 1);
  saveChatsToStorage();
  
  // If deleted current chat, start new one
  if (state.currentChatId === chatId) {
    if (state.savedChats.length > 0) {
      loadChat(state.savedChats[0].id);
    } else {
      startNewChat();
    }
  } else {
    renderChatList();
  }
}

function clearAllChats() {
  if (!confirm('Are you sure you want to delete all conversations? This cannot be undone.')) {
    return;
  }
  state.savedChats = [];
  saveChatsToStorage();
  startNewChat();
}

function renameChat(chatId, newTitle) {
  const chat = state.savedChats.find(c => c.id === chatId);
  if (chat) {
    chat.title = newTitle || 'Untitled Chat';
    saveChatsToStorage();
    renderChatList();
  }
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
    const msgCount = chat.messages.length;
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
    appendMessage(msg.role, msg.content, false);
  }
  
  // If this chat has an active generation, show the in-progress response
  const genState = state.activeGenerations.get(state.currentChatId);
  if (genState) {
    // Re-create the assistant message div for the active generation
    genState.assistantDiv = appendMessage('assistant', '', true);
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
    renameChat(chatId, newTitle.trim());
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
// Initialization
// ============================================
async function init() {
  setupEventListeners();
  loadSavedChats();
  await checkOllamaStatus();
  
  if (state.isOllamaRunning) {
    await loadModels();
    startModelStatusChecking();
  }
  
  // Load most recent chat or create new one
  if (state.savedChats.length > 0) {
    loadChat(state.savedChats[0].id);
  } else {
    startNewChat();
  }
}

function setupEventListeners() {
  // Send message
  elements.sendBtn.addEventListener('click', sendMessage);
  elements.chatInput.addEventListener('keydown', handleInputKeydown);
  elements.chatInput.addEventListener('input', handleInputChange);
  
  // Model selection
  elements.modelSelect.addEventListener('change', handleModelChange);
  
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
      elements.noModelsWarning.style.display = 'block';
      disableChat();
    }
  } catch (error) {
    console.error('Failed to load models:', error);
    elements.modelSelect.innerHTML = '<option value="">Error loading models</option>';
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
  
  // Select first model
  if (models.length > 0) {
    state.currentModel = models[0].name;
    updateModelInfo(models[0]);
  }
}

async function handleModelChange() {
  const modelName = elements.modelSelect.value;
  state.currentModel = modelName;
  
  // Find model in list and update info
  const model = state.models.find(m => m.name === modelName);
  if (model) {
    updateModelInfo(model);
  }
  
  // Check if new model is loaded
  checkModelStatus();
}

function updateModelInfo(model) {
  if (!model) {
    elements.modelInfoSection.style.display = 'none';
    return;
  }
  
  const sizeGB = (model.size / 1e9).toFixed(1);
  const modified = model.modified_at ? new Date(model.modified_at).toLocaleDateString() : 'Unknown';
  
  elements.modelInfoContent.innerHTML = `
    <p><strong>Size:</strong> ${sizeGB} GB</p>
    <p><strong>Modified:</strong> ${modified}</p>
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
  if (!content || !state.currentModel) return;
  
  // Check if THIS chat already has an active generation
  if (state.activeGenerations.has(state.currentChatId)) return;
  
  // Capture the chat ID this generation belongs to
  const generatingChatId = state.currentChatId;
  
  // Add user message
  state.conversationHistory.push({ role: 'user', content });
  appendMessage('user', content);
  
  // Save the user message immediately
  updateCurrentChat();
  
  // Clear input
  elements.chatInput.value = '';
  handleInputChange();
  
  // Hide welcome message
  hideWelcomeMessage();
  
  // Create assistant message placeholder
  const assistantDiv = appendMessage('assistant', '', true);
  
  // Track this generation
  const generationState = {
    fullResponse: '',
    fullThinking: '',
    assistantDiv: assistantDiv,
    chatId: generatingChatId,
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
      const chat = state.savedChats.find(c => c.id === generatingChatId);
      if (chat && (genState.fullResponse.trim() || genState.fullThinking.trim())) {
        chat.messages.push({ role: 'assistant', content: historyContent });
        chat.updatedAt = new Date().toISOString();
        saveChatsToStorage();
        
        // If we're viewing this chat, sync conversation history
        if (state.currentChatId === generatingChatId) {
          state.conversationHistory = [...chat.messages];
        }
      }
      
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
    
    const result = await window.electronAPI.chatStream(
      state.currentModel,
      state.conversationHistory,
      options
    );
    
    if (!result.success) {
      if (state.currentChatId === generatingChatId) {
        updateMessageContent(assistantDiv, `Error: ${result.error}`);
      }
      // Remove the failed user message from saved chat
      const chat = state.savedChats.find(c => c.id === generatingChatId);
      if (chat && chat.messages.length > 0) {
        chat.messages.pop();
        saveChatsToStorage();
      }
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

function startNewChat() {
  // Create new chat in storage
  const chat = createNewChat();
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
function appendMessage(role, content, showTyping = false) {
  const div = document.createElement('div');
  div.className = `message message-${role}`;
  
  const header = document.createElement('div');
  header.className = 'message-header';
  header.innerHTML = `
    <span class="message-role">${role === 'user' ? '👤 You' : '🤖 Assistant'}</span>
  `;
  
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
  // Render markdown every 200ms or when significant content is added
  const shouldRenderNow = content.length - lastRenderLength > 50;
  
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
  
  hideModal(elements.settingsModal);
  showNotification('Settings applied');
}

function resetSettings() {
  modelOptions = { ...defaultOptions };
  loadSettingsToUI();
  showNotification('Settings reset to defaults');
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
