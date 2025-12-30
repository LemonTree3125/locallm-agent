/**
 * OverlayWindow Implementation
 * 
 * Creates a transparent, click-through overlay window that renders
 * ghost text using Direct2D. The window never steals focus from
 * other applications.
 */

#include "OverlayWindow.h"

namespace GhostText {

// Window class name
static const wchar_t* OVERLAY_CLASS_NAME = L"GhostTextOverlay";

OverlayWindow::OverlayWindow() = default;

OverlayWindow::~OverlayWindow() {
    Destroy();
}

bool OverlayWindow::Initialize() {
    if (m_running) {
        return true;
    }
    
    m_shouldStop = false;
    m_initComplete = false;
    m_initSuccess = false;
    
    // Create window on a dedicated thread (required for proper message handling)
    m_windowThread = std::thread(&OverlayWindow::WindowThreadProc, this);
    
    // Wait for initialization to complete
    {
        std::unique_lock<std::mutex> lock(m_initMutex);
        m_initCV.wait(lock, [this] { return m_initComplete; });
    }
    
    if (!m_initSuccess) {
        if (m_windowThread.joinable()) {
            m_shouldStop = true;
            if (m_windowThreadId != 0) {
                PostThreadMessageW(m_windowThreadId, WM_QUIT, 0, 0);
            }
            m_windowThread.join();
        }
        return false;
    }
    
    OutputDebugStringW(L"GhostText: Overlay window initialized\n");
    return true;
}

void OverlayWindow::Destroy() {
    if (!m_running && !m_windowThread.joinable()) {
        return;
    }
    
    m_shouldStop = true;
    
    if (m_windowThreadId != 0) {
        PostThreadMessageW(m_windowThreadId, WM_QUIT, 0, 0);
    }
    
    if (m_windowThread.joinable()) {
        m_windowThread.join();
    }
    
    m_running = false;
    m_visible = false;
    
    OutputDebugStringW(L"GhostText: Overlay window destroyed\n");
}

void OverlayWindow::WindowThreadProc() {
    m_windowThreadId = GetCurrentThreadId();
    
    // Initialize COM for this thread (needed for D2D)
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr) && hr != S_FALSE) {
        std::lock_guard<std::mutex> lock(m_initMutex);
        m_initComplete = true;
        m_initSuccess = false;
        m_initCV.notify_one();
        return;
    }
    
    bool success = false;
    
    // Initialize D2D first
    if (InitializeD2D()) {
        // Register window class
        if (RegisterWindowClass()) {
            // Create the window
            if (CreateOverlayWindow()) {
                success = true;
            }
        }
    }
    
    // Signal initialization complete
    {
        std::lock_guard<std::mutex> lock(m_initMutex);
        m_initComplete = true;
        m_initSuccess = success;
        m_initCV.notify_one();
    }
    
    if (!success) {
        CoUninitialize();
        return;
    }
    
    m_running = true;
    
    // Message pump
    MSG msg;
    while (!m_shouldStop) {
        BOOL result = GetMessageW(&msg, nullptr, 0, 0);
        
        if (result == -1 || result == 0) {
            break;
        }
        
        // Handle custom messages
        if (msg.message == WM_UPDATE_TEXT || 
            msg.message == WM_SHOW_OVERLAY || 
            msg.message == WM_HIDE_OVERLAY) {
            
            // Dispatch to our window
            if (m_hwnd) {
                SendMessageW(m_hwnd, msg.message, msg.wParam, msg.lParam);
            }
            continue;
        }
        
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    
    // Cleanup
    ReleaseDeviceResources();
    
    SafeRelease(&m_textFormat);
    SafeRelease(&m_dwriteFactory);
    SafeRelease(&m_d2dFactory);
    
    if (m_hwnd) {
        DestroyWindow(m_hwnd);
        m_hwnd = nullptr;
    }
    
    if (m_windowClass) {
        UnregisterClassW(OVERLAY_CLASS_NAME, GetModuleHandleW(nullptr));
        m_windowClass = 0;
    }
    
    CoUninitialize();
    m_running = false;
}

bool OverlayWindow::RegisterWindowClass() {
    WNDCLASSEXW wc = {0};
    wc.cbSize = sizeof(WNDCLASSEXW);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpszClassName = OVERLAY_CLASS_NAME;
    
    m_windowClass = RegisterClassExW(&wc);
    
    if (!m_windowClass) {
        // Class might already exist
        DWORD error = GetLastError();
        if (error != ERROR_CLASS_ALREADY_EXISTS) {
            wchar_t msg[256];
            swprintf_s(msg, L"GhostText: Failed to register window class, error: %lu\n", error);
            OutputDebugStringW(msg);
            return false;
        }
    }
    
    return true;
}

bool OverlayWindow::CreateOverlayWindow() {
    // Extended styles for overlay
    DWORD exStyle = WS_EX_LAYERED |      // Per-pixel alpha
                    WS_EX_TRANSPARENT |   // Click-through
                    WS_EX_TOPMOST |       // Always on top
                    WS_EX_NOACTIVATE |    // Never steal focus
                    WS_EX_TOOLWINDOW;     // Hidden from taskbar
    
    // Window style - popup with no border
    DWORD style = WS_POPUP;
    
    m_hwnd = CreateWindowExW(
        exStyle,
        OVERLAY_CLASS_NAME,
        L"GhostText",
        style,
        0, 0, 400, 100,  // Initial size, will be adjusted
        nullptr,
        nullptr,
        GetModuleHandleW(nullptr),
        this  // Pass this pointer for WM_CREATE
    );
    
    if (!m_hwnd) {
        DWORD error = GetLastError();
        wchar_t msg[256];
        swprintf_s(msg, L"GhostText: Failed to create window, error: %lu\n", error);
        OutputDebugStringW(msg);
        return false;
    }
    
    // Set layered window attributes for full alpha
    SetLayeredWindowAttributes(m_hwnd, 0, 255, LWA_ALPHA);
    
    // Create device resources
    if (!CreateDeviceResources()) {
        DestroyWindow(m_hwnd);
        m_hwnd = nullptr;
        return false;
    }
    
    return true;
}

bool OverlayWindow::InitializeD2D() {
    // Create D2D factory
    HRESULT hr = D2D1CreateFactory(
        D2D1_FACTORY_TYPE_SINGLE_THREADED,
        &m_d2dFactory
    );
    
    if (FAILED(hr)) {
        OutputDebugStringW(L"GhostText: Failed to create D2D factory\n");
        return false;
    }
    
    // Create DirectWrite factory
    hr = DWriteCreateFactory(
        DWRITE_FACTORY_TYPE_SHARED,
        __uuidof(IDWriteFactory),
        reinterpret_cast<IUnknown**>(&m_dwriteFactory)
    );
    
    if (FAILED(hr)) {
        OutputDebugStringW(L"GhostText: Failed to create DWrite factory\n");
        return false;
    }
    
    // Create text format
    UpdateTextFormat();
    
    return true;
}

bool OverlayWindow::CreateDeviceResources() {
    if (!m_hwnd || !m_d2dFactory) return false;
    
    if (m_renderTarget) {
        // Already created
        return true;
    }
    
    RECT rc;
    GetClientRect(m_hwnd, &rc);
    
    D2D1_SIZE_U size = D2D1::SizeU(
        rc.right - rc.left,
        rc.bottom - rc.top
    );
    
    // Create render target with alpha mode
    D2D1_RENDER_TARGET_PROPERTIES rtProps = D2D1::RenderTargetProperties(
        D2D1_RENDER_TARGET_TYPE_DEFAULT,
        D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED)
    );
    
    D2D1_HWND_RENDER_TARGET_PROPERTIES hwndProps = D2D1::HwndRenderTargetProperties(
        m_hwnd,
        size,
        D2D1_PRESENT_OPTIONS_IMMEDIATELY
    );
    
    HRESULT hr = m_d2dFactory->CreateHwndRenderTarget(
        rtProps,
        hwndProps,
        &m_renderTarget
    );
    
    if (FAILED(hr)) {
        OutputDebugStringW(L"GhostText: Failed to create render target\n");
        return false;
    }
    
    // Create brushes
    hr = m_renderTarget->CreateSolidColorBrush(m_textColor, &m_textBrush);
    if (FAILED(hr)) return false;
    
    hr = m_renderTarget->CreateSolidColorBrush(m_backgroundColor, &m_backgroundBrush);
    if (FAILED(hr)) return false;
    
    return true;
}

void OverlayWindow::ReleaseDeviceResources() {
    SafeRelease(&m_textBrush);
    SafeRelease(&m_backgroundBrush);
    SafeRelease(&m_renderTarget);
}

void OverlayWindow::UpdateTextFormat() {
    SafeRelease(&m_textFormat);
    
    if (!m_dwriteFactory) return;
    
    m_dwriteFactory->CreateTextFormat(
        m_fontName.c_str(),
        nullptr,
        DWRITE_FONT_WEIGHT_NORMAL,
        DWRITE_FONT_STYLE_NORMAL,
        DWRITE_FONT_STRETCH_NORMAL,
        m_fontSize,
        L"en-us",
        &m_textFormat
    );
    
    if (m_textFormat) {
        m_textFormat->SetTextAlignment(DWRITE_TEXT_ALIGNMENT_LEADING);
        m_textFormat->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
    }
}

void OverlayWindow::UpdateText(const std::wstring& text, int x, int y, float fontSize) {
    if (!m_running || !m_hwnd) return;
    
    {
        std::lock_guard<std::mutex> lock(m_textMutex);
        m_text = text;
        m_posX = x;
        m_posY = y;
        
        if (fontSize != m_fontSize) {
            m_fontSize = fontSize;
            // Will update text format in render
        }
    }
    
    // Post message to window thread
    PostThreadMessageW(m_windowThreadId, WM_UPDATE_TEXT, 0, 0);
}

void OverlayWindow::Show() {
    if (!m_running) return;
    PostThreadMessageW(m_windowThreadId, WM_SHOW_OVERLAY, 0, 0);
}

void OverlayWindow::Hide() {
    if (!m_running) return;
    PostThreadMessageW(m_windowThreadId, WM_HIDE_OVERLAY, 0, 0);
}

void OverlayWindow::SetTextColor(float r, float g, float b, float a) {
    m_textColor = D2D1::ColorF(r, g, b, a);
    if (m_textBrush) {
        m_textBrush->SetColor(m_textColor);
    }
}

void OverlayWindow::SetBackgroundColor(float r, float g, float b, float a) {
    m_backgroundColor = D2D1::ColorF(r, g, b, a);
    if (m_backgroundBrush) {
        m_backgroundBrush->SetColor(m_backgroundColor);
    }
}

void OverlayWindow::SetFontName(const std::wstring& fontName) {
    m_fontName = fontName;
    UpdateTextFormat();
}

void OverlayWindow::MeasureText(const std::wstring& text, float& width, float& height) {
    width = 0;
    height = 0;
    
    if (!m_dwriteFactory || !m_textFormat || text.empty()) return;
    
    IDWriteTextLayout* layout = nullptr;
    HRESULT hr = m_dwriteFactory->CreateTextLayout(
        text.c_str(),
        static_cast<UINT32>(text.length()),
        m_textFormat,
        10000.0f,  // Max width
        10000.0f,  // Max height
        &layout
    );
    
    if (SUCCEEDED(hr) && layout) {
        DWRITE_TEXT_METRICS metrics;
        layout->GetMetrics(&metrics);
        
        width = metrics.widthIncludingTrailingWhitespace;
        height = metrics.height;
        
        layout->Release();
    }
}

void OverlayWindow::Render() {
    if (!m_renderTarget || !m_textFormat) return;
    
    std::wstring text;
    int posX, posY;
    float fontSize;
    
    {
        std::lock_guard<std::mutex> lock(m_textMutex);
        text = m_text;
        posX = m_posX;
        posY = m_posY;
        fontSize = m_fontSize;
    }
    
    if (text.empty()) {
        Hide();
        return;
    }
    
    // Update font size if changed
    FLOAT currentSize = m_textFormat->GetFontSize();
    if (currentSize != fontSize) {
        m_fontSize = fontSize;
        UpdateTextFormat();
    }
    
    // Measure text
    float textWidth, textHeight;
    MeasureText(text, textWidth, textHeight);
    
    // Add padding
    const float padding = 4.0f;
    int windowWidth = static_cast<int>(textWidth + padding * 2);
    int windowHeight = static_cast<int>(textHeight + padding * 2);
    
    // Ensure minimum size
    windowWidth = (std::max)(windowWidth, 20);
    windowHeight = (std::max)(windowHeight, 16);
    
    wchar_t debugMsg[256];
    swprintf_s(debugMsg, L"GhostText: Overlay positioning at (%d, %d), size (%d x %d)\n", 
        posX, posY, windowWidth, windowHeight);
    GHOST_DEBUG(debugMsg);
    
    // Position window at caret
    SetWindowPos(
        m_hwnd,
        HWND_TOPMOST,
        posX, posY,
        windowWidth, windowHeight,
        SWP_NOACTIVATE | SWP_SHOWWINDOW
    );
    
    // Resize render target if needed
    D2D1_SIZE_U currentSize2 = m_renderTarget->GetPixelSize();
    if (currentSize2.width != static_cast<UINT32>(windowWidth) ||
        currentSize2.height != static_cast<UINT32>(windowHeight)) {
        m_renderTarget->Resize(D2D1::SizeU(windowWidth, windowHeight));
    }
    
    // Render
    m_renderTarget->BeginDraw();
    
    // Clear with transparent background
    m_renderTarget->Clear(D2D1::ColorF(0, 0, 0, 0));
    
    // Draw background if not fully transparent
    if (m_backgroundColor.a > 0.0f) {
        D2D1_RECT_F rect = D2D1::RectF(0, 0, 
            static_cast<float>(windowWidth), 
            static_cast<float>(windowHeight));
        m_renderTarget->FillRectangle(rect, m_backgroundBrush);
    }
    
    // Draw text
    D2D1_RECT_F textRect = D2D1::RectF(
        padding,
        padding,
        static_cast<float>(windowWidth) - padding,
        static_cast<float>(windowHeight) - padding
    );
    
    m_renderTarget->DrawText(
        text.c_str(),
        static_cast<UINT32>(text.length()),
        m_textFormat,
        textRect,
        m_textBrush
    );
    
    HRESULT hr = m_renderTarget->EndDraw();
    
    // Handle device loss
    if (hr == D2DERR_RECREATE_TARGET) {
        ReleaseDeviceResources();
        CreateDeviceResources();
    }
}

void OverlayWindow::OnPaint() {
    PAINTSTRUCT ps;
    BeginPaint(m_hwnd, &ps);
    Render();
    EndPaint(m_hwnd, &ps);
}

LRESULT CALLBACK OverlayWindow::WindowProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    OverlayWindow* self = nullptr;
    
    if (msg == WM_CREATE) {
        CREATESTRUCT* cs = reinterpret_cast<CREATESTRUCT*>(lParam);
        self = static_cast<OverlayWindow*>(cs->lpCreateParams);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
    } else {
        self = reinterpret_cast<OverlayWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    }
    
    if (!self) {
        return DefWindowProcW(hwnd, msg, wParam, lParam);
    }
    
    switch (msg) {
        case WM_PAINT:
            self->OnPaint();
            return 0;
            
        case WM_UPDATE_TEXT:
            self->Render();
            return 0;
            
        case WM_SHOW_OVERLAY:
            if (!self->m_text.empty()) {
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                self->m_visible = true;
                self->Render();
            }
            return 0;
            
        case WM_HIDE_OVERLAY:
            ShowWindow(hwnd, SW_HIDE);
            self->m_visible = false;
            return 0;
            
        case WM_ERASEBKGND:
            // Don't erase background, we handle it in Render()
            return 1;
            
        case WM_NCHITTEST:
            // Make the entire window transparent to mouse input
            return HTTRANSPARENT;
            
        case WM_DESTROY:
            return 0;
            
        default:
            return DefWindowProcW(hwnd, msg, wParam, lParam);
    }
}

} // namespace GhostText
