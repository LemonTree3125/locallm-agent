/**
 * KeyboardHook Implementation
 * 
 * Global low-level keyboard hook for detecting typing activity
 * across all applications on Windows.
 */

#include "KeyboardHook.h"
#include "SystemMonitor.h"

namespace GhostText {

// Static instance pointer for hook callback
KeyboardHook* KeyboardHook::s_instance = nullptr;

KeyboardHook::KeyboardHook() {
    // Only one instance can have the hook at a time
    s_instance = this;
}

KeyboardHook::~KeyboardHook() {
    Stop();
    if (s_instance == this) {
        s_instance = nullptr;
    }
}

bool KeyboardHook::Start() {
    if (m_running) {
        return true;
    }
    
    m_shouldStop = false;
    m_debounceActive = false;
    
    // Start the hook thread
    m_hookThread = std::thread(&KeyboardHook::HookThreadProc, this);
    
    // Wait for hook to be installed
    for (int i = 0; i < 50 && !m_running; ++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    
    if (!m_running) {
        m_shouldStop = true;
        if (m_hookThread.joinable()) {
            m_hookThread.join();
        }
        return false;
    }
    
    // Start the debounce thread
    m_debounceThread = std::thread(&KeyboardHook::DebounceThreadProc, this);
    
    GHOST_DEBUG(L"GhostText: Keyboard hook started successfully\n");
    return true;
}

void KeyboardHook::Stop() {
    if (!m_running && !m_hookThread.joinable()) {
        return;
    }
    
    m_shouldStop = true;
    m_debounceActive = false;
    m_debounceCV.notify_all();
    
    // Post quit message to hook thread
    if (m_hookThreadId != 0) {
        PostThreadMessageW(m_hookThreadId, WM_QUIT, 0, 0);
    }
    
    // Wait for threads to finish
    if (m_hookThread.joinable()) {
        m_hookThread.join();
    }
    
    if (m_debounceThread.joinable()) {
        m_debounceThread.join();
    }
    
    m_running = false;
    m_hookThreadId = 0;
    
    GHOST_DEBUG(L"GhostText: Keyboard hook stopped\n");
}

void KeyboardHook::SetTypingPausedCallback(TypingPausedCallback callback) {
    std::lock_guard<std::mutex> lock(m_callbackMutex);
    m_typingPausedCallback = std::move(callback);
}

void KeyboardHook::SetSystemMonitor(SystemMonitor* monitor) {
    m_systemMonitor = monitor;
}

void KeyboardHook::HookThreadProc() {
    m_hookThreadId = GetCurrentThreadId();
    
    // Install the low-level keyboard hook
    m_hook = SetWindowsHookExW(
        WH_KEYBOARD_LL,
        LowLevelKeyboardProc,
        GetModuleHandleW(nullptr),
        0  // Hook all threads (global hook)
    );
    
    if (!m_hook) {
        DWORD error = GetLastError();
        wchar_t msg[256];
        swprintf_s(msg, L"GhostText: Failed to install keyboard hook, error: %lu\n", error);
        OutputDebugStringW(msg);
        return;
    }
    
    m_running = true;
    
    // Message pump - required for low-level hooks
    MSG msg;
    while (!m_shouldStop) {
        BOOL result = GetMessageW(&msg, nullptr, 0, 0);
        
        if (result == -1) {
            // Error
            break;
        } else if (result == 0) {
            // WM_QUIT
            break;
        }
        
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    
    // Unhook
    if (m_hook) {
        UnhookWindowsHookEx(m_hook);
        m_hook = nullptr;
    }
    
    m_running = false;
}

void KeyboardHook::DebounceThreadProc() {
    while (!m_shouldStop) {
        std::unique_lock<std::mutex> lock(m_debounceMutex);
        
        // Wait for debounce to become active or stop signal
        m_debounceCV.wait(lock, [this] {
            return m_debounceActive || m_shouldStop;
        });
        
        if (m_shouldStop) {
            break;
        }
        
        // Wait for debounce period
        auto deadline = m_lastKeyTime + std::chrono::milliseconds(m_debounceMs);
        
        if (m_debounceCV.wait_until(lock, deadline, [this] {
            return m_shouldStop || !m_debounceActive;
        })) {
            // Woke up early - either stopping or timer was reset
            continue;
        }
        
        // Check if we should still fire (no new keystrokes)
        auto now = std::chrono::steady_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            now - m_lastKeyTime
        ).count();
        
        if (elapsed >= m_debounceMs && m_debounceActive) {
            m_debounceActive = false;
            lock.unlock();
            
            // Trigger callback
            OnTypingPaused();
        }
    }
}

LRESULT CALLBACK KeyboardHook::LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode == HC_ACTION && s_instance) {
        KBDLLHOOKSTRUCT* kbd = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
        
        if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) {
            GHOST_DEBUG(L"GhostText: Key detected in hook\n");
            s_instance->OnKeyPress(kbd->vkCode, kbd->flags);
        }
    }
    
    // Always call the next hook
    return CallNextHookEx(nullptr, nCode, wParam, lParam);
}

void KeyboardHook::OnKeyPress(DWORD vkCode, DWORD flags) {
    // Ignore injected keys (to prevent feedback loops)
    if (flags & LLKHF_INJECTED) {
        GHOST_DEBUG(L"GhostText: Ignoring injected key\n");
        return;
    }
    
    // Only trigger on typing keys
    if (!IsTypingKey(vkCode)) {
        return;
    }
    
    GHOST_DEBUG(L"GhostText: Typing key detected, resetting debounce\n");
    // Reset debounce timer
    ResetDebounceTimer();
}

void KeyboardHook::OnTypingPaused() {
    GHOST_DEBUG(L"GhostText: Debounce fired - OnTypingPaused called\n");
    
    if (!m_systemMonitor) {
        GHOST_DEBUG(L"GhostText: No system monitor!\n");
        return;
    }
    
    // Get current context
    GHOST_DEBUG(L"GhostText: Getting current context...\n");
    TextContext ctx = m_systemMonitor->GetCurrentContext();
    
    wchar_t debugMsg[512];
    swprintf_s(debugMsg, L"GhostText: Context valid=%d, text length=%zu, caret valid=%d\n", 
        ctx.valid, ctx.text.length(), ctx.caret.valid);
    GHOST_DEBUG(debugMsg);
    
    if (!ctx.valid) {
        GHOST_DEBUG(L"GhostText: Context not valid, skipping\n");
        return;
    }
    
    // Invoke callback
    GHOST_DEBUG(L"GhostText: Invoking JS callback...\n");
    std::lock_guard<std::mutex> lock(m_callbackMutex);
    if (m_typingPausedCallback) {
        try {
            m_typingPausedCallback(ctx);
            GHOST_DEBUG(L"GhostText: JS callback invoked successfully\n");
        } catch (...) {
            GHOST_DEBUG(L"GhostText: Exception in typing paused callback\n");
        }
    } else {
        GHOST_DEBUG(L"GhostText: No callback registered!\n");
    }
}

bool KeyboardHook::IsTypingKey(DWORD vkCode) const {
    // Alphanumeric keys
    if ((vkCode >= 'A' && vkCode <= 'Z') ||
        (vkCode >= '0' && vkCode <= '9')) {
        return true;
    }
    
    // Numpad keys
    if (vkCode >= VK_NUMPAD0 && vkCode <= VK_NUMPAD9) {
        return true;
    }
    
    // Space, enter, backspace, delete
    if (vkCode == VK_SPACE || vkCode == VK_RETURN ||
        vkCode == VK_BACK || vkCode == VK_DELETE) {
        return true;
    }
    
    // OEM keys (punctuation, etc.)
    if (vkCode >= VK_OEM_1 && vkCode <= VK_OEM_8) {
        return true;
    }
    
    // Additional OEM keys
    if (vkCode == VK_OEM_PLUS || vkCode == VK_OEM_COMMA ||
        vkCode == VK_OEM_MINUS || vkCode == VK_OEM_PERIOD) {
        return true;
    }
    
    // Tab (for code completion context)
    if (vkCode == VK_TAB) {
        return true;
    }
    
    return false;
}

void KeyboardHook::ResetDebounceTimer() {
    std::lock_guard<std::mutex> lock(m_debounceMutex);
    m_lastKeyTime = std::chrono::steady_clock::now();
    
    if (!m_debounceActive) {
        m_debounceActive = true;
        m_debounceCV.notify_one();
    }
}

} // namespace GhostText
