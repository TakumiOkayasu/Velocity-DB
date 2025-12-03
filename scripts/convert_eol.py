#!/usr/bin/env python3
# /// script
# requires-python = ">=3.14"
# ///
"""
Pre-DateGrip End-of-Line Converter

Converts line endings between CRLF (Windows) and LF (Unix) for source files.

Usage:
    uv run scripts/convert_eol.py <crlf|lf> [target]
    python scripts/convert_eol.py <crlf|lf> [target]

Examples:
    python scripts/convert_eol.py crlf              # Convert all to CRLF
    python scripts/convert_eol.py lf frontend/src   # Convert frontend to LF
    python scripts/convert_eol.py crlf src          # Convert C++ to CRLF
"""

import sys
import os
from pathlib import Path

# File extensions to process
DEFAULT_EXTENSIONS = {
    '.cpp', '.h', '.hpp', '.c',
    '.ts', '.tsx', '.js', '.jsx',
    '.json', '.css', '.html',
    '.md', '.yml', '.yaml',
    '.cmake', '.bat', '.ps1', '.py'
}

# Directories to skip
SKIP_DIRS = {'node_modules', '.git', 'build', 'dist', 'build-tidy', '__pycache__'}

# Specific files to include
SPECIFIC_FILES = {
    'CMakeLists.txt', '.gitignore', '.gitattributes',
    '.clang-format', '.clang-tidy'
}


def should_skip(path: Path) -> bool:
    """Check if path should be skipped."""
    for part in path.parts:
        if part in SKIP_DIRS:
            return True
    return False


def convert_file_eol(file_path: Path, target_eol: str) -> bool:
    """
    Convert a file's line endings.
    Returns True if file was modified, False otherwise.
    """
    if should_skip(file_path):
        return False

    try:
        # Read file as bytes
        content_bytes = file_path.read_bytes()

        # Skip BOM if present
        offset = 0
        if content_bytes.startswith(b'\xef\xbb\xbf'):
            offset = 3

        content = content_bytes[offset:].decode('utf-8', errors='replace')

        if not content:
            return False

        if target_eol == 'crlf':
            # Convert LF to CRLF (avoid double conversion)
            # First normalize to LF, then convert to CRLF
            new_content = content.replace('\r\n', '\n').replace('\r', '\n').replace('\n', '\r\n')
        else:
            # Convert to LF
            new_content = content.replace('\r\n', '\n').replace('\r', '\n')

        if content != new_content:
            file_path.write_bytes(new_content.encode('utf-8'))
            return True

        return False

    except Exception as e:
        print(f"WARNING: Failed to process {file_path}: {e}")
        return False


def get_source_files(path: Path, extension: str | None = None) -> list[Path]:
    """Get all source files in a directory."""
    files = []

    if not path.exists():
        return files

    if path.is_file():
        return [path]

    for item in path.rglob('*'):
        if item.is_file() and not should_skip(item):
            if extension:
                if item.suffix == extension:
                    files.append(item)
            elif item.suffix in DEFAULT_EXTENSIONS or item.name in SPECIFIC_FILES:
                files.append(item)

    return files


def main():
    if len(sys.argv) < 2:
        print("Usage: python convert_eol.py <crlf|lf> [target]")
        print("\nExamples:")
        print("  python convert_eol.py crlf              # Convert all to CRLF")
        print("  python convert_eol.py lf frontend/src   # Convert frontend to LF")
        sys.exit(1)

    eol_type = sys.argv[1].lower()
    if eol_type not in ('crlf', 'lf'):
        print(f"ERROR: Invalid EOL type '{eol_type}'. Use 'crlf' or 'lf'")
        sys.exit(1)

    target = sys.argv[2] if len(sys.argv) > 2 else None

    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    os.chdir(project_root)

    print(f"\n{'='*60}")
    print(f"End-of-Line Converter")
    print(f"Target EOL: {eol_type.upper()}")
    print(f"{'='*60}\n")

    converted_count = 0
    processed_count = 0

    if target:
        target_path = Path(target)
        if target_path.is_file():
            print(f"Converting file: {target}")
            processed_count = 1
            if convert_file_eol(target_path, eol_type):
                print(f"  {target}")
                converted_count = 1
        elif target_path.is_dir():
            print(f"Converting files in: {target}")
            files = get_source_files(target_path)
            for f in files:
                processed_count += 1
                if convert_file_eol(f, eol_type):
                    print(f"  {f}")
                    converted_count += 1
        else:
            print(f"ERROR: Target not found: {target}")
            sys.exit(1)
    else:
        print("Converting all source files in project...")

        # C++ sources
        src_dir = project_root / "src"
        if src_dir.exists():
            for f in get_source_files(src_dir):
                processed_count += 1
                if convert_file_eol(f, eol_type):
                    print(f"  {f}")
                    converted_count += 1

        # Frontend sources
        frontend_src = project_root / "frontend" / "src"
        if frontend_src.exists():
            for f in get_source_files(frontend_src):
                processed_count += 1
                if convert_file_eol(f, eol_type):
                    print(f"  {f}")
                    converted_count += 1

        # Scripts
        scripts_dir = project_root / "scripts"
        if scripts_dir.exists():
            for f in get_source_files(scripts_dir):
                processed_count += 1
                if convert_file_eol(f, eol_type):
                    print(f"  {f}")
                    converted_count += 1

        # Root files
        for filename in ['CMakeLists.txt', '.gitignore', '.gitattributes',
                         '.clang-format', '.clang-tidy', 'CLAUDE.md', 'README.md']:
            root_file = project_root / filename
            if root_file.exists():
                processed_count += 1
                if convert_file_eol(root_file, eol_type):
                    print(f"  {filename}")
                    converted_count += 1

    print(f"\n{'='*60}")
    print(f"Processed: {processed_count} file(s)")
    print(f"Converted: {converted_count} file(s) to {eol_type.upper()}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
