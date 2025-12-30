#pragma once

#include "common.h"

namespace GhostText {

/**
 * OverlayWindow - Transparent layered window for ghost text rendering
 * 
 * Responsible for:
 * - Creating a transparent, click-through Win32 window
 * - Rendering text using Direct2D/DirectWrite
 * - Managing window position and visibility
 * 
 * Window Properties:
 * - WS_EX_LAYERED: Supports per-pixel alpha
 * - WS_EX_TRANSPARENT: Click-through
 * - WS_EX_TOPMOST: Always on top
 * - WS_EX_NOACTIVATE: Never steals focus
 * - WS_EX_TOOLWINDOW: Hidden from taskbar/alt-tab
 */
class OverlayWindow {
public:
    OverlayWindow();
    ~OverlayWindow();
    
    // Disable copy
    OverlayWindow(const OverlayWindow&) = delete;
    OverlayWindow& operator=(const OverlayWindow&) = delete;
    
    /**
     * Initialize the overlay window and D2D resources
     * @return true if successful
     */
    bool Initialize();
    
    /**
     * Destroy the window and release resources
     */
    void Destroy();
    
    /**
     * Update the ghost text and position
     * @param text Text to display
     * @param x Screen X coordinate (caret position)
     * @param y Screen Y coordinate (caret position)
     * @param fontSize Font size in points
     */
    void UpdateText(const std::wstring& text, int x, int y, float fontSize = 14.0f);
    
    /**
     * Show the overlay window
     */
    void Show();
    
    /**
     * Hide the overlay window
     */
    void Hide();
    
    /**
     * Check if window is visible
     */
    bool IsVisible() const { return m_visible; }
    
    /**
     * Set text color (RGBA)
     */
    void SetTextColor(float r, float g, float b, float a = 0.7f);
    
    /**
     * Set background color (RGBA)
     */
    void SetBackgroundColor(float r, float g, float b, float a = 0.0f);
    
    /**
     * Set font name
     */
    void SetFontName(const std::wstring& fontName);

private:
    // Window
    HWND m_hwnd = nullptr;
    ATOM m_windowClass = 0;
    bool m_visible = false;
    
    // Window thread
    std::thread m_windowThread;
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_shouldStop{false};
    DWORD m_windowThreadId = 0;
    std::mutex m_initMutex;
    std::condition_variable m_initCV;
    bool m_initComplete = false;
    bool m_initSuccess = false;
    
    // Direct2D
    ID2D1Factory* m_d2dFactory = nullptr;
    ID2D1HwndRenderTarget* m_renderTarget = nullptr;
    ID2D1SolidColorBrush* m_textBrush = nullptr;
    ID2D1SolidColorBrush* m_backgroundBrush = nullptr;
    
    // DirectWrite
    IDWriteFactory* m_dwriteFactory = nullptr;
    IDWriteTextFormat* m_textFormat = nullptr;
    
    // Text state
    std::wstring m_text;
    int m_posX = 0;
    int m_posY = 0;
    float m_fontSize = 14.0f;
    std::mutex m_textMutex;
    
    // Colors
    D2D1_COLOR_F m_textColor = {0.5f, 0.5f, 0.5f, 0.7f};    // Gray, semi-transparent
    D2D1_COLOR_F m_backgroundColor = {0.0f, 0.0f, 0.0f, 0.0f}; // Fully transparent
    
    // Font
    std::wstring m_fontName = L"Consolas";
    
    // Window message IDs
    static constexpr UINT WM_UPDATE_TEXT = WM_USER + 1;
    static constexpr UINT WM_SHOW_OVERLAY = WM_USER + 2;
    static constexpr UINT WM_HIDE_OVERLAY = WM_USER + 3;
    
    // Static window procedure
    static LRESULT CALLBACK WindowProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);
    
    /**
     * Window thread entry point
     */
    void WindowThreadProc();
    
    /**
     * Register the window class
     * @return true if successful
     */
    bool RegisterWindowClass();
    
    /**
     * Create the overlay window
     * @return true if successful
     */
    bool CreateOverlayWindow();
    
    /**
     * Initialize Direct2D resources
     * @return true if successful
     */
    bool InitializeD2D();
    
    /**
     * Create device-dependent resources
     * @return true if successful
     */
    bool CreateDeviceResources();
    
    /**
     * Release device-dependent resources
     */
    void ReleaseDeviceResources();
    
    /**
     * Update the text format (font)
     */
    void UpdateTextFormat();
    
    /**
     * Render the overlay
     */
    void Render();
    
    /**
     * Calculate required window size for text
     * @param text Text to measure
     * @param width Output width
     * @param height Output height
     */
    void MeasureText(const std::wstring& text, float& width, float& height);
    
    /**
     * Handle WM_PAINT
     */
    void OnPaint();
};

} // namespace GhostText
