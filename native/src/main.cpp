/**
 * Ghost Text Native Addon - Main Entry Point
 * 
 * This module exposes the following functions to JavaScript:
 * - startMonitoring(callback): Begin global keyboard monitoring
 * - stopMonitoring(): Stop monitoring
 * - updateOverlay(text, x, y): Show ghost text at position
 * - hideOverlay(): Hide the ghost text overlay
 * - getTextContext(): Manually retrieve current text context
 */

#include "common.h"
#include "SystemMonitor.h"
#include "KeyboardHook.h"
#include "OverlayWindow.h"

namespace GhostText {

// Global instances
static std::unique_ptr<SystemMonitor> g_systemMonitor;
static std::unique_ptr<KeyboardHook> g_keyboardHook;
static std::unique_ptr<OverlayWindow> g_overlayWindow;
static Napi::ThreadSafeFunction g_tsfn;
static std::atomic<bool> g_initialized{false};

// Initialize COM for UI Automation
class ComInitializer {
public:
    ComInitializer() {
        HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
        m_initialized = SUCCEEDED(hr) || hr == S_FALSE;
    }
    
    ~ComInitializer() {
        if (m_initialized) {
            CoUninitialize();
        }
    }
    
    bool IsInitialized() const { return m_initialized; }
    
private:
    bool m_initialized = false;
};

static std::unique_ptr<ComInitializer> g_comInit;

// Forward declarations
void OnTypingPaused(const TextContext& context);
void OnFocusChanged(const TextContext& context);

/**
 * Initialize the native addon
 */
Napi::Value Initialize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (g_initialized) {
        return Napi::Boolean::New(env, true);
    }
    
    try {
        // Initialize COM
        g_comInit = std::make_unique<ComInitializer>();
        if (!g_comInit->IsInitialized()) {
            Napi::Error::New(env, "Failed to initialize COM").ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }
        
        // Create system monitor
        g_systemMonitor = std::make_unique<SystemMonitor>();
        if (!g_systemMonitor->Initialize()) {
            Napi::Error::New(env, "Failed to initialize UI Automation").ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }
        
        // Create overlay window
        g_overlayWindow = std::make_unique<OverlayWindow>();
        if (!g_overlayWindow->Initialize()) {
            Napi::Error::New(env, "Failed to create overlay window").ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }
        
        // Create keyboard hook (but don't start yet)
        g_keyboardHook = std::make_unique<KeyboardHook>();
        
        g_initialized = true;
        return Napi::Boolean::New(env, true);
        
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }
}

/**
 * Start global keyboard monitoring
 * @param callback Function(event: string, data: object)
 */
Napi::Value StartMonitoring(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_initialized) {
        Napi::Error::New(env, "Addon not initialized. Call initialize() first.").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    // Release previous ThreadSafeFunction if exists
    if (g_tsfn) {
        g_tsfn.Release();
    }
    
    // Create ThreadSafeFunction for safe JS callback from hook thread
    g_tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "GhostTextCallback",
        0,  // Unlimited queue
        1,  // Initial thread count
        [](Napi::Env) {
            // Destructor callback
        }
    );
    
    // Set up keyboard hook callbacks
    g_keyboardHook->SetTypingPausedCallback([](const TextContext& ctx) {
        OnTypingPaused(ctx);
    });
    
    g_keyboardHook->SetSystemMonitor(g_systemMonitor.get());
    
    // Start the hook
    if (!g_keyboardHook->Start()) {
        Napi::Error::New(env, "Failed to install keyboard hook").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    return Napi::Boolean::New(env, true);
}

/**
 * Stop keyboard monitoring
 */
Napi::Value StopMonitoring(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (g_keyboardHook) {
        g_keyboardHook->Stop();
    }
    
    if (g_tsfn) {
        g_tsfn.Release();
        g_tsfn = nullptr;
    }
    
    return Napi::Boolean::New(env, true);
}

/**
 * Update the overlay window with ghost text
 * @param text The completion text to display
 * @param x Screen X coordinate
 * @param y Screen Y coordinate
 */
Napi::Value UpdateOverlay(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_initialized || !g_overlayWindow) {
        return Napi::Boolean::New(env, false);
    }
    
    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Expected (text, x, y)").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    std::string text = info[0].As<Napi::String>().Utf8Value();
    int x = info[1].As<Napi::Number>().Int32Value();
    int y = info[2].As<Napi::Number>().Int32Value();
    
    // Optional: font size
    float fontSize = 14.0f;
    if (info.Length() >= 4 && info[3].IsNumber()) {
        fontSize = info[3].As<Napi::Number>().FloatValue();
    }
    
    g_overlayWindow->UpdateText(Utf8ToWide(text), x, y, fontSize);
    g_overlayWindow->Show();
    
    return Napi::Boolean::New(env, true);
}

/**
 * Hide the overlay window
 */
Napi::Value HideOverlay(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (g_overlayWindow) {
        g_overlayWindow->Hide();
    }
    
    return Napi::Boolean::New(env, true);
}

/**
 * Manually get the current text context
 */
Napi::Value GetTextContext(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_initialized || !g_systemMonitor) {
        return env.Null();
    }
    
    // Optional: context length
    int contextLength = DEFAULT_CONTEXT_LENGTH;
    if (info.Length() >= 1 && info[0].IsNumber()) {
        contextLength = info[0].As<Napi::Number>().Int32Value();
    }
    
    TextContext ctx = g_systemMonitor->GetCurrentContext(contextLength);
    
    if (!ctx.valid) {
        return env.Null();
    }
    
    Napi::Object result = Napi::Object::New(env);
    result.Set("text", Napi::String::New(env, WideToUtf8(ctx.text)));
    result.Set("processName", Napi::String::New(env, WideToUtf8(ctx.processName)));
    result.Set("windowTitle", Napi::String::New(env, WideToUtf8(ctx.windowTitle)));
    
    Napi::Object caret = Napi::Object::New(env);
    caret.Set("x", Napi::Number::New(env, ctx.caret.x));
    caret.Set("y", Napi::Number::New(env, ctx.caret.y));
    caret.Set("width", Napi::Number::New(env, ctx.caret.width));
    caret.Set("height", Napi::Number::New(env, ctx.caret.height));
    caret.Set("valid", Napi::Boolean::New(env, ctx.caret.valid));
    result.Set("caret", caret);
    
    return result;
}

/**
 * Cleanup and shutdown
 */
Napi::Value Shutdown(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (g_keyboardHook) {
        g_keyboardHook->Stop();
        g_keyboardHook.reset();
    }
    
    if (g_tsfn) {
        g_tsfn.Release();
        g_tsfn = nullptr;
    }
    
    if (g_overlayWindow) {
        g_overlayWindow->Destroy();
        g_overlayWindow.reset();
    }
    
    if (g_systemMonitor) {
        g_systemMonitor->Shutdown();
        g_systemMonitor.reset();
    }
    
    g_comInit.reset();
    g_initialized = false;
    
    return Napi::Boolean::New(env, true);
}

/**
 * Callback from keyboard hook when typing pauses
 * Called from hook thread - must use ThreadSafeFunction
 */
void OnTypingPaused(const TextContext& context) {
    GHOST_DEBUG(L"GhostText: OnTypingPaused in main.cpp called\n");
    
    if (!g_tsfn) {
        GHOST_DEBUG(L"GhostText: No ThreadSafeFunction!\n");
        return;
    }
    
    // Copy context for thread safety
    auto ctxCopy = std::make_shared<TextContext>(context);
    
    GHOST_DEBUG(L"GhostText: Calling ThreadSafeFunction...\n");
    
    napi_status status = g_tsfn.NonBlockingCall(ctxCopy.get(), [ctxCopy](Napi::Env env, Napi::Function callback, TextContext* ctx) {
        GHOST_DEBUG(L"GhostText: Inside TSFN callback\n");
        
        if (env == nullptr) {
            GHOST_DEBUG(L"GhostText: env is null!\n");
            return;
        }
        if (callback == nullptr) {
            GHOST_DEBUG(L"GhostText: callback is null!\n");
            return;
        }
        
        Napi::Object data = Napi::Object::New(env);
        data.Set("text", Napi::String::New(env, WideToUtf8(ctx->text)));
        data.Set("processName", Napi::String::New(env, WideToUtf8(ctx->processName)));
        data.Set("windowTitle", Napi::String::New(env, WideToUtf8(ctx->windowTitle)));
        
        Napi::Object caret = Napi::Object::New(env);
        caret.Set("x", Napi::Number::New(env, ctx->caret.x));
        caret.Set("y", Napi::Number::New(env, ctx->caret.y));
        caret.Set("width", Napi::Number::New(env, ctx->caret.width));
        caret.Set("height", Napi::Number::New(env, ctx->caret.height));
        caret.Set("valid", Napi::Boolean::New(env, ctx->caret.valid));
        data.Set("caret", caret);
        
        GHOST_DEBUG(L"GhostText: Calling JS callback function...\n");
        
        callback.Call({
            Napi::String::New(env, "typingPaused"),
            data
        });
        
        GHOST_DEBUG(L"GhostText: JS callback completed\n");
    });
    
    if (status != napi_ok) {
        GHOST_DEBUG(L"GhostText: NonBlockingCall failed!\n");
    } else {
        GHOST_DEBUG(L"GhostText: NonBlockingCall succeeded\n");
    }
}

/**
 * Module initialization
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("initialize", Napi::Function::New(env, Initialize));
    exports.Set("startMonitoring", Napi::Function::New(env, StartMonitoring));
    exports.Set("stopMonitoring", Napi::Function::New(env, StopMonitoring));
    exports.Set("updateOverlay", Napi::Function::New(env, UpdateOverlay));
    exports.Set("hideOverlay", Napi::Function::New(env, HideOverlay));
    exports.Set("getTextContext", Napi::Function::New(env, GetTextContext));
    exports.Set("shutdown", Napi::Function::New(env, Shutdown));
    
    return exports;
}

NODE_API_MODULE(ghost_text, Init)

} // namespace GhostText
