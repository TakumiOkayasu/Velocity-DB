# Keep changing build metadata in one translation unit, not a shared/PCH header.
function(velocitydb_add_build_identity target)
    set(build_identity_source "${CMAKE_CURRENT_BINARY_DIR}/generated/$<CONFIG>/build_identity.cpp")
    add_custom_target(VelocityDBBuildIdentity
        COMMAND "${CMAKE_COMMAND}"
            "-DSOURCE_DIR=${CMAKE_SOURCE_DIR}"
            "-DOUTPUT_FILE=${build_identity_source}"
            -P "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/UpdateBuildIdentity.cmake"
        BYPRODUCTS "${build_identity_source}"
        COMMENT "Recording backend build attempt..."
        VERBATIM
    )
    target_sources(${target} PRIVATE "${build_identity_source}")
    add_dependencies(${target} VelocityDBBuildIdentity)
endfunction()
