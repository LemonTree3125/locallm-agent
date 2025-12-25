const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Ollama } = require('ollama');

// Initialize Ollama client pointing to local instance
const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

let mainWindow;
let currentAbortController = null;

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
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

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
    // Setting keep_alive to 0 immediately unloads the model
    await ollama.generate({
      model: modelName,
      prompt: '',
      keep_alive: 0,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Chat with streaming - sends chunks back to renderer
ipcMain.handle('ollama:chat-stream', async (event, { model, messages, options }) => {
  // Create new abort controller for this request
  currentAbortController = new AbortController();
  
  try {
    // Extract keep_alive and think from options (they're top-level params, not in options)
    const { keep_alive, think, ...modelOptions } = options || {};
    
    const requestParams = {
      model,
      messages,
      stream: true,
      options: modelOptions,
    };
    
    // Add keep_alive if specified
    if (keep_alive !== undefined) {
      requestParams.keep_alive = keep_alive;
    }
    
    // Enable thinking mode for reasoning models (DeepSeek R1, etc.)
    // This tells Ollama to output thinking content separately
    if (think !== undefined) {
      requestParams.think = think;
    }
    
    const response = await ollama.chat(requestParams);

    for await (const part of response) {
      // Check if aborted
      if (currentAbortController?.signal.aborted) {
        // Send final chunk to signal completion
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ollama:stream-chunk', {
            content: '',
            done: true,
            aborted: true,
          });
        }
        break;
      }
      
      // Send each chunk to renderer
      // In newer Ollama, thinking comes as a separate field from content
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ollama:stream-chunk', {
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
    }

    return { success: true };
  } catch (error) {
    // Check if this was an abort error
    if (error.name === 'AbortError' || currentAbortController?.signal.aborted) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ollama:stream-chunk', {
          content: '',
          done: true,
          aborted: true,
        });
      }
      return { success: true, aborted: true };
    }
    return { success: false, error: error.message };
  } finally {
    currentAbortController = null;
  }
});

// Chat without streaming (for simple requests)
ipcMain.handle('ollama:chat', async (event, { model, messages, options }) => {
  try {
    const response = await ollama.chat({
      model,
      messages,
      stream: false,
      options: options || {},
    });
    return { success: true, response };
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
