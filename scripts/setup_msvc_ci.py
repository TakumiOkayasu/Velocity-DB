"""Use the local VS resolver to configure subsequent GitHub Actions steps."""

import os
from pathlib import Path
from uuid import uuid4

from _lib.utils import get_msvc_env


def main() -> None:
    destination = Path(os.environ["GITHUB_ENV"])
    before = {key.upper(): value for key, value in os.environ.items()}
    environment = get_msvc_env()
    normalized = {key.upper(): value for key, value in environment.items()}
    environment["VELOCITYDB_TOOLCHAIN_KEY"] = (
        f"vs2026-{os.environ['IMAGEVERSION']}-{normalized['VCTOOLSVERSION']}"
    )
    with destination.open("a", encoding="utf-8") as stream:
        for key, value in environment.items():
            if before.get(key.upper()) != value:
                delimiter = uuid4().hex
                stream.write(f"{key}<<{delimiter}\n{value}\n{delimiter}\n")


if __name__ == "__main__":
    main()
