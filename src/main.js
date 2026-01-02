const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { Ollama } = require('ollama');
const { tavily } = require('@tavily/core');
require('dotenv').config();

// Import AI Council Service
const { AICouncilService, setSearchFunction } = require('./aiCouncilService');

// Initialize Ollama client pointing to local instance
const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

// Initialize Tavily client - Set TAVILY_API_KEY in .env file
const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

let mainWindow;
let currentAbortController = null;

// ============================================
// Chat Storage (File-based)
// ============================================

const CHAT_STORE_VERSION = 1;

function getChatStoreDir() {
  return path.join(app.getPath('userData'), 'chats');
}

function getChatItemsDir() {
  return path.join(getChatStoreDir(), 'items');
}

function getChatIndexPath() {
  return path.join(getChatStoreDir(), 'index.json');
}

function assertValidChatId(chatId) {
  if (typeof chatId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(chatId)) {
    throw new Error('Invalid chat id');
  }
}

function generateChatId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function ensureChatStoreDirs() {
  await fs.mkdir(getChatItemsDir(), { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  try {
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    // Windows rename may fail if destination exists.
    try {
      await fs.rm(filePath, { force: true });
    } catch {
      // ignore
    }
    await fs.rename(tmpPath, filePath);
  }
}

function normalizeChatForDisk(chat) {
  const now = new Date().toISOString();
  return {
    id: chat.id,
    title: chat.title || 'New Chat',
    model: chat.model || null,
    createdAt: chat.createdAt || now,
    updatedAt: chat.updatedAt || now,
    messages: Array.isArray(chat.messages) ? chat.messages : [],
  };
}

function buildChatSummary(chat) {
  return {
    id: chat.id,
    title: chat.title || 'New Chat',
    model: chat.model || null,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
  };
}

async function readChatIndex() {
  await ensureChatStoreDirs();
  const index = await readJson(getChatIndexPath(), null);
  if (!index || typeof index !== 'object' || !Array.isArray(index.chats)) {
    return { version: CHAT_STORE_VERSION, chats: [] };
  }
  return index;
}

async function writeChatIndex(index) {
  const normalized = {
    version: CHAT_STORE_VERSION,
    chats: Array.isArray(index.chats) ? index.chats : [],
  };
  // Ensure newest first
  normalized.chats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  await writeJsonAtomic(getChatIndexPath(), normalized);
  return normalized;
}

function getChatFilePath(chatId) {
  assertValidChatId(chatId);
  return path.join(getChatItemsDir(), `${chatId}.json`);
}

async function readChat(chatId) {
  const chat = await readJson(getChatFilePath(chatId), null);
  if (!chat) return null;
  return normalizeChatForDisk(chat);
}

async function writeChat(chat) {
  await ensureChatStoreDirs();
  assertValidChatId(chat.id);
  const normalized = normalizeChatForDisk(chat);
  await writeJsonAtomic(getChatFilePath(normalized.id), normalized);
  return normalized;
}

async function upsertChatSummary(summary) {
  const index = await readChatIndex();
  const i = index.chats.findIndex(c => c.id === summary.id);
  if (i === -1) {
    index.chats.unshift(summary);
  } else {
    index.chats[i] = { ...index.chats[i], ...summary };
  }
  return await writeChatIndex(index);
}

async function removeChatSummary(chatId) {
  const index = await readChatIndex();
  index.chats = index.chats.filter(c => c.id !== chatId);
  return await writeChatIndex(index);
}

// ============================================
// Web Search Tool for Agentic Capabilities
// ============================================

/**
 * Searches the web using Tavily API and returns relevant results
 * @param {string} query - The search query
 * @returns {Promise<string>} - Formatted search results
 */
async function searchWeb(query) {
  console.log(`[searchWeb] Starting search for: "${query}"`);
  
  try {
    const response = await tvly.search(query, {
      searchDepth: 'basic',
      maxResults: 3
    });
    
    console.log('[searchWeb] Raw API response:', JSON.stringify(response, null, 2));
    
    if (!response.results || response.results.length === 0) {
      return `No search results found for: "${query}"`;
    }
    
    let output = `Search results for "${query}":\n\n`;
    
    response.results.forEach((result, index) => {
      output += `[${index + 1}] Title: ${result.title}\n`;
      output += `Content: ${result.content}\n`;
      output += `URL: ${result.url}\n\n`;
    });
    
    console.log(`[searchWeb] Finished search for: "${query}"`);
    return output;
  } catch (error) {
    console.error('[searchWeb] Error:', error.message);
    return `Search failed: ${error.message}\n\nQuery was: "${query}"`;
  }
}

// Tool definitions in Ollama JSON schema format
const webSearchTool = {
  type: 'function',
  function: {
    name: 'searchWeb',
    description: 'Search the web for current information, news, facts, or any topic. Use this when you need up-to-date information or when the user asks about something you might not have knowledge of.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up on the web'
        }
      },
      required: ['query']
    }
  }
};

// Available tools array
const availableTools = [webSearchTool];

function shouldDisableToolsForModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return false;
  const lowerName = modelName.toLowerCase();
  // Disable tool access for models that don't support tools
  return lowerName.includes('deepseek') || lowerName.includes('gemma') || lowerName.includes('dolphin') || lowerName.includes('llama');
}

// Map tool names to their implementations
const toolImplementations = {
  searchWeb: searchWeb
};

/**
 * Execute a tool call and return the result
 * @param {object} toolCall - The tool call from Ollama
 * @returns {Promise<string>} - The tool result
 */
async function executeToolCall(toolCall) {
  const { name, arguments: args } = toolCall.function;
  
  if (toolImplementations[name]) {
    try {
      const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
      return await toolImplementations[name](parsedArgs.query);
    } catch (error) {
      console.error(`Tool execution error for ${name}:`, error);
      return `Error executing tool ${name}: ${error.message}`;
    }
  }
  
  return `Unknown tool: ${name}`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    show: false,
  });

  // Remove the default menu bar (File/Edit/View/...) on Windows/Linux.
  // Also clears any application menu so it can't be toggled back via Alt.
  try {
    Menu.setApplicationMenu(null);
  } catch {
    // ignore
  }
  try {
    mainWindow.removeMenu();
  } catch {
    // ignore
  }
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Enable reload shortcuts even when the application menu is removed.
  // - Ctrl/Cmd+R or F5: reload
  // - Ctrl/Cmd+Shift+R or Shift+F5: reload ignoring cache
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!input || input.type !== 'keyDown') return;

    const key = typeof input.key === 'string' ? input.key : '';
    const lowerKey = key.toLowerCase();
    const isDevToolsChord = (lowerKey === 'i' && (input.control || input.meta) && input.shift) || key === 'F12';
    const isReloadChord = lowerKey === 'r' && (input.control || input.meta);
    const isF5 = key === 'F5';

    if (!isDevToolsChord && !isReloadChord && !isF5) return;

    if (isDevToolsChord) {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
      return;
    }

    event.preventDefault();
    if (input.shift) {
      mainWindow.webContents.reloadIgnoringCache();
    } else {
      mainWindow.webContents.reload();
    }
  });

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open DevTools in development
  if (process.argv.includes('--enable-logging')) {
    mainWindow.webContents.openDevTools();
  }
}

// ============================================
// IPC Handlers for Chat Storage
// ============================================

ipcMain.handle('chats:list', async () => {
  try {
    const index = await readChatIndex();
    index.chats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { success: true, chats: index.chats };
  } catch (error) {
    return { success: false, error: error.message, chats: [] };
  }
});

ipcMain.handle('chats:load', async (_event, chatId) => {
  try {
    assertValidChatId(chatId);
    const chat = await readChat(chatId);
    if (!chat) return { success: false, error: 'Chat not found' };
    return { success: true, chat };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('chats:create', async (_event, { model = null } = {}) => {
  try {
    await ensureChatStoreDirs();
    const now = new Date().toISOString();
    const chat = {
      id: generateChatId(),
      title: 'New Chat',
      model,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    const written = await writeChat(chat);
    await upsertChatSummary(buildChatSummary(written));
    return { success: true, chat: written, summary: buildChatSummary(written) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('chats:update', async (_event, chat) => {
  try {
    if (!chat || typeof chat !== 'object') throw new Error('Invalid chat payload');
    assertValidChatId(chat.id);
    const written = await writeChat(chat);
    const summary = buildChatSummary(written);
    const index = await upsertChatSummary(summary);
    return { success: true, chat: written, summary, chats: index.chats };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('chats:rename', async (_event, { chatId, title }) => {
  try {
    assertValidChatId(chatId);
    const safeTitle = (title || '').trim() || 'Untitled Chat';
    const existing = await readChat(chatId);
    if (existing) {
      existing.title = safeTitle;
      existing.updatedAt = new Date().toISOString();
      const written = await writeChat(existing);
      const index = await upsertChatSummary(buildChatSummary(written));
      return { success: true, chat: written, chats: index.chats };
    }

    // If chat file is missing, still update index entry if present
    const index = await readChatIndex();
    const i = index.chats.findIndex(c => c.id === chatId);
    if (i !== -1) {
      index.chats[i] = { ...index.chats[i], title: safeTitle, updatedAt: new Date().toISOString() };
      const writtenIndex = await writeChatIndex(index);
      return { success: true, chats: writtenIndex.chats };
    }

    return { success: false, error: 'Chat not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('chats:delete', async (_event, chatId) => {
  try {
    assertValidChatId(chatId);
    await fs.rm(getChatFilePath(chatId), { force: true });
    const index = await removeChatSummary(chatId);
    return { success: true, chats: index.chats };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('chats:clear', async () => {
  try {
    await fs.rm(getChatStoreDir(), { recursive: true, force: true });
    await ensureChatStoreDirs();
    await writeChatIndex({ version: CHAT_STORE_VERSION, chats: [] });
    return { success: true, chats: [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('chats:import', async (_event, legacyChats) => {
  try {
    if (!Array.isArray(legacyChats)) throw new Error('Invalid legacy chats payload');
    await ensureChatStoreDirs();

    const index = { version: CHAT_STORE_VERSION, chats: [] };
    for (const c of legacyChats) {
      if (!c || typeof c !== 'object') continue;
      const id = typeof c.id === 'string' ? c.id : generateChatId();
      // Sanitize/normalize the id to avoid path traversal in case legacy data is compromised.
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) continue;

      const chat = normalizeChatForDisk({
        id,
        title: c.title,
        model: c.model ?? null,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messages: Array.isArray(c.messages) ? c.messages : [],
      });
      const written = await writeChat(chat);
      index.chats.push(buildChatSummary(written));
    }

    const writtenIndex = await writeChatIndex(index);
    return { success: true, chats: writtenIndex.chats };
  } catch (error) {
    return { success: false, error: error.message, chats: [] };
  }
});

// ============================================
// IPC Handlers for Ollama API
// ============================================

// Check if Ollama service is running
ipcMain.handle('ollama:ping', async () => {
  try {
    await ollama.list();
    return { running: true };
  } catch (error) {
    return { running: false, error: error.message };
  }
});

// List available models
ipcMain.handle('ollama:models', async () => {
  try {
    const response = await ollama.list();
    return { success: true, models: response.models || [] };
  } catch (error) {
    return { success: false, error: error.message, models: [] };
  }
});

// Get model details
ipcMain.handle('ollama:model-info', async (event, modelName) => {
  try {
    const response = await ollama.show({ model: modelName });
    return { success: true, info: response };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get running models (loaded in memory)
ipcMain.handle('ollama:ps', async () => {
  try {
    const response = await ollama.ps();
    return { success: true, models: response.models || [] };
  } catch (error) {
    return { success: false, error: error.message, models: [] };
  }
});

// Unload model from VRAM
ipcMain.handle('ollama:unload', async (event, modelName) => {
  try {
    // Setting keep_alive to 0 immediately unloads the model.
    // Use a non-empty prompt and a string keep_alive to avoid any falsy stripping in client layers.
    await ollama.generate({
      model: modelName,
      prompt: ' ',
      keep_alive: '0',
    });

    // Verify unload (it can take a moment to reflect in `ps`).
    const matchesModel = (m) =>
      m?.name === modelName ||
      m?.model === modelName ||
      (typeof modelName === 'string' && m?.name?.startsWith(modelName.split(':')[0]));

    const maxWaitMs = 2000;
    const intervalMs = 200;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      try {
        const ps = await ollama.ps();
        const stillRunning = Array.isArray(ps?.models) && ps.models.some(matchesModel);
        if (!stillRunning) {
          return { success: true };
        }
      } catch {
        // If ps fails transiently, keep waiting a bit.
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return { success: false, error: 'Unload requested, but model still appears loaded. Try again after generation completes.' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Chat with streaming - sends chunks back to renderer
// Now supports agentic tool calling with web search
ipcMain.handle('ollama:chat-stream', async (event, { model, messages, options }) => {
  // Create new abort controller for this request
  currentAbortController = new AbortController();
  
  try {
    // Extract keep_alive, think, and useTools from options
    const { keep_alive, think, useTools = true, ...modelOptions } = options || {};
    const effectiveUseTools = useTools && !shouldDisableToolsForModel(model);
    
    // Work with a copy of messages to track conversation history for tool loop
    let conversationHistory = [...messages];
    
    const buildRequestParams = (msgs, stream = true) => {
      const params = {
        model,
        messages: msgs,
        stream,
        options: modelOptions,
        // Allow renderer to cancel in-flight HTTP requests immediately.
        signal: currentAbortController?.signal,
      };
      
      // Add keep_alive if specified
      if (keep_alive !== undefined) {
        params.keep_alive = keep_alive;
      }
      
      // Enable thinking mode for reasoning models
      if (think !== undefined) {
        params.think = think;
      }
      
      // Add tools if enabled
      if (effectiveUseTools) {
        params.tools = availableTools;
      }
      
      return params;
    };
    
    // Agentic tool-calling loop
    const MAX_TOOL_ITERATIONS = 5; // Prevent infinite loops
    let iteration = 0;
    
    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;
      
      // Check if aborted before making request
      if (currentAbortController?.signal.aborted) {
        sendStreamChunk({ content: '', done: true, aborted: true });
        break;
      }
      
      // First, make a non-streaming call to check for tool calls
      const checkParams = buildRequestParams(conversationHistory, false);
      const checkResponse = await ollama.chat(checkParams);
      
      // Check if the model wants to call tools
      if (checkResponse.message?.tool_calls && checkResponse.message.tool_calls.length > 0) {
        // Notify renderer that tools are being used
        sendStreamChunk({ 
          content: '', 
          toolCalls: checkResponse.message.tool_calls,
          isToolCall: true 
        });
        
        // Add assistant's message with tool calls to history
        conversationHistory.push(checkResponse.message);
        
        // Execute each tool call and add results to history
        for (const toolCall of checkResponse.message.tool_calls) {
          if (currentAbortController?.signal.aborted) {
            sendStreamChunk({ content: '', done: true, aborted: true });
            break;
          }
          const toolResult = await executeToolCall(toolCall);
          
          // Notify renderer of tool result
          sendStreamChunk({
            content: '',
            toolResult: {
              name: toolCall.function.name,
              result: toolResult
            },
            isToolResult: true
          });
          
          // Add tool result to conversation history
          conversationHistory.push({
            role: 'tool',
            content: toolResult,
          });
        }
        
        // Continue loop to get model's response with tool results
        continue;
      }
      
      // No tool calls - stream the final response
      const streamParams = buildRequestParams(conversationHistory, true);
      const response = await ollama.chat(streamParams);
      
      for await (const part of response) {
        // Check if aborted
        if (currentAbortController?.signal.aborted) {
          sendStreamChunk({ content: '', done: true, aborted: true });
          break;
        }
        
        // Send each chunk to renderer
        sendStreamChunk({
          content: part.message?.content || '',
          thinking: part.message?.thinking || '',
          done: part.done,
          ...(part.done && {
            totalDuration: part.total_duration,
            evalCount: part.eval_count,
            evalDuration: part.eval_duration,
          }),
        });
      }
      
      // Exit loop after streaming final response
      break;
    }
    
    // Warn if max iterations reached
    if (iteration >= MAX_TOOL_ITERATIONS) {
      console.warn('Max tool call iterations reached');
      sendStreamChunk({
        content: '\n\n[Warning: Maximum tool call iterations reached]',
        done: true
      });
    }

    return { success: true };
  } catch (error) {
    // Check if this was an abort error
    if (error.name === 'AbortError' || currentAbortController?.signal.aborted) {
      sendStreamChunk({ content: '', done: true, aborted: true });
      return { success: true, aborted: true };
    }
    return { success: false, error: error.message };
  } finally {
    currentAbortController = null;
  }
});

// Helper function to send stream chunks to renderer
function sendStreamChunk(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ollama:stream-chunk', data);
  }
}

// Chat without streaming (for simple requests)
// Also supports agentic tool calling
ipcMain.handle('ollama:chat', async (event, { model, messages, options }) => {
  try {
    const { useTools = true, ...modelOptions } = options || {};
    const effectiveUseTools = useTools && !shouldDisableToolsForModel(model);
    let conversationHistory = [...messages];
    
    const MAX_TOOL_ITERATIONS = 5;
    let iteration = 0;
    const toolCallsLog = [];
    
    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;
      
      const requestParams = {
        model,
        messages: conversationHistory,
        stream: false,
        options: modelOptions,
      };
      
      if (effectiveUseTools) {
        requestParams.tools = availableTools;
      }
      
      const response = await ollama.chat(requestParams);
      
      // Check if tools were called
      if (response.message?.tool_calls && response.message.tool_calls.length > 0) {
        conversationHistory.push(response.message);
        
        for (const toolCall of response.message.tool_calls) {
          const toolResult = await executeToolCall(toolCall);
          toolCallsLog.push({
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
            result: toolResult
          });
          
          conversationHistory.push({
            role: 'tool',
            content: toolResult,
          });
        }
        continue;
      }
      
      // No tool calls - return final response
      return { 
        success: true, 
        response,
        toolCalls: toolCallsLog.length > 0 ? toolCallsLog : undefined
      };
    }
    
    return { 
      success: true, 
      response: { message: { content: '[Max tool iterations reached]' } },
      toolCalls: toolCallsLog
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Generate embeddings
ipcMain.handle('ollama:embed', async (event, { model, input }) => {
  try {
    const response = await ollama.embed({ model, input });
    return { success: true, embeddings: response.embeddings };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Abort current generation
ipcMain.handle('ollama:abort', async () => {
  try {
    if (currentAbortController) {
      currentAbortController.abort();
    }
    // Also call ollama.abort() to stop the underlying request
    ollama.abort();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================
// AI Council Service - Dynamic Multi-Agent System
// ============================================

// Initialize AI Council Service instance
let councilService = null;

/**
 * Get or create the AI Council Service instance
 * Lazily initialized to ensure searchWeb is available
 */
function getCouncilService() {
  if (!councilService) {
    // Inject the real Tavily search function
    setSearchFunction(searchWeb);
    
    councilService = new AICouncilService({
      debug: true,
      // Progress callbacks - will be used for renderer updates
      onPhaseStart: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('council:phase-start', data);
        }
      },
      onPhaseComplete: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('council:phase-complete', data);
        }
      },
      onTaskStart: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('council:task-start', data);
        }
      },
      onTaskComplete: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('council:task-complete', data);
        }
      },
      onToolCall: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('council:tool-call', data);
        }
      }
    });
  }
  return councilService;
}

// AI Council: Health Check
ipcMain.handle('council:health-check', async () => {
  try {
    const council = getCouncilService();
    const health = await council.healthCheck();
    return { success: true, ...health };
  } catch (error) {
    console.error('[Council] Health check error:', error);
    return { success: false, error: error.message };
  }
});

// AI Council: Process Query (Full Workflow)
ipcMain.handle('council:process', async (event, { query, options = {} }) => {
  try {
    console.log('[Council] Processing query:', query);
    
    const council = getCouncilService();
    
    // Override models if specified in options
    if (options.chairmanModel) {
      council.chairmanModel = options.chairmanModel;
    }
    if (options.memberModel) {
      council.memberModel = options.memberModel;
    }
    
    const result = await council.processQuery(query);
    
    return { success: true, ...result };
  } catch (error) {
    console.error('[Council] Process error:', error);
    return { success: false, error: error.message };
  }
});

// AI Council: Get Configuration
ipcMain.handle('council:get-config', async () => {
  try {
    const council = getCouncilService();
    return {
      success: true,
      config: {
        chairmanModel: council.chairmanModel,
        memberModel: council.memberModel,
        baseUrl: council.baseUrl
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// AI Council: Update Configuration
ipcMain.handle('council:set-config', async (event, config) => {
  try {
    const council = getCouncilService();
    
    if (config.chairmanModel) {
      council.chairmanModel = config.chairmanModel;
    }
    if (config.memberModel) {
      council.memberModel = config.memberModel;
    }
    if (config.debug !== undefined) {
      council.debug = config.debug;
    }
    
    return {
      success: true,
      config: {
        chairmanModel: council.chairmanModel,
        memberModel: council.memberModel,
        debug: council.debug
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================
// App Lifecycle
// ============================================

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
