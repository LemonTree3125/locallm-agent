#pragma once

// Windows headers - must be included first
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <atlbase.h>
#include <atlcom.h>

// UI Automation
#include <uiautomation.h>

// Direct2D and DirectWrite
#include <d2d1.h>
#include <d2d1_1.h>
#include <dwrite.h>

// Standard library
#include <string>
#include <memory>
#include <functional>
#include <atomic>
#include <mutex>
#include <thread>
#include <queue>
#include <chrono>
#include <cstdio>

// Node-API
#include <napi.h>

// Debug logging macro - outputs to both OutputDebugString and stderr
#define GHOST_DEBUG(msg) do { \
    OutputDebugStringW(msg); \
    fwprintf(stderr, L"%s", msg); \
    fflush(stderr); \
} while(0)

// Link required libraries
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "kernel32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "uiautomationcore.lib")
#pragma comment(lib, "d2d1.lib")
#pragma comment(lib, "dwrite.lib")

namespace GhostText {

// Forward declarations
class SystemMonitor;
class KeyboardHook;
class OverlayWindow;

// Constants
constexpr int DEFAULT_CONTEXT_LENGTH = 100;
constexpr int DEBOUNCE_MS = 300;
constexpr UINT WM_GHOST_TEXT_UPDATE = WM_USER + 100;
constexpr UINT WM_GHOST_TEXT_HIDE = WM_USER + 101;

// Data structures
struct CaretInfo {
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
    bool valid = false;
};

struct TextContext {
    std::wstring text;
    std::wstring processName;
    std::wstring windowTitle;
    CaretInfo caret;
    bool valid = false;
};

// Event types sent to JavaScript
enum class EventType {
    TypingPaused,
    FocusChanged,
    Error
};

// Callback signature for JavaScript
using EventCallback = std::function<void(EventType, const TextContext&)>;

// Utility functions
inline std::string WideToUtf8(const std::wstring& wide) {
    if (wide.empty()) return std::string();
    
    int size = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), 
        static_cast<int>(wide.length()), nullptr, 0, nullptr, nullptr);
    
    std::string result(size, 0);
    WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), 
        static_cast<int>(wide.length()), &result[0], size, nullptr, nullptr);
    
    return result;
}

inline std::wstring Utf8ToWide(const std::string& utf8) {
    if (utf8.empty()) return std::wstring();
    
    int size = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), 
        static_cast<int>(utf8.length()), nullptr, 0);
    
    std::wstring result(size, 0);
    MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), 
        static_cast<int>(utf8.length()), &result[0], size);
    
    return result;
}

// Safe release template for COM objects
template<typename T>
inline void SafeRelease(T** ppT) {
    if (*ppT) {
        (*ppT)->Release();
        *ppT = nullptr;
    }
}

} // namespace GhostText
