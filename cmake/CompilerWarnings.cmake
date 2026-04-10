# MSVC compiler warnings and language settings
# Usage: include(cmake/CompilerWarnings.cmake)
#        target_set_msvc_options(<target>)

function(target_set_msvc_options target)
    if(NOT MSVC)
        return()
    endif()

    target_compile_options(${target} PRIVATE
        /MP       # Multi-processor compilation
        /utf-8    # UTF-8 source and execution charset
    )
endfunction()
