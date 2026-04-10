# Release build optimizations (MSVC)
# Usage: include(cmake/ReleaseOptimizations.cmake)
#        target_set_release_optimizations(<target>)

function(target_set_release_optimizations target)
    if(NOT MSVC)
        return()
    endif()

    # Function-level linking + global data optimization
    target_compile_options(${target} PRIVATE
        $<$<CONFIG:Release>:/Gy>
        $<$<CONFIG:Release>:/Gw>
    )

    # Remove unreferenced functions + fold identical COMDATs
    target_link_options(${target} PRIVATE
        $<$<CONFIG:Release>:/OPT:REF>
        $<$<CONFIG:Release>:/OPT:ICF>
    )
endfunction()
