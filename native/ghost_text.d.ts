/**
 * Type definitions for the Ghost Text native addon
 */

export interface CaretInfo {
    /** Screen X coordinate */
    x: number;
    /** Screen Y coordinate */
    y: number;
    /** Caret width in pixels */
    width: number;
    /** Caret height in pixels */
    height: number;
    /** Whether the caret position is valid */
    valid: boolean;
}

export interface TextContext {
    /** Text content before the caret */
    text: string;
    /** Name of the process (e.g., "notepad.exe") */
    processName: string;
    /** Window title */
    windowTitle: string;
    /** Caret position information */
    caret: CaretInfo;
}

export interface GhostTextNative {
    /**
     * Initialize the native addon
     * @returns true if successful
     */
    initialize(): boolean;

    /**
     * Start monitoring keyboard input
     * @param callback Function called with (event: string, data: TextContext)
     * @returns true if successful
     */
    startMonitoring(callback: (event: string, data: TextContext) => void): boolean;

    /**
     * Stop monitoring keyboard input
     * @returns true if successful
     */
    stopMonitoring(): boolean;

    /**
     * Update the ghost text overlay
     * @param text The completion text to display
     * @param x Screen X coordinate
     * @param y Screen Y coordinate
     * @param fontSize Optional font size in points
     * @returns true if successful
     */
    updateOverlay(text: string, x: number, y: number, fontSize?: number): boolean;

    /**
     * Hide the ghost text overlay
     * @returns true if successful
     */
    hideOverlay(): boolean;

    /**
     * Get current text context
     * @param contextLength Maximum characters to retrieve
     * @returns TextContext or null
     */
    getTextContext(contextLength?: number): TextContext | null;

    /**
     * Shutdown and cleanup
     * @returns true if successful
     */
    shutdown(): boolean;
}

declare const ghostText: GhostTextNative;
export default ghostText;
