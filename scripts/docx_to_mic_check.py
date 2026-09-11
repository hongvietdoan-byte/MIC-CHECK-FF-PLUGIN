#!/usr/bin/env python3
"""
docx_to_mic_check.py — Đọc bảng "Time Stamp | Player | EN | Ảnh" trong file .docx (mẫu Mic Check)
và xuất RA CẢ 2 FILE: cues.json (dùng cho run_mic_check_workflow) và .srt (kéo vào caption track).

Xuất cả 2 từ CÙNG 1 nguồn dữ liệu (bảng docx) — đảm bảo SRT và JSON luôn khớp nhau tuyệt đối, không
cần chuẩn bị .srt riêng nữa. Dùng python-docx đọc trực tiếp qua Table API (không regex/XML thô như
bản Node docx_to_json.js trước đó) — bền hơn vì đọc đúng theo cấu trúc cell thật của Word, không phụ
thuộc giả định thứ tự dòng.

Chạy NGOÀI Premiere (Python thuần) — không phụ thuộc UXP, không cần Claude cho các lần chạy lại.

Usage (2 cách, cùng 1 script):
    1) Kéo-thả: kéo file .docx tha thang vao docx_to_mic_check.exe (hoac file .py neu chay qua
       python) — tu suy ra --images/--out-dir la thu muc chua file .docx do.
           docx_to_mic_check.exe "duong/dan/file.docx"
    2) Dong lenh, tuy chinh thu muc anh/xuat rieng:
           python docx_to_mic_check.py --docx <path.docx> --images <thư mục ảnh> --out-dir <thư mục xuất>

Số lượng ảnh KHÔNG hardcode — script tự đọc bất kỳ giá trị nào xuất hiện ở cột "Ảnh" trong docx.
"""

import argparse
import json
import re
import sys
from pathlib import Path

# Console Windows mặc định dùng codepage cp1252/cp850, không encode được tiếng Việt (ký tự "Đọc",
# "Ảnh"...) — ép UTF-8 ngay tại đây thay vì chỉ dựa vào biến môi trường PYTHONIOENCODING (bản .exe
# đóng gói qua PyInstaller có thể bị double-click trực tiếp, không qua Chuyen_Doi_Mic_Check.bat).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

from docx import Document

TIMESTAMP_RE = re.compile(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)")


def to_seconds(h, m, s, ms):
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def find_header_row(table):
    """Tìm dòng header theo NỘI DUNG cell (không hardcode chỉ số dòng), rồi trả về chỉ số dòng +
    mapping tên cột -> chỉ số cột. Bền hơn nếu cấu trúc bảng có thêm/bớt dòng trang trí phía trên."""
    wanted = {"time stamp": "timestamp", "player": "player", "en": "text", "ảnh": "image"}
    for row_idx, row in enumerate(table.rows):
        cells_lower = [c.text.strip().lower() for c in row.cells]
        col_map = {}
        for idx, cell_text in enumerate(cells_lower):
            for key, field in wanted.items():
                if cell_text == key:
                    col_map[field] = idx
        if len(col_map) == len(wanted):
            return row_idx, col_map
    raise ValueError(
        'Không tìm thấy dòng header có đủ 4 cột "Time Stamp"/"Player"/"EN"/"Ảnh" trong bảng docx.'
    )


def parse_cues(docx_path: Path):
    doc = Document(str(docx_path))
    if not doc.tables:
        raise ValueError(f'File "{docx_path}" không có bảng nào.')
    table = doc.tables[0]

    header_idx, col_map = find_header_row(table)

    cues = []
    for row in list(table.rows)[header_idx + 1:]:
        ts_text = row.cells[col_map["timestamp"]].text.strip()
        m = TIMESTAMP_RE.match(ts_text)
        if not m:
            continue  # dòng trang trí/rỗng (vd dòng phụ đề "Text") — bỏ qua, không phải lỗi

        start = to_seconds(m.group(1), m.group(2), m.group(3), m.group(4))
        end = to_seconds(m.group(5), m.group(6), m.group(7), m.group(8))
        if start >= end:
            raise ValueError(f'Cue "{ts_text}": start phải nhỏ hơn end.')

        text = row.cells[col_map["text"]].text.strip()
        image_raw = row.cells[col_map["image"]].text.strip()

        cues.append({
            "index": len(cues),
            "start": round(start, 3),
            "end": round(end, 3),
            "text": text,
            "image": image_raw or None,
        })

    if not cues:
        raise ValueError("Parse xong nhưng không ra cue nào — kiểm tra lại nội dung bảng.")
    return cues


def image_label_to_candidates(label: str):
    num = re.sub(r"(?i)^ảnh\s*", "", label).strip()
    base = f"ảnh {num}"
    return [base + ext for ext in (".png", ".jpg", ".jpeg")]


def validate_images(cues, images_dir: Path):
    if not images_dir.is_dir():
        raise ValueError(f'Thư mục ảnh không tồn tại: "{images_dir}"')

    files_on_disk = list(images_dir.iterdir())
    files_lower = {f.name.lower(): f.name for f in files_on_disk if f.is_file()}

    unique_labels = sorted({c["image"] for c in cues if c["image"]})
    missing = []
    resolved = {}

    for label in unique_labels:
        candidates = image_label_to_candidates(label)
        found = next((c for c in candidates if c.lower() in files_lower), None)
        if found:
            resolved[label] = files_lower[found.lower()]
        else:
            missing.append((label, candidates))

    if missing:
        lines = [
            f'  - docx nhắc tới "{label}" nhưng không thấy file nào trong {candidates}'
            for label, candidates in missing
        ]
        raise ValueError(f'Thiếu {len(missing)} ảnh trong "{images_dir}":\n' + "\n".join(lines))

    used = {name.lower() for name in resolved.values()}
    unused = [
        f.name for f in files_on_disk
        if f.is_file() and f.suffix.lower() in (".png", ".jpg", ".jpeg") and f.name.lower() not in used
    ]
    if unused:
        print(f"⚠️  Cảnh báo: {len(unused)} ảnh trong thư mục không được docx nhắc tới (không chặn): {unused}", file=sys.stderr)

    return resolved


def format_srt_timestamp(seconds: float) -> str:
    total_ms = round(seconds * 1000)
    h, rem = divmod(total_ms, 3600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(cues, srt_path: Path):
    lines = []
    for i, cue in enumerate(cues, start=1):
        if not cue["text"]:
            continue
        lines.append(str(i))
        lines.append(f'{format_srt_timestamp(cue["start"])} --> {format_srt_timestamp(cue["end"])}')
        lines.append(cue["text"])
        lines.append("")
    # newline="\n" ép LF thuần — mặc định Python trên Windows tự dịch "\n" thành "\r\n" khi ghi text
    # mode, làm SRT xuất ra khác byte-cho-byte so với file gốc dù nội dung giống hệt.
    srt_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")


BANNER = (
    "===============================================\n"
    "  Mic Check - Chuyen doi file .docx\n"
    "===============================================\n"
)


def _pause_if_interactive():
    # Khi build thành .exe và double-click/kéo-thả trực tiếp, console tự đóng ngay khi script kết
    # thúc — user không kịp đọc log. "python x.py" chạy từ terminal có sẵn thì không cần pause thêm.
    if getattr(sys, "frozen", False):
        try:
            input("\nNhan Enter de dong cua so nay...")
        except (EOFError, KeyboardInterrupt):
            pass


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "docx_dropped", nargs="?", type=Path,
        help="(chế độ kéo-thả) đường dẫn file .docx — tự suy ra --images/--out-dir là thư mục chứa nó",
    )
    ap.add_argument("--docx", type=Path)
    ap.add_argument("--images", type=Path)
    ap.add_argument("--out-dir", type=Path)
    args = ap.parse_args()

    print(BANNER)

    docx_path = args.docx or args.docx_dropped
    if docx_path is None:
        print("Cach dung: KEO file .docx tha vao bieu tuong nay (khong phai mo file nay truc tiep).")
        _pause_if_interactive()
        sys.exit(1)

    if docx_path.suffix.lower() != ".docx":
        print(f'Loi: file vua tha khong phai .docx ("{docx_path}").')
        _pause_if_interactive()
        sys.exit(1)

    if not docx_path.is_file():
        print(f'Loi: khong tim thay file "{docx_path}".')
        _pause_if_interactive()
        sys.exit(1)

    images_dir = args.images or docx_path.parent
    out_dir = args.out_dir or docx_path.parent

    print(f"File docx : {docx_path}")
    print(f"Thu muc   : {images_dir}\n")

    try:
        print(f"Đọc docx: {docx_path}")
        cues = parse_cues(docx_path)
        print(f"Parse được {len(cues)} cue.")

        print(f"Validate ảnh trong: {images_dir}")
        resolved_images = validate_images(cues, images_dir)
        for cue in cues:
            if cue["image"]:
                cue["image"] = resolved_images[cue["image"]]

        out_dir.mkdir(parents=True, exist_ok=True)
        stem = docx_path.stem

        json_path = out_dir / f"{stem}.cues.json"
        output = {
            "sourceDocx": docx_path.name,
            "cueCount": len(cues),
            "cues": cues,
        }
        json_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n")

        srt_path = out_dir / f"{stem}.srt"
        write_srt(cues, srt_path)

        print(f"✅ Đã ghi {json_path}")
        print(f"✅ Đã ghi {srt_path} ({len(resolved_images)} ảnh khác nhau)")
        print(f'\n✅ Xong! Mo panel "Mic Check" trong Premiere, bam "Chon" chon dung thu muc:\n   {out_dir}')
    except Exception as e:
        print(f"\n❌ Co loi xay ra: {e}")
        _pause_if_interactive()
        sys.exit(1)

    _pause_if_interactive()


if __name__ == "__main__":
    main()
