"""Environment required by backend build/test commands."""

from typing import Protocol, TextIO


class BuildEnvironment(Protocol):
    def activate(self, out: TextIO | None = None) -> dict[str, str]:
        """Return a fresh child-process environment with the C++ toolchain activated.

        Raise on discovery/activation failure; never mutate the parent environment.
        The caller owns the returned mapping and may add command-specific values.
        """
        ...
