@echo off
chcp 65001 >nul
setlocal
REM Ep Python dung UTF-8 cho stdout/stdin — khong dua vao viec Python tu doan dung codepage console,
REM vi co truong hop (vd chay qua pipe khong phai console that) Python roi ve cp1252 gay loi
REM UnicodeEncodeError voi text tieng Viet.
set "PYTHONIOENCODING=utf-8"

echo ===============================================
echo   Mic Check - Chuyen doi file .docx
echo ===============================================
echo.

if "%~1"=="" (
    echo Cach dung: KEO file .docx tha vao bieu tuong nay ^(khong phai mo file nay truc tiep^).
    echo.
    pause
    exit /b 1
)

if /I not "%~x1"==".docx" (
    echo Loi: file vua tha khong phai .docx ^("%~1"^).
    echo.
    pause
    exit /b 1
)

set "DOCX=%~1"
set "FOLDER=%~dp1"
REM %~dp1 luon co dau \ o cuoi - bo di, vi "duong dan\" trong dau ngoac kep se bi Windows hieu
REM nham \" la ky tu thoat (escape) chu khong phai dong ngoac, gay loi gop nham tham so ke tiep.
if "%FOLDER:~-1%"=="\" set "FOLDER=%FOLDER:~0,-1%"

echo File docx : %DOCX%
echo Thu muc   : %FOLDER%
echo.

REM Uu tien ban .exe dong goi san (khong can cai Python) - chi fallback ve "python script.py" khi
REM dev chay tu source chua build .exe.
if exist "%~dp0docx_to_mic_check.exe" (
    "%~dp0docx_to_mic_check.exe" --docx "%DOCX%" --images "%FOLDER%" --out-dir "%FOLDER%"
) else (
    where py >nul 2>nul
    if errorlevel 1 (
        echo Loi: khong tim thay docx_to_mic_check.exe lan khong tim thay Python ^(lenh "py"^).
        echo Can cai Python truoc: https://www.python.org/downloads/
        echo.
        pause
        exit /b 1
    )
    py "%~dp0docx_to_mic_check.py" --docx "%DOCX%" --images "%FOLDER%" --out-dir "%FOLDER%"
)

echo.
if errorlevel 1 (
    echo ❌ Co loi xay ra ^(xem chi tiet o tren^). Kiem tra lai file docx / anh thieu.
) else (
    echo ✅ Xong! Mo panel "Mic Check" trong Premiere, bam "Chon" chon dung thu muc:
    echo    %FOLDER%
)
echo.
pause
