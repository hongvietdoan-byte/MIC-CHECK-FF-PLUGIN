#!/usr/bin/env python3
"""
docx_to_mic_check.py — Đọc bảng "Time Stamp | Player | EN" trong file .docx hoặc .csv (mẫu Mic
Check) và xuất RA CẢ 2 FILE: cues.json (dùng cho run_mic_check_workflow) và .srt (kéo vào caption
track).

Ảnh nhân vật được xác định TRỰC TIẾP theo cột "Player" (vd "FL.ABCD" → tìm file "FL.ABCD.png" cùng
thư mục) — không cần cột "Ảnh" riêng nữa, tận dụng luôn dữ liệu Player sẵn có trong bảng gốc.

Xuất cả 2 từ CÙNG 1 nguồn dữ liệu (bảng) — đảm bảo SRT và JSON luôn khớp nhau tuyệt đối, không cần
chuẩn bị .srt riêng nữa. Dùng python-docx đọc trực tiếp qua Table API cho .docx (không regex/XML
thô), và module csv chuẩn cho .csv — bền hơn vì đọc đúng theo cấu trúc cell/dòng thật, không phụ
thuộc giả định thứ tự dòng.

Chạy NGOÀI Premiere (Python thuần) — không phụ thuộc UXP, không cần Claude cho các lần chạy lại.

Usage (2 cách, cùng 1 script):
    1) Kéo-thả: kéo file .docx hoặc .csv tha thang vao Chuyen_Doi_File_Mic_Check.exe (hoac file .py
       neu chay qua python) — tu suy ra --images/--out-dir la thu muc chua file do do.
           Chuyen_Doi_File_Mic_Check.exe "duong/dan/file.docx"
    2) Dong lenh, tuy chinh thu muc anh/xuat rieng:
           python docx_to_mic_check.py --input <path.docx|path.csv> --images <thư mục ảnh> --out-dir <thư mục xuất>

Số lượng cue KHÔNG hardcode — script tự đọc bất kỳ số dòng nào có trong bảng/file.
"""

import argparse
import csv
import json
import re
import sys
from pathlib import Path

# Console Windows mặc định dùng codepage cp1252/cp850, không encode được tiếng Việt (ký tự "Đọc",
# "Ảnh"...) — ép UTF-8 ngay tại đây vì bản .exe đóng gói qua PyInstaller được double-click/kéo-thả
# trực tiếp, không có gì đặt sẵn PYTHONIOENCODING trước khi chạy.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

from docx import Document

TIMESTAMP_RE = re.compile(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)")

SUPPORTED_EXTENSIONS = (".docx", ".csv")

# Ký tự Windows cấm dùng trong tên file — chỉ để phòng hờ Player có ký tự lạ, không đổi tên bình
# thường (vd "FL.ABCD" giữ nguyên, dấu chấm hợp lệ trong filename).
_INVALID_FILENAME_CHARS_RE = re.compile(r'[<>:"/\\|?*]')


def to_seconds(h, m, s, ms):
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def load_rows(path: Path):
    """Đọc file .docx/.csv thành list các dòng, mỗi dòng là list ô text đã strip() — chuẩn hoá về
    1 định dạng chung để phần parse phía sau dùng chung logic, không quan tâm nguồn gốc file."""
    suffix = path.suffix.lower()
    if suffix == ".docx":
        doc = Document(str(path))
        if not doc.tables:
            raise ValueError(f'File "{path}" không có bảng nào.')
        table = doc.tables[0]
        return [[cell.text.strip() for cell in row.cells] for row in table.rows]

    if suffix == ".csv":
        # utf-8-sig tự bỏ BOM nếu Excel/Google Sheets export kèm — không có BOM thì đọc utf-8 bình
        # thường, không ảnh hưởng gì.
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            return [[cell.strip() for cell in row] for row in reader if row]

    raise ValueError(
        f'Định dạng file "{path.suffix}" chưa được hỗ trợ. Chỉ đọc được: '
        + ", ".join(SUPPORTED_EXTENSIONS)
    )


def find_header_row(rows):
    """Tìm dòng header theo NỘI DUNG cell (không hardcode chỉ số dòng), rồi trả về chỉ số dòng +
    mapping tên cột -> chỉ số cột. Bền hơn nếu cấu trúc bảng có thêm/bớt dòng trang trí phía trên.
    Chỉ cần 3 cột "Time Stamp"/"Player"/"EN" — không còn yêu cầu cột "Ảnh" (ảnh giờ lấy trực tiếp
    theo giá trị cột Player)."""
    wanted = {"time stamp": "timestamp", "player": "player", "en": "text"}
    for row_idx, row in enumerate(rows):
        cells_lower = [c.lower() for c in row]
        col_map = {}
        for idx, cell_text in enumerate(cells_lower):
            for key, field in wanted.items():
                if cell_text == key:
                    col_map[field] = idx
        if len(col_map) == len(wanted):
            return row_idx, col_map
    raise ValueError(
        'Không tìm thấy dòng header có đủ 3 cột "Time Stamp"/"Player"/"EN" trong bảng.'
    )


def parse_cues(path: Path):
    rows = load_rows(path)
    header_idx, col_map = find_header_row(rows)

    cues = []
    rejected_timestamps = []  # để báo lỗi rõ nếu cuối cùng không ra cue nào nhưng có dòng có vẻ là dữ liệu
    max_col = max(col_map.values())
    for row in rows[header_idx + 1:]:
        if len(row) <= max_col:
            continue  # dòng thiếu cột (vd dòng trống cuối file CSV) — bỏ qua, không phải lỗi

        ts_text = row[col_map["timestamp"]]
        m = TIMESTAMP_RE.match(ts_text)
        if not m:
            if ts_text:
                # dòng có nội dung nhưng không khớp định dạng — có thể là dòng trang trí (vd tiêu đề
                # "Text"), nhưng cũng có thể là timestamp gõ sai định dạng, nên lưu lại vài ví dụ đầu
                # tiên để báo lỗi rõ hơn nếu cuối cùng parse ra 0 cue.
                if len(rejected_timestamps) < 5:
                    rejected_timestamps.append(ts_text)
            continue  # dòng trang trí/rỗng — bỏ qua, không phải lỗi (trừ khi không ra cue nào ở cuối)

        start = to_seconds(m.group(1), m.group(2), m.group(3), m.group(4))
        end = to_seconds(m.group(5), m.group(6), m.group(7), m.group(8))
        if start >= end:
            raise ValueError(f'Cue "{ts_text}": start phải nhỏ hơn end.')

        text = row[col_map["text"]]
        player = row[col_map["player"]]

        cues.append({
            "index": len(cues),
            "start": round(start, 3),
            "end": round(end, 3),
            "text": text,
            "player": player or None,
            "image": player or None,  # ảnh = tên Player, xem validate_images()/image_label_to_candidates()
        })

    if not cues:
        if rejected_timestamps:
            examples = "\n".join(f'  - "{t}"' for t in rejected_timestamps)
            raise ValueError(
                "Parse xong nhưng không ra cue nào. Cột \"Time Stamp\" có nội dung nhưng KHÔNG đúng "
                'định dạng bắt buộc "GIO:PHUT:GIAY,MILIGIAY --> GIO:PHUT:GIAY,MILIGIAY" '
                '(vd: 00:00:01,200 --> 00:00:02,500).\n'
                f"Vài giá trị tìm thấy trong cột Time Stamp (không khớp định dạng):\n{examples}"
            )
        raise ValueError(
            "Parse xong nhưng không ra cue nào — cột \"Time Stamp\" trống ở mọi dòng dữ liệu, "
            "kiểm tra lại nội dung bảng."
        )
    return cues


def image_label_to_candidates(label: str):
    # Ảnh = tên Player nguyên văn (vd "FL.ABCD" -> "FL.ABCD.png") — chỉ lọc bớt ký tự Windows cấm
    # dùng trong tên file, không đổi case/format gì khác để giữ đúng tên tuyển thủ.
    base = _INVALID_FILENAME_CHARS_RE.sub("_", label).strip()
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
            f'  - Player "{label}" nhưng không thấy file ảnh nào trong {candidates}'
            for label, candidates in missing
        ]
        raise ValueError(
            f'Thiếu {len(missing)} ảnh (đặt tên theo Player) trong "{images_dir}":\n' + "\n".join(lines)
        )

    used = {name.lower() for name in resolved.values()}
    unused = [
        f.name for f in files_on_disk
        if f.is_file() and f.suffix.lower() in (".png", ".jpg", ".jpeg") and f.name.lower() not in used
    ]
    if unused:
        print(f"⚠️  Cảnh báo: {len(unused)} ảnh trong thư mục không được nhắc tới (không chặn): {unused}", file=sys.stderr)

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
    "  Mic Check - Chuyen doi file du lieu\n"
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
        "input_dropped", nargs="?", type=Path,
        help="(chế độ kéo-thả) đường dẫn file .docx/.csv — tự suy ra --images/--out-dir là thư mục chứa nó",
    )
    ap.add_argument("--input", type=Path)
    ap.add_argument("--images", type=Path)
    ap.add_argument("--out-dir", type=Path)
    args = ap.parse_args()

    print(BANNER)

    input_path = args.input or args.input_dropped
    if input_path is None:
        print(f'Cach dung: KEO file ({"/".join(SUPPORTED_EXTENSIONS)}) tha vao bieu tuong nay (khong phai mo file nay truc tiep).')
        _pause_if_interactive()
        sys.exit(1)

    if input_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        print(f'Loi: file vua tha co dinh dang chua ho tro ("{input_path}"). Chi doc duoc: {", ".join(SUPPORTED_EXTENSIONS)}')
        _pause_if_interactive()
        sys.exit(1)

    if not input_path.is_file():
        print(f'Loi: khong tim thay file "{input_path}".')
        _pause_if_interactive()
        sys.exit(1)

    images_dir = args.images or input_path.parent
    out_dir = args.out_dir or input_path.parent

    print(f"File du lieu : {input_path}")
    print(f"Thu muc      : {images_dir}\n")

    try:
        print(f"Đọc: {input_path}")
        cues = parse_cues(input_path)
        print(f"Parse được {len(cues)} cue.")

        print(f"Validate ảnh trong: {images_dir}")
        resolved_images = validate_images(cues, images_dir)
        for cue in cues:
            if cue["image"]:
                cue["image"] = resolved_images[cue["image"]]

        out_dir.mkdir(parents=True, exist_ok=True)
        stem = input_path.stem

        json_path = out_dir / f"{stem}.cues.json"
        output = {
            "sourceFile": input_path.name,
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
