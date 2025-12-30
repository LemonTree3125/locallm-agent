cmake_minimum_required(VERSION 3.15)

# Project name and version
project(ghost_text_addon VERSION 1.0.0 LANGUAGES CXX)

# Set C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# cmake-js integration
include_directories(${CMAKE_JS_INC})

# Find node-addon-api headers
execute_process(
    COMMAND node -p "require('node-addon-api').include"
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})

# Include directories
include_directories(
    ${NODE_ADDON_API_DIR}
    ${CMAKE_SOURCE_DIR}/src
)

# Source files
set(SOURCES
    src/main.cpp
    src/SystemMonitor.cpp
    src/KeyboardHook.cpp
    src/OverlayWindow.cpp
)

# Header files
set(HEADERS
    src/SystemMonitor.h
    src/KeyboardHook.h
    src/OverlayWindow.h
    src/common.h
)

# Create the native addon
add_library(${PROJECT_NAME} SHARED ${SOURCES} ${HEADERS} ${CMAKE_JS_SRC})

# Set output name to match Node.js conventions
set_target_properties(${PROJECT_NAME} PROPERTIES 
    PREFIX ""
    SUFFIX ".node"
    OUTPUT_NAME "ghost_text"
)

# Link Windows libraries
target_link_libraries(${PROJECT_NAME} PRIVATE
    ${CMAKE_JS_LIB}
    # Windows Core
    user32.lib
    kernel32.lib
    ole32.lib
    oleaut32.lib
    # UI Automation
    uiautomationcore.lib
    # Direct2D and DirectWrite
    d2d1.lib
    dwrite.lib
    # COM support
    comsuppw.lib
)

# Define NAPI_VERSION for node-addon-api
add_definitions(-DNAPI_VERSION=8)
add_definitions(-DNAPI_DISABLE_CPP_EXCEPTIONS)
add_definitions(-DUNICODE -D_UNICODE)

# Windows-specific settings
if(WIN32)
    # Enable COM smart pointers
    add_definitions(-D_ATL_NO_COM_SUPPORT)
    
    # Suppress specific warnings
    target_compile_options(${PROJECT_NAME} PRIVATE 
        /W4
        /wd4100  # unreferenced formal parameter
        /wd4127  # conditional expression is constant
    )
    
    # Enable security features
    target_compile_options(${PROJECT_NAME} PRIVATE /GS /sdl)
    target_link_options(${PROJECT_NAME} PRIVATE /DYNAMICBASE /NXCOMPAT)
endif()

# Installation
install(TARGETS ${PROJECT_NAME}
    LIBRARY DESTINATION lib
    RUNTIME DESTINATION bin
)

# Print configuration summary
message(STATUS "")
message(STATUS "Ghost Text Native Addon Configuration:")
message(STATUS "  - C++ Standard: ${CMAKE_CXX_STANDARD}")
message(STATUS "  - Node Addon API: ${NODE_ADDON_API_DIR}")
message(STATUS "  - Build Type: ${CMAKE_BUILD_TYPE}")
message(STATUS "")
