/**
 * SystemMonitor Implementation
 * 
 * Windows UI Automation wrapper for retrieving text context
 * and caret position from the currently focused application.
 */

#include "SystemMonitor.h"
#include <psapi.h>
#include <algorithm>

#pragma comment(lib, "psapi.lib")

namespace GhostText {

SystemMonitor::SystemMonitor() = default;

SystemMonitor::~SystemMonitor() {
    Shutdown();
}

bool SystemMonitor::Initialize() {
    std::lock_guard<std::mutex> lock(m_mutex);
    
    if (m_initialized) {
        return true;
    }
    
    // Create the main UI Automation object
    HRESULT hr = m_automation.CoCreateInstance(
        CLSID_CUIAutomation,
        nullptr,
        CLSCTX_INPROC_SERVER
    );
    
    if (FAILED(hr) || !m_automation) {
        OutputDebugStringW(L"GhostText: Failed to create IUIAutomation\n");
        return false;
    }
    
    // Get the control view tree walker for navigating the UI tree
    hr = m_automation->get_ControlViewWalker(&m_treeWalker);
    if (FAILED(hr)) {
        OutputDebugStringW(L"GhostText: Failed to get tree walker\n");
        // Not fatal, continue without tree walker
    }
    
    // Create a condition to find text-related elements
    // We look for elements that support TextPattern or ValuePattern
    CComPtr<IUIAutomationCondition> textPatternCondition;
    hr = m_automation->CreatePropertyCondition(
        UIA_IsTextPatternAvailablePropertyId,
        CComVariant(TRUE),
        &textPatternCondition
    );
    
    CComPtr<IUIAutomationCondition> valuePatternCondition;
    hr = m_automation->CreatePropertyCondition(
        UIA_IsValuePatternAvailablePropertyId,
        CComVariant(TRUE),
        &valuePatternCondition
    );
    
    if (textPatternCondition && valuePatternCondition) {
        m_automation->CreateOrCondition(
            textPatternCondition,
            valuePatternCondition,
            &m_textCondition
        );
    }
    
    m_initialized = true;
    OutputDebugStringW(L"GhostText: SystemMonitor initialized\n");
    return true;
}

void SystemMonitor::Shutdown() {
    std::lock_guard<std::mutex> lock(m_mutex);
    
    // Release all COM pointers (CComPtr handles this, but being explicit)
    m_textCondition.Release();
    m_treeWalker.Release();
    m_automation.Release();
    
    m_initialized = false;
}

TextContext SystemMonitor::GetCurrentContext(int contextLength) {
    std::lock_guard<std::mutex> lock(m_mutex);
    
    TextContext result;
    
    if (!m_initialized || !m_automation) {
        return result;
    }
    
    // Get the focused element
    CComPtr<IUIAutomationElement> focusedElement = GetFocusedElement();
    if (!focusedElement) {
        return result;
    }
    
    // Get window info
    HWND hwnd = nullptr;
    focusedElement->get_CurrentNativeWindowHandle(reinterpret_cast<UIA_HWND*>(&hwnd));
    
    // If we don't have a window handle from the element, get the foreground window
    if (!hwnd) {
        hwnd = GetForegroundWindow();
    }
    
    if (hwnd) {
        result.processName = GetProcessNameFromHwnd(hwnd);
        
        // Get window title
        wchar_t title[256] = {0};
        GetWindowTextW(hwnd, title, 256);
        result.windowTitle = title;
    }
    
    // Try to get text using TextPattern first (most accurate)
    result.text = GetTextFromTextPattern(focusedElement, contextLength);
    
    // Fallback to ValuePattern if TextPattern didn't work
    if (result.text.empty()) {
        result.text = GetTextFromValuePattern(focusedElement, contextLength);
    }
    
    // Get caret position
    result.caret = GetCaretFromTextPattern(focusedElement);
    
    // Fallback to Win32 if UIA didn't provide caret info
    if (!result.caret.valid) {
        result.caret = GetCaretFromWin32();
    }
    
    result.valid = !result.text.empty() || result.caret.valid;
    
    return result;
}

CaretInfo SystemMonitor::GetCaretPosition() {
    std::lock_guard<std::mutex> lock(m_mutex);
    
    if (!m_initialized) {
        return CaretInfo{};
    }
    
    CComPtr<IUIAutomationElement> focusedElement = GetFocusedElement();
    if (focusedElement) {
        CaretInfo info = GetCaretFromTextPattern(focusedElement);
        if (info.valid) {
            return info;
        }
    }
    
    return GetCaretFromWin32();
}

std::wstring SystemMonitor::GetFocusedProcessName() {
    HWND hwnd = GetForegroundWindow();
    return hwnd ? GetProcessNameFromHwnd(hwnd) : L"";
}

std::wstring SystemMonitor::GetFocusedWindowTitle() {
    HWND hwnd = GetForegroundWindow();
    if (!hwnd) return L"";
    
    wchar_t title[256] = {0};
    GetWindowTextW(hwnd, title, 256);
    return title;
}

CComPtr<IUIAutomationElement> SystemMonitor::GetFocusedElement() {
    if (!m_automation) return nullptr;
    
    CComPtr<IUIAutomationElement> focused;
    HRESULT hr = m_automation->GetFocusedElement(&focused);
    
    if (FAILED(hr) || !focused) {
        // Fallback: try to get element from foreground window
        HWND hwnd = GetForegroundWindow();
        if (hwnd) {
            m_automation->ElementFromHandle(hwnd, &focused);
        }
    }
    
    return focused;
}

std::wstring SystemMonitor::GetTextFromTextPattern(IUIAutomationElement* element, int contextLength) {
    if (!element) return L"";
    
    CComPtr<IUIAutomationTextPattern2> textPattern2;
    HRESULT hr = element->GetCurrentPatternAs(
        UIA_TextPattern2Id,
        IID_PPV_ARGS(&textPattern2)
    );
    
    // Try TextPattern2 first for better caret support
    if (SUCCEEDED(hr) && textPattern2) {
        // Get the caret range
        BOOL isActive = FALSE;
        CComPtr<IUIAutomationTextRange> caretRange;
        hr = textPattern2->GetCaretRange(&isActive, &caretRange);
        
        if (SUCCEEDED(hr) && caretRange && isActive) {
            // Clone and expand to get context before caret
            CComPtr<IUIAutomationTextRange> contextRange;
            caretRange->Clone(&contextRange);
            
            if (contextRange) {
                // Move the start back by contextLength characters
                int moved = 0;
                contextRange->MoveEndpointByUnit(
                    TextPatternRangeEndpoint_Start,
                    TextUnit_Character,
                    -contextLength,
                    &moved
                );
                
                // Get the text
                CComBSTR text;
                hr = contextRange->GetText(-1, &text);
                
                if (SUCCEEDED(hr) && text) {
                    return std::wstring(text, SysStringLen(text));
                }
            }
        }
    }
    
    // Fallback to TextPattern (v1)
    CComPtr<IUIAutomationTextPattern> textPattern;
    hr = element->GetCurrentPatternAs(
        UIA_TextPatternId,
        IID_PPV_ARGS(&textPattern)
    );
    
    if (SUCCEEDED(hr) && textPattern) {
        // Get the selection
        CComPtr<IUIAutomationTextRangeArray> selections;
        hr = textPattern->GetSelection(&selections);
        
        if (SUCCEEDED(hr) && selections) {
            int length = 0;
            selections->get_Length(&length);
            
            if (length > 0) {
                CComPtr<IUIAutomationTextRange> selection;
                selections->GetElement(0, &selection);
                
                if (selection) {
                    // Clone and get text before selection
                    CComPtr<IUIAutomationTextRange> contextRange;
                    selection->Clone(&contextRange);
                    
                    if (contextRange) {
                        int moved = 0;
                        contextRange->MoveEndpointByUnit(
                            TextPatternRangeEndpoint_Start,
                            TextUnit_Character,
                            -contextLength,
                            &moved
                        );
                        
                        CComBSTR text;
                        contextRange->GetText(-1, &text);
                        
                        if (text) {
                            return std::wstring(text, SysStringLen(text));
                        }
                    }
                }
            }
        }
        
        // If no selection, try to get the document range
        CComPtr<IUIAutomationTextRange> documentRange;
        hr = textPattern->get_DocumentRange(&documentRange);
        
        if (SUCCEEDED(hr) && documentRange) {
            CComBSTR text;
            hr = documentRange->GetText(contextLength, &text);
            
            if (SUCCEEDED(hr) && text) {
                std::wstring fullText(text, SysStringLen(text));
                // Return last contextLength chars
                if (fullText.length() > static_cast<size_t>(contextLength)) {
                    return fullText.substr(fullText.length() - contextLength);
                }
                return fullText;
            }
        }
    }
    
    return L"";
}

std::wstring SystemMonitor::GetTextFromValuePattern(IUIAutomationElement* element, int contextLength) {
    if (!element) return L"";
    
    CComPtr<IUIAutomationValuePattern> valuePattern;
    HRESULT hr = element->GetCurrentPatternAs(
        UIA_ValuePatternId,
        IID_PPV_ARGS(&valuePattern)
    );
    
    if (SUCCEEDED(hr) && valuePattern) {
        CComBSTR value;
        hr = valuePattern->get_CurrentValue(&value);
        
        if (SUCCEEDED(hr) && value) {
            std::wstring text(value, SysStringLen(value));
            
            // Return last contextLength characters
            if (text.length() > static_cast<size_t>(contextLength)) {
                return text.substr(text.length() - contextLength);
            }
            return text;
        }
    }
    
    // Try Name property as last resort
    CComBSTR name;
    hr = element->get_CurrentName(&name);
    
    if (SUCCEEDED(hr) && name) {
        std::wstring text(name, SysStringLen(name));
        if (text.length() > static_cast<size_t>(contextLength)) {
            return text.substr(text.length() - contextLength);
        }
        return text;
    }
    
    return L"";
}

CaretInfo SystemMonitor::GetCaretFromTextPattern(IUIAutomationElement* element) {
    CaretInfo info;
    
    if (!element) return info;
    
    CComPtr<IUIAutomationTextPattern2> textPattern2;
    HRESULT hr = element->GetCurrentPatternAs(
        UIA_TextPattern2Id,
        IID_PPV_ARGS(&textPattern2)
    );
    
    if (SUCCEEDED(hr) && textPattern2) {
        BOOL isActive = FALSE;
        CComPtr<IUIAutomationTextRange> caretRange;
        hr = textPattern2->GetCaretRange(&isActive, &caretRange);
        
        if (SUCCEEDED(hr) && caretRange && isActive) {
            // Get bounding rectangles
            SAFEARRAY* rects = nullptr;
            hr = caretRange->GetBoundingRectangles(&rects);
            
            if (SUCCEEDED(hr) && rects) {
                LONG lBound = 0, uBound = 0;
                SafeArrayGetLBound(rects, 1, &lBound);
                SafeArrayGetUBound(rects, 1, &uBound);
                
                if (uBound >= lBound + 3) {
                    double* data = nullptr;
                    SafeArrayAccessData(rects, reinterpret_cast<void**>(&data));
                    
                    if (data) {
                        // Format: [x, y, width, height, ...]
                        info.x = static_cast<int>(data[0]);
                        info.y = static_cast<int>(data[1]);
                        info.width = static_cast<int>(data[2]);
                        info.height = static_cast<int>(data[3]);
                        info.valid = true;
                        
                        SafeArrayUnaccessData(rects);
                    }
                }
                
                SafeArrayDestroy(rects);
            }
        }
    }
    
    return info;
}

CaretInfo SystemMonitor::GetCaretFromWin32() {
    CaretInfo info;
    
    HWND hwnd = GetForegroundWindow();
    if (!hwnd) return info;
    
    DWORD processId = 0;
    DWORD threadId = GetWindowThreadProcessId(hwnd, &processId);
    
    if (threadId == 0) return info;
    
    // Attach to the thread to access its GUI state
    DWORD currentThread = GetCurrentThreadId();
    BOOL attached = FALSE;
    
    if (currentThread != threadId) {
        attached = AttachThreadInput(currentThread, threadId, TRUE);
    }
    
    GUITHREADINFO gti = {0};
    gti.cbSize = sizeof(GUITHREADINFO);
    
    if (GetGUIThreadInfo(threadId, &gti)) {
        if (gti.hwndCaret) {
            // Convert caret position to screen coordinates
            POINT pt = {gti.rcCaret.left, gti.rcCaret.top};
            ClientToScreen(gti.hwndCaret, &pt);
            
            info.x = pt.x;
            info.y = pt.y;
            info.width = gti.rcCaret.right - gti.rcCaret.left;
            info.height = gti.rcCaret.bottom - gti.rcCaret.top;
            info.valid = true;
        } else if (gti.hwndFocus) {
            // No caret, try to get cursor position relative to focused window
            POINT cursorPos;
            if (GetCursorPos(&cursorPos)) {
                info.x = cursorPos.x;
                info.y = cursorPos.y;
                info.width = 1;
                info.height = 16; // Default text height
                info.valid = true;
            }
        }
    }
    
    if (attached) {
        AttachThreadInput(currentThread, threadId, FALSE);
    }
    
    return info;
}

std::wstring SystemMonitor::GetProcessNameFromHwnd(HWND hwnd) {
    if (!hwnd) return L"";
    
    DWORD processId = 0;
    GetWindowThreadProcessId(hwnd, &processId);
    
    if (processId == 0) return L"";
    
    HANDLE hProcess = OpenProcess(
        PROCESS_QUERY_LIMITED_INFORMATION,
        FALSE,
        processId
    );
    
    if (!hProcess) return L"";
    
    wchar_t processPath[MAX_PATH] = {0};
    DWORD size = MAX_PATH;
    
    std::wstring result;
    
    if (QueryFullProcessImageNameW(hProcess, 0, processPath, &size)) {
        // Extract just the filename
        std::wstring path(processPath);
        size_t pos = path.find_last_of(L"\\/");
        if (pos != std::wstring::npos) {
            result = path.substr(pos + 1);
        } else {
            result = path;
        }
    }
    
    CloseHandle(hProcess);
    return result;
}

} // namespace GhostText
