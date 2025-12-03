@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat" -arch=amd64
cd /d C:\prog\Pre-DateGrip\build
cmake --build . --config Release
