#pragma once

#include "common.h"

namespace GhostText {

/**
 * SystemMonitor - Windows UI Automation wrapper
 * 
 * Responsible for:
 * - Initializing and managing IUIAutomation COM interface
 * - Getting the currently focused element
 * - Retrieving caret/cursor position
 * - Extracting text context from the focused element
 * 
 * Uses CComPtr for strict COM pointer management to prevent leaks.
 */
class SystemMonitor {
public:
    SystemMonitor();
    ~SystemMonitor();
    
    // Disable copy
    SystemMonitor(const SystemMonitor&) = delete;
    SystemMonitor& operator=(const SystemMonitor&) = delete;
    
    /**
     * Initialize UI Automation
     * @return true if successful
     */
    bool Initialize();
    
    /**
     * Shutdown and release all COM resources
     */
    void Shutdown();
    
    /**
     * Get the current text context from the focused element
     * @param contextLength Maximum characters to retrieve before caret
     * @return TextContext with text, caret position, and window info
     */
    TextContext GetCurrentContext(int contextLength = DEFAULT_CONTEXT_LENGTH);
    
    /**
     * Get just the caret position
     * @return CaretInfo with screen coordinates
     */
    CaretInfo GetCaretPosition();
    
    /**
     * Get the name of the process owning the focused window
     * @return Process name (e.g., "notepad.exe")
     */
    std::wstring GetFocusedProcessName();
    
    /**
     * Get the title of the focused window
     * @return Window title
     */
    std::wstring GetFocusedWindowTitle();
    
    /**
     * Check if initialized
     */
    bool IsInitialized() const { return m_initialized; }

private:
    // UI Automation interfaces - using CComPtr for automatic release
    CComPtr<IUIAutomation> m_automation;
    CComPtr<IUIAutomationTreeWalker> m_treeWalker;
    
    // Cached condition for finding text elements
    CComPtr<IUIAutomationCondition> m_textCondition;
    
    bool m_initialized = false;
    std::mutex m_mutex;
    
    /**
     * Get the currently focused UI element
     * @return Focused element or nullptr
     */
    CComPtr<IUIAutomationElement> GetFocusedElement();
    
    /**
     * Try to get text from element using TextPattern
     * @param element The UI element
     * @param contextLength Max chars to retrieve
     * @return Text string or empty if not available
     */
    std::wstring GetTextFromTextPattern(IUIAutomationElement* element, int contextLength);
    
    /**
     * Try to get text from element using ValuePattern
     * @param element The UI element
     * @param contextLength Max chars to retrieve
     * @return Text string or empty if not available
     */
    std::wstring GetTextFromValuePattern(IUIAutomationElement* element, int contextLength);
    
    /**
     * Get caret position using TextPattern2
     * @param element The UI element
     * @return CaretInfo with position
     */
    CaretInfo GetCaretFromTextPattern(IUIAutomationElement* element);
    
    /**
     * Fallback: Get caret position using Win32 GetCaretPos
     * @return CaretInfo with position
     */
    CaretInfo GetCaretFromWin32();
    
    /**
     * Get process name from window handle
     * @param hwnd Window handle
     * @return Process name
     */
    std::wstring GetProcessNameFromHwnd(HWND hwnd);
};

} // namespace GhostText
