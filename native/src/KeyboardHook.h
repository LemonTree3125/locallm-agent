#pragma once

#include "common.h"

namespace GhostText {

class SystemMonitor;

/**
 * KeyboardHook - Global low-level keyboard hook
 * 
 * Responsible for:
 * - Installing WH_KEYBOARD_LL hook for system-wide key monitoring
 * - Debouncing typing activity
 * - Triggering context retrieval when typing pauses
 * - Running hook message pump on dedicated thread
 * 
 * Thread Safety:
 * - Hook callback runs on the hook thread
 * - Uses atomic flags for state management
 * - Callbacks are invoked via the hook thread
 */
class KeyboardHook {
public:
    using TypingPausedCallback = std::function<void(const TextContext&)>;
    
    KeyboardHook();
    ~KeyboardHook();
    
    // Disable copy
    KeyboardHook(const KeyboardHook&) = delete;
    KeyboardHook& operator=(const KeyboardHook&) = delete;
    
    /**
     * Start the keyboard hook
     * @return true if hook installed successfully
     */
    bool Start();
    
    /**
     * Stop the keyboard hook
     */
    void Stop();
    
    /**
     * Check if hook is currently running
     */
    bool IsRunning() const { return m_running; }
    
    /**
     * Set the callback for when typing pauses
     * @param callback Function to call with text context
     */
    void SetTypingPausedCallback(TypingPausedCallback callback);
    
    /**
     * Set the system monitor for context retrieval
     * @param monitor Pointer to SystemMonitor (not owned)
     */
    void SetSystemMonitor(SystemMonitor* monitor);
    
    /**
     * Set debounce delay in milliseconds
     * @param ms Delay after last keystroke before triggering
     */
    void SetDebounceMs(int ms) { m_debounceMs = ms; }
    
    /**
     * Get debounce delay
     */
    int GetDebounceMs() const { return m_debounceMs; }

private:
    // Hook handle
    HHOOK m_hook = nullptr;
    
    // Hook thread
    std::thread m_hookThread;
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_shouldStop{false};
    
    // Debounce timer
    std::thread m_debounceThread;
    std::atomic<bool> m_debounceActive{false};
    std::chrono::steady_clock::time_point m_lastKeyTime;
    std::mutex m_debounceMutex;
    std::condition_variable m_debounceCV;
    
    // Configuration
    int m_debounceMs = DEBOUNCE_MS;
    
    // Callbacks
    TypingPausedCallback m_typingPausedCallback;
    std::mutex m_callbackMutex;
    
    // System monitor reference
    SystemMonitor* m_systemMonitor = nullptr;
    
    // Thread IDs for hook
    DWORD m_hookThreadId = 0;
    
    // Static hook procedure and instance
    static KeyboardHook* s_instance;
    static LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam);
    
    /**
     * Hook thread entry point
     */
    void HookThreadProc();
    
    /**
     * Debounce thread entry point
     */
    void DebounceThreadProc();
    
    /**
     * Called when a key is pressed
     * @param vkCode Virtual key code
     * @param flags Key flags
     */
    void OnKeyPress(DWORD vkCode, DWORD flags);
    
    /**
     * Called when debounce timer fires
     */
    void OnTypingPaused();
    
    /**
     * Check if key is a typing key (not modifier, etc.)
     * @param vkCode Virtual key code
     * @return true if this is a typing key
     */
    bool IsTypingKey(DWORD vkCode) const;
    
    /**
     * Reset the debounce timer
     */
    void ResetDebounceTimer();
};

} // namespace GhostText
