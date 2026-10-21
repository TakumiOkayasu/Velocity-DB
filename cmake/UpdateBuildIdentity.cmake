cmake_minimum_required(VERSION 3.20)

if(NOT DEFINED SOURCE_DIR OR NOT DEFINED OUTPUT_FILE)
    message(FATAL_ERROR "SOURCE_DIR and OUTPUT_FILE are required")
endif()

# Checkout-local state survives build/ deletion and is shared by configurations.
# Serialize reservations across separate build directories; never reuse a failed attempt.
set(state_dir "${SOURCE_DIR}/.build-metadata")
file(MAKE_DIRECTORY "${state_dir}")
file(LOCK "${state_dir}/backend.lock" GUARD PROCESS TIMEOUT 30)
set(counter_file "${state_dir}/backend-counter")
set(build_number 0)
if(EXISTS "${counter_file}")
    file(READ "${counter_file}" build_number)
    string(STRIP "${build_number}" build_number)
    if(NOT build_number MATCHES "^[0-9]+$" OR build_number GREATER_EQUAL 2147483647)
        message(FATAL_ERROR "Invalid backend build counter: ${counter_file}")
    endif()
endif()
math(EXPR build_number "${build_number} + 1")
file(WRITE "${counter_file}.tmp" "${build_number}\n")
file(RENAME "${counter_file}.tmp" "${counter_file}")

set(source_revision "unknown")
find_program(git_executable git)
if(git_executable)
    execute_process(
        COMMAND "${git_executable}" -C "${SOURCE_DIR}" rev-parse --short=12 HEAD
        OUTPUT_VARIABLE revision OUTPUT_STRIP_TRAILING_WHITESPACE
        RESULT_VARIABLE revision_result ERROR_QUIET
    )
    if(revision_result EQUAL 0 AND revision MATCHES "^[0-9a-f]+$")
        execute_process(
            COMMAND "${git_executable}" -C "${SOURCE_DIR}" status --porcelain --untracked-files=no
            OUTPUT_VARIABLE changes OUTPUT_STRIP_TRAILING_WHITESPACE
            RESULT_VARIABLE status_result ERROR_QUIET
        )
        if(status_result EQUAL 0)
            set(source_revision "${revision}")
            if(NOT changes STREQUAL "")
                string(APPEND source_revision "-dirty")
            endif()
        endif()
    endif()
endif()

get_filename_component(output_dir "${OUTPUT_FILE}" DIRECTORY)
file(MAKE_DIRECTORY "${output_dir}")
file(WRITE "${OUTPUT_FILE}" "// Generated at build time. Do not edit.\n#include \"utils/build_identity.h\"\n\nnamespace velocitydb {\nstd::string_view backendBuildIdentity() noexcept {\n    return \"build ${build_number} / ${source_revision}\";\n}\n}  // namespace velocitydb\n")
message(STATUS "Backend: build ${build_number} / ${source_revision}")
