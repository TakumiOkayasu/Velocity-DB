"""Exercise checkout-local backend build identities without the Windows application."""

import os
import re
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
UPDATE_SCRIPT = ROOT / "cmake" / "UpdateBuildIdentity.cmake"


def _run(
    command: list[str], *, cwd: Path | None = None, check: bool = True
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=90)
    if check:
        assert result.returncode == 0, result.stdout + result.stderr
    return result


@pytest.fixture(scope="module")
def cmake() -> str:
    binary = shutil.which("cmake")
    if not binary:
        pytest.skip("requires CMake on PATH")
    return binary


@pytest.fixture(scope="module")
def git() -> str:
    binary = shutil.which("git")
    if not binary:
        pytest.skip("requires Git on PATH")
    return binary


def _commit_fixture(source: Path, git: str) -> str:
    _run([git, "init", "--quiet", str(source)])
    _run([git, "-C", str(source), "add", "."])
    _run(
        [
            git,
            "-C",
            str(source),
            "-c",
            "user.name=Build Identity Tests",
            "-c",
            "user.email=build-identity@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--quiet",
            "-m",
            "Create test fixture",
        ]
    )
    return _run([git, "-C", str(source), "rev-parse", "--short=12", "HEAD"]).stdout.strip()


@pytest.fixture
def source(tmp_path: Path) -> Path:
    path = tmp_path / "source with spaces & symbols"
    path.mkdir()
    (path / ".gitignore").write_text(".build-metadata/\nignored.txt\n", encoding="utf-8")
    (path / "tracked.txt").write_text("original\n", encoding="utf-8")
    return path


def _counter(source: Path) -> Path:
    return source / ".build-metadata" / "backend-counter"


def _reserve(
    cmake: str,
    source: Path,
    output: Path,
    *,
    check: bool = True,
    extra_args: tuple[str, ...] = (),
) -> subprocess.CompletedProcess[str]:
    return _run(
        [
            cmake,
            f"-DSOURCE_DIR={source}",
            f"-DOUTPUT_FILE={output}",
            *extra_args,
            "-P",
            str(UPDATE_SCRIPT),
        ],
        check=check,
    )


def _identity(output: Path) -> tuple[int, str]:
    match = re.search(r'return "build (\d+) / ([a-z0-9-]+)";', output.read_text(encoding="utf-8"))
    assert match is not None, output.read_text(encoding="utf-8")
    return int(match[1]), match[2]


@pytest.mark.parametrize("staged", [False, True])
def test_revision_tracks_changes_but_ignores_untracked_files(
    cmake: str, git: str, source: Path, tmp_path: Path, staged: bool
) -> None:
    revision = _commit_fixture(source, git)
    output = tmp_path / "generated with spaces" / "build_identity.cpp"
    _reserve(cmake, source, output)
    assert _identity(output) == (1, revision)

    (source / "untracked.txt").write_text("untracked\n", encoding="utf-8")
    (source / "ignored.txt").write_text("ignored\n", encoding="utf-8")
    _reserve(cmake, source, output)
    assert _identity(output) == (2, revision)

    (source / "tracked.txt").write_text("changed\n", encoding="utf-8")
    if staged:
        _run([git, "-C", str(source), "add", "tracked.txt"])
    _reserve(cmake, source, output)
    assert _identity(output) == (3, f"{revision}-dirty")
    assert _counter(source).read_text(encoding="utf-8") == "3\n"


def test_source_archive_reports_unknown_revision(cmake: str, source: Path, tmp_path: Path) -> None:
    output = tmp_path / "build_identity.cpp"
    _reserve(cmake, source, output)
    assert _identity(output) == (1, "unknown")


def test_missing_git_reports_unknown_revision(
    cmake: str, git: str, source: Path, tmp_path: Path
) -> None:
    _commit_fixture(source, git)
    output = tmp_path / "build_identity.cpp"
    _reserve(
        cmake,
        source,
        output,
        extra_args=(
            "-DCMAKE_FIND_USE_SYSTEM_ENVIRONMENT_PATH=OFF",
            "-DCMAKE_FIND_USE_CMAKE_SYSTEM_PATH=OFF",
        ),
    )
    assert _identity(output) == (1, "unknown")


@pytest.mark.parametrize("invalid", ["", "garbage\n", "-1\n", "2.5\n", "2147483647\n"])
def test_invalid_counter_fails_without_resetting_state_or_replacing_output(
    cmake: str, source: Path, tmp_path: Path, invalid: str
) -> None:
    counter = _counter(source)
    counter.parent.mkdir()
    counter.write_text(invalid, encoding="utf-8")
    output = tmp_path / "build_identity.cpp"
    output.write_text("previous successful output\n", encoding="utf-8")

    result = _reserve(cmake, source, output, check=False)

    assert result.returncode != 0
    assert "Invalid backend build counter" in result.stdout + result.stderr
    assert counter.read_text(encoding="utf-8") == invalid
    assert output.read_text(encoding="utf-8") == "previous successful output\n"


def test_concurrent_reservations_are_unique_across_output_directories(
    cmake: str, source: Path, tmp_path: Path
) -> None:
    outputs = [tmp_path / f"build-{number}" / "build_identity.cpp" for number in range(12)]

    def reserve(output: Path) -> int:
        _reserve(cmake, source, output)
        return _identity(output)[0]

    with ThreadPoolExecutor(max_workers=8) as executor:
        numbers = list(executor.map(reserve, outputs))

    assert sorted(numbers) == list(range(1, len(outputs) + 1))
    assert int(_counter(source).read_text(encoding="utf-8")) == len(outputs)


@pytest.fixture(scope="module")
def build_tools() -> tuple[str, str]:
    compiler = next(
        (path for name in ("c++", "g++", "clang++", "cl") if (path := shutil.which(name))), None
    )
    if not compiler:
        pytest.skip("requires a C++ compiler on PATH")
    if shutil.which("ninja"):
        return "Ninja", compiler
    if os.name != "nt" and shutil.which("make"):
        return "Unix Makefiles", compiler
    pytest.skip("requires Ninja or Unix Makefiles")


def _write_project(source: Path) -> None:
    (source / "backend" / "utils").mkdir(parents=True)
    shutil.copy2(ROOT / "backend" / "utils" / "build_identity.h", source / "backend" / "utils")
    (source / "CMakeLists.txt").write_text(
        "cmake_minimum_required(VERSION 3.20)\n"
        "project(BuildIdentityFixture LANGUAGES CXX)\n"
        "add_executable(identity main.cpp unrelated.cpp)\n"
        "target_compile_features(identity PRIVATE cxx_std_17)\n"
        'target_include_directories(identity PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/backend")\n'
        "target_precompile_headers(identity PRIVATE <iostream> <string_view>)\n"
        f'include("{(ROOT / "cmake" / "BuildIdentity.cmake").as_posix()}")\n'
        "velocitydb_add_build_identity(identity)\n",
        encoding="utf-8",
    )
    (source / "main.cpp").write_text(
        '#include "utils/build_identity.h"\n#include <iostream>\n'
        "int unrelated();\n"
        "int main() { std::cout << velocitydb::backendBuildIdentity(); return unrelated(); }\n",
        encoding="utf-8",
    )
    (source / "unrelated.cpp").write_text("int unrelated() { return 0; }\n", encoding="utf-8")


def test_build_pipeline_increments_without_rebuilding_unrelated_objects_or_pch(
    cmake: str, git: str, source: Path, tmp_path: Path, build_tools: tuple[str, str]
) -> None:
    generator, compiler = build_tools
    _write_project(source)
    revision = _commit_fixture(source, git)
    build = tmp_path / "build with spaces"
    configure = [
        cmake,
        "-S",
        str(source),
        "-B",
        str(build),
        "-G",
        generator,
        f"-DCMAKE_CXX_COMPILER={compiler}",
        "-DCMAKE_BUILD_TYPE=Debug",
    ]
    build_command = [cmake, "--build", str(build), "--parallel", "2"]
    executable = build / ("identity.exe" if os.name == "nt" else "identity")
    generated = build / "generated" / "Debug" / "build_identity.cpp"

    _run(configure)
    assert not _counter(source).exists(), "configure is not a build attempt"
    _run(build_command)
    assert _run([str(executable)]).stdout == f"build 1 / {revision}"
    assert _identity(generated) == (1, revision)
    objects = [path for path in build.rglob("*") if path.suffix in {".o", ".obj"}]
    pch = [path for path in build.rglob("*") if path.suffix in {".gch", ".pch"}]
    identity_objects = [path for path in objects if path.name.startswith("build_identity.cpp.")]
    assert len(identity_objects) == 1
    assert any(path.name.startswith("unrelated.cpp.") for path in objects)
    assert pch, "the fixture must exercise precompiled headers"
    unchanged = {
        path: path.stat().st_mtime_ns for path in objects + pch if path not in identity_objects
    }
    old_identity_object = identity_objects[0].read_bytes()

    _run(build_command)
    assert _run([str(executable)]).stdout == f"build 2 / {revision}"
    assert _identity(generated) == (2, revision)
    assert identity_objects[0].read_bytes() != old_identity_object
    assert {path: path.stat().st_mtime_ns for path in unchanged} == unchanged

    unrelated = source / "unrelated.cpp"
    good_source = unrelated.read_text(encoding="utf-8")
    unrelated.write_text("#error intentional build failure\n", encoding="utf-8")
    failure = _run(build_command, check=False)
    assert failure.returncode != 0
    assert _identity(generated) == (3, f"{revision}-dirty")
    assert _counter(source).read_text(encoding="utf-8") == "3\n"
    assert _run([str(executable)]).stdout == f"build 2 / {revision}"
    unrelated.write_text(good_source, encoding="utf-8")
    _run(build_command)
    assert _run([str(executable)]).stdout == f"build 4 / {revision}"

    _run([cmake, "--build", str(build), "--target", "clean"])
    assert _counter(source).read_text(encoding="utf-8") == "4\n"
    _run(build_command)
    assert _run([str(executable)]).stdout == f"build 5 / {revision}"

    shutil.rmtree(build)
    _run(configure)
    assert _counter(source).read_text(encoding="utf-8") == "5\n"
    _run(build_command)
    assert _run([str(executable)]).stdout == f"build 6 / {revision}"
    assert _run([git, "-C", str(source), "status", "--porcelain"]).stdout == ""


def test_configurations_keep_separate_generated_sources_and_share_counter(
    cmake: str, source: Path, tmp_path: Path, build_tools: tuple[str, str]
) -> None:
    generator, compiler = build_tools
    multiconfig = generator == "Ninja"
    if multiconfig:
        generator = "Ninja Multi-Config"
    _write_project(source)
    build = tmp_path / "build"
    configure = [
        cmake,
        "-S",
        str(source),
        "-B",
        str(build),
        "-G",
        generator,
        f"-DCMAKE_CXX_COMPILER={compiler}",
    ]
    debug_source = build / "generated" / "Debug" / "build_identity.cpp"
    release_source = build / "generated" / "Release" / "build_identity.cpp"

    for number, configuration in enumerate(("Debug", "Release", "Debug"), start=1):
        if number == 1 or not multiconfig:
            _run(configure + ([] if multiconfig else [f"-DCMAKE_BUILD_TYPE={configuration}"]))
        _run([cmake, "--build", str(build), "--config", configuration, "--parallel", "2"])
        executable = build / configuration if multiconfig else build
        executable /= "identity.exe" if os.name == "nt" else "identity"
        assert _run([str(executable)]).stdout == f"build {number} / unknown"
        assert _identity(debug_source) == (number if configuration == "Debug" else 1, "unknown")
        if number >= 2:
            assert _identity(release_source) == (2, "unknown")

    assert _counter(source).read_text(encoding="utf-8") == "3\n"
