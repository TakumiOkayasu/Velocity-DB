# Windows Server Core with Visual Studio Build Tools
# Use this container for building with vcpkg and MSVC
FROM mcr.microsoft.com/dotnet/framework/sdk:4.8-windowsservercore-ltsc2022

# Install Chocolatey
RUN powershell -NoProfile -ExecutionPolicy Bypass -Command \
    "[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; \
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))"

# Install build tools
RUN choco install -y git cmake ninja visualstudio2022buildtools --package-parameters \
    "--add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --includeRecommended"

# Install vcpkg
RUN git clone https://github.com/microsoft/vcpkg.git C:\vcpkg && \
    C:\vcpkg\bootstrap-vcpkg.bat

# Set environment variables
ENV VCPKG_ROOT=C:\vcpkg
ENV PATH="C:\vcpkg;C:\Program Files\CMake\bin;C:\Program Files\Git\cmd;${PATH}"

# Set vcpkg triplet for static MSVC builds
ENV VCPKG_DEFAULT_TRIPLET=x64-windows-static

WORKDIR C:\src

# Copy vcpkg.json for dependency caching
COPY vcpkg.json .
RUN vcpkg install --triplet x64-windows-static

# Copy source code
COPY . .

# Build script
CMD ["powershell", "-File", "docker\\vcpkg-build\\build.ps1"]
