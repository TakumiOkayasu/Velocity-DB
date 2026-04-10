# Unified output directory configuration
# Usage: include(cmake/OutputDirectories.cmake)
#        target_set_output_directories(<target>)

function(target_set_output_directories target)
    foreach(config DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
        string(TOLOWER ${config} config_lower)
        # Capitalize first letter for directory name
        string(SUBSTRING ${config} 0 1 first_char)
        string(SUBSTRING ${config_lower} 1 -1 rest)
        set(dir_name "${first_char}${rest}")

        # Handle special cases
        if(config STREQUAL "RELWITHDEBINFO")
            set(dir_name "RelWithDebInfo")
        elseif(config STREQUAL "MINSIZEREL")
            set(dir_name "MinSizeRel")
        endif()

        set_target_properties(${target} PROPERTIES
            RUNTIME_OUTPUT_DIRECTORY_${config} "${CMAKE_BINARY_DIR}/${dir_name}"
            ARCHIVE_OUTPUT_DIRECTORY_${config} "${CMAKE_BINARY_DIR}/${dir_name}"
        )
    endforeach()
endfunction()
