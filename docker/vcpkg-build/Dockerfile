# Windows Server Core with Visual Studio Build Tools
# Use this container for building with vcpkg and MSVC
FROM mcr.microsoft.com/dotnet/framework/sdk:4.8-windowsservercore-ltsc2022

USER ContainerAdministrator

# Install Chocolatey
RUN powershell -NoProfile -ExecutionPolicy Bypass -Command \
    "[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; \
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))"

# Install build tools
RUN choco install -y git cmake ninja visualstudio2022-workload-vctools

# ツールのシステムインストールだけを管理者で行い、ビルド用ディレクトリに書き込みを許可する。
# icacls はコンテナアカウントの名前を解決できないため、ContainerUser 固有の SID を使う。
RUN mkdir C:\build-work && mkdir C:\output && \
    icacls C:\build-work /grant "*S-1-5-93-2-2:(OI)(CI)M" && \
    icacls C:\output /grant "*S-1-5-93-2-2:(OI)(CI)M"

USER ContainerUser

# Install vcpkg
RUN git clone https://github.com/microsoft/vcpkg.git C:\build-work\vcpkg && \
    C:\build-work\vcpkg\bootstrap-vcpkg.bat

# Set environment variables
ENV VCPKG_ROOT="C:\build-work\vcpkg"
ENV PATH="C:\build-work\vcpkg;C:\Program Files\CMake\bin;C:\Program Files\Git\cmd;${PATH}"

# Set vcpkg triplet for static MSVC builds
ENV VCPKG_DEFAULT_TRIPLET=x64-windows-static

WORKDIR C:\\build-work\\src

# Copy vcpkg.json for dependency caching
COPY vcpkg.json .
RUN vcpkg install --triplet x64-windows-static

# Copy source code
COPY . .

# Build script
CMD ["powershell", "-File", "docker\\vcpkg-build\\build.ps1"]
