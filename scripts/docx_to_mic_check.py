#!/usr/bin/env python3
"""
docx_to_mic_check.py — Đọc bảng "Time Stamp | Player | <1 hoặc nhiều cột phụ đề>" trong file
.docx/.csv/.xlsx (mẫu Mic Check) và xuất ra: cues.json (dùng cho run_mic_check_workflow) + 1 file
.srt cho MỖI cột phụ đề tìm thấy (vd "ID"/"EN"/"VN"/"TH"... — tên cột nào cũng được, không hardcode).

Ảnh nhân vật KHÔNG được resolve ở đây nữa — chỉ ghi lại tên Player thô vào cues.json, việc tìm file
ảnh thật (kể cả tìm đệ quy trong thư mục ảnh dùng chung nhiều thư mục con) do plugin UXP làm ở
Premiere, vì giờ thư mục ảnh nhân vật là 1 thư mục RIÊNG dùng chung cho nhiều dự án, không còn nằm
cùng thư mục với file dữ liệu nữa.

Tên các file .srt xuất ra luôn có hậu tố tên cột (vd "<tên file>_ID.srt", "<tên file>_EN.srt") kể cả
khi bảng chỉ có 1 cột phụ đề — nhất quán, dễ dò tìm bằng script khác, không cần đoán quy ước.

Xuất tất cả từ CÙNG 1 nguồn dữ liệu (bảng) — đảm bảo SRT và JSON luôn khớp nhau tuyệt đối. Dùng
python-docx đọc trực tiếp qua Table API cho .docx (không regex/XML thô), module csv chuẩn cho .csv,
và openpyxl cho .xlsx (data_only=True lấy giá trị công thức đã tính) — bền hơn vì đọc đúng theo cấu
trúc cell/dòng thật, không phụ thuộc giả định thứ tự dòng.

Chạy NGOÀI Premiere (Python thuần) — không phụ thuộc UXP, không cần Claude cho các lần chạy lại.

Usage (2 cách, cùng 1 script):
    1) Kéo-thả: kéo file .docx/.csv/.xlsx tha thang vao Chuyen_Doi_File_Mic_Check.exe (hoac file
       .py neu chay qua python) — tu suy ra --out-dir la thu muc chua file do do.
           Chuyen_Doi_File_Mic_Check.exe "duong/dan/file.docx"
    2) Dong lenh, tuy chinh thu muc xuat rieng:
           python docx_to_mic_check.py --input <path.docx|path.csv|path.xlsx> --out-dir <thư mục xuất>

Số lượng cue KHÔNG hardcode — script tự đọc bất kỳ số dòng nào có trong bảng/file. Số lượng cột phụ
đề cũng KHÔNG hardcode — script tự nhận diện mọi cột header ngoài "Time Stamp"/"Player".
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
from openpyxl import load_workbook

# Chấp nhận cả "-->" (kiểu SRT chuẩn) lẫn "→" (mũi tên Unicode U+2192 — gặp thật trong file export từ
# Google Sheets, 2026-09-11). Giờ (H) và mili giây (ms) đều TUỲ CHỌN — gặp thật 2 kiểu khác nhau
# trong cùng ngày: "00:00:00,000 --> 00:00:01,200" (đủ H:M:S,ms) và "00:00 --> 00:01" (chỉ M:S, không
# giờ không ms). Regex dùng nhóm optional "(?:(\d+):)?" cho giờ + "(?:[,.](\d+))?" cho ms, dựa vào cơ
# chế backtrack tự nhiên của regex để tự phân biệt đúng M:S,ms với H:M:S (không ms) — không cần đoán
# thêm logic gì khác.
TIMESTAMP_RE = re.compile(
    r"(?:(\d+):)?(\d+):(\d+)(?:[,.](\d+))?\s*(?:-->|→)\s*(?:(\d+):)?(\d+):(\d+)(?:[,.](\d+))?"
)

SUPPORTED_EXTENSIONS = (".docx", ".csv", ".xlsx")

# Ký tự Windows cấm dùng trong tên file — dùng cho cả tên ảnh (Player) lẫn hậu tố tên cột trong tên
# file .srt.
_INVALID_FILENAME_CHARS_RE = re.compile(r'[<>:"/\\|?*]')


def sanitize_filename_component(text: str) -> str:
    return _INVALID_FILENAME_CHARS_RE.sub("_", text).strip()


def to_seconds(h, m, s, ms):
    # h và ms có thể là None (timestamp kiểu "MM:SS" không có giờ/mili giây) — coi như 0.
    h = int(h) if h else 0
    ms = int(ms) if ms else 0
    return h * 3600 + int(m) * 60 + int(s) + ms / 1000


def _cell_to_str(value) -> str:
    # Excel có thể trả về None (ô trống), số, hoặc datetime.time/datetime.datetime nếu ô được Excel
    # tự nhận dạng là giờ/ngày — ép hết về string để dùng chung logic parse với docx/csv. Cột Time
    # Stamp dạng "00:00:01,200 --> 00:00:02,500" có dấu phẩy/mũi tên nên Excel không tự convert
    # thành time thật, nhưng vẫn phòng hờ cho các cột khác lỡ bị Excel tự định dạng.
    if value is None:
        return ""
    return str(value).strip()


def load_sheets(path: Path):
    """Đọc file .docx/.csv/.xlsx thành list (sheet_name, rows) — mỗi "rows" là list các dòng, mỗi
    dòng là list ô text đã strip(), chuẩn hoá về 1 định dạng chung để phần parse phía sau dùng chung
    logic, không quan tâm nguồn gốc file.

    .xlsx đọc TẤT CẢ sheet trong file (không chỉ sheet active) — mỗi sheet là 1 phần tử riêng, vì 1
    file thật (vd lịch trận nhiều tuần) có thể có nhiều sheet, mỗi sheet lại có thể chứa nhiều bảng
    cạnh nhau (xem find_all_table_blocks). .docx/.csv không có khái niệm nhiều sheet nên chỉ trả về
    đúng 1 phần tử, sheet_name=None."""
    suffix = path.suffix.lower()
    if suffix == ".docx":
        doc = Document(str(path))
        if not doc.tables:
            raise ValueError(f'File "{path}" không có bảng nào.')
        table = doc.tables[0]
        rows = [[cell.text.strip() for cell in row.cells] for row in table.rows]
        return [(None, rows)]

    if suffix == ".csv":
        # utf-8-sig tự bỏ BOM nếu Excel/Google Sheets export kèm — không có BOM thì đọc utf-8 bình
        # thường, không ảnh hưởng gì.
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            rows = [[cell.strip() for cell in row] for row in reader if row]
        return [(None, rows)]

    if suffix == ".xlsx":
        # data_only=True lấy giá trị đã TÍNH SẴN của công thức (không lấy công thức thô "=A1&B1").
        wb = load_workbook(str(path), data_only=True, read_only=True)
        sheets = []
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows = [[_cell_to_str(cell) for cell in row] for row in ws.iter_rows(values_only=True)]
            rows = [row for row in rows if any(row)]  # bỏ dòng trống hoàn toàn
            sheets.append((sheet_name, rows))
        wb.close()
        return sheets

    raise ValueError(
        f'Định dạng file "{path.suffix}" chưa được hỗ trợ. Chỉ đọc được: '
        + ", ".join(SUPPORTED_EXTENSIONS)
    )


def find_all_table_blocks(rows):
    """Tìm dòng header theo NỘI DUNG cell (không hardcode chỉ số dòng) — hỗ trợ NHIỀU bảng xếp CẠNH
    NHAU (theo cột) trong cùng 1 dòng header, ngăn cách bởi ít nhất 1 cột trống (vd sheet ghép nhiều
    trận/nhiều đội, mỗi bảng riêng 1 nhóm "Time Stamp | Player | ..."). Chỉ dò 1 dòng header cho toàn
    sheet (không hỗ trợ nhiều nhóm bảng xếp CHỒNG dọc).

    Trả về list block, mỗi block là dict:
    - header_row_idx: chỉ số dòng header
    - col_map: {"timestamp": idx, "player": idx} — 2 cột BẮT BUỘC của block này
    - text_columns: {label: idx} — cột phụ đề thật sự của block này (vd "EN", "ID", "VN"...)
    - col_start/col_end: biên cột của block (dùng để đọc "mã" ở dòng ngay trên header)

    Mỗi "Time Stamp" tìm thấy trong dòng header mở ra 1 block mới, kéo dài tới ngay trước "Time
    Stamp" kế tiếp (hoặc hết dòng nếu là block cuối) — nhờ vậy không cần biết trước có bao nhiêu bảng.

    Áp dụng lại đúng logic "dòng đánh dấu kiểu cột Text" (lọc cột thừa không phải phụ đề) như bản cũ,
    nhưng CHỈ xét trong phạm vi cột của từng block, không ảnh hưởng block khác."""
    for row_idx, row in enumerate(rows):
        cells_lower = [c.lower() for c in row]
        ts_indices = [idx for idx, cell_text in enumerate(cells_lower) if cell_text == "time stamp"]
        if not ts_indices:
            continue

        blocks = []
        for b, ts_idx in enumerate(ts_indices):
            col_start = ts_idx
            col_end = ts_indices[b + 1] - 1 if b + 1 < len(ts_indices) else len(row) - 1

            player_idx = None
            for idx in range(col_start, col_end + 1):
                if idx < len(cells_lower) and cells_lower[idx] == "player":
                    player_idx = idx
                    break
            if player_idx is None:
                raise ValueError(
                    f'Tìm thấy cột "Time Stamp" (cột {ts_idx + 1}) nhưng không thấy cột "Player" '
                    "đi kèm trong cùng nhóm bảng — kiểm tra lại tên cột."
                )

            col_map = {"timestamp": ts_idx, "player": player_idx}
            used_idx = {ts_idx, player_idx}
            candidate_columns = {}
            for idx in range(col_start, col_end + 1):
                if idx in used_idx or idx >= len(row):
                    continue
                label = row[idx].strip()
                if label:
                    candidate_columns[label] = idx

            if not candidate_columns:
                raise ValueError(
                    f'Bảng ở cột {ts_idx + 1} có đủ "Time Stamp"/"Player" nhưng không thấy cột phụ đề '
                    'nào khác (vd "EN") — cần ít nhất 1 cột phụ đề ngoài 2 cột đó.'
                )

            text_columns = candidate_columns
            marker_row = rows[row_idx + 1] if row_idx + 1 < len(rows) else None
            if marker_row is not None:
                marker_ts = marker_row[ts_idx] if len(marker_row) > ts_idx else ""
                looks_like_marker = not TIMESTAMP_RE.match(marker_ts)
                marked_columns = {}
                for label, idx in candidate_columns.items():
                    cell = marker_row[idx].strip().lower() if len(marker_row) > idx else ""
                    if cell not in ("", "text"):
                        looks_like_marker = False
                        break
                    if cell == "text":
                        marked_columns[label] = idx
                if looks_like_marker and marked_columns:
                    text_columns = marked_columns

            blocks.append({
                "header_row_idx": row_idx,
                "col_map": col_map,
                "text_columns": text_columns,
                "col_start": col_start,
                "col_end": col_end,
            })
        return blocks

    # Không tìm thấy dòng header nào có "Time Stamp" — trả về rỗng thay vì raise ngay, để caller tự
    # quyết định đây là lỗi (file/sheet duy nhất) hay chỉ đơn giản là sheet không phải bảng cue (vd
    # sheet phụ lục thoại rời, đọc nhiều sheet thì bỏ qua sheet này là hợp lý, không phải lỗi).
    return []


def block_table_name(rows, block):
    """Lấy "mã"/tên bảng từ Ô ĐẦU TIÊN không rỗng ở dòng NGAY TRÊN dòng header, trong đúng phạm vi
    cột của block đó. Trả về None nếu không có dòng trên (header ở dòng đầu file) hoặc dòng đó rỗng
    trong phạm vi cột — dùng để phân biệt file chỉ có 1 bảng (không cần dòng tên) với file nhiều bảng
    (BẮT BUỘC có dòng tên để đặt tên file xuất ra).

    CHỈ lấy dòng ĐẦU TIÊN của ô đó (splitlines()[0]) — thực tế gặp ô tên bảng có kèm link Google
    Drive xuống dòng ngay dưới tên đội (vd "TH - FLCN - BOOYAH - \nhttps://drive.google.com/..."),
    link đó không phải 1 phần của mã, phải bỏ trước khi dùng làm tên file."""
    header_row_idx = block["header_row_idx"]
    if header_row_idx == 0:
        return None
    name_row = rows[header_row_idx - 1]
    for idx in range(block["col_start"], block["col_end"] + 1):
        if idx < len(name_row) and name_row[idx].strip():
            first_line = name_row[idx].strip().splitlines()[0].strip()
            if first_line:
                return first_line
    return None


def extract_cues_for_block(rows, block, table_label=None):
    """Đọc cue cho ĐÚNG 1 block (1 bảng) — dùng col_map/text_columns riêng của block đó, quét TOÀN
    BỘ các dòng sau header (không giới hạn theo block khác) vì mỗi block có cột riêng, các dòng dữ
    liệu của block khác hay dòng nội dung không liên quan (vd phụ lục cuối sheet) sẽ tự bị bỏ qua do
    cột Time Stamp của block này rỗng/không khớp định dạng — không cần lọc gì thêm."""
    col_map = block["col_map"]
    text_columns = block["text_columns"]
    text_labels = sorted(text_columns.keys(), key=lambda label: text_columns[label])

    cues = []
    rejected_timestamps = []  # để báo lỗi rõ nếu cuối cùng không ra cue nào nhưng có dòng có vẻ là dữ liệu
    max_col = max(list(col_map.values()) + list(text_columns.values()))
    for row in rows[block["header_row_idx"] + 1:]:
        if len(row) <= max_col:
            continue  # dòng thiếu cột (vd dòng trống cuối file CSV/xlsx) — bỏ qua, không phải lỗi

        ts_text = row[col_map["timestamp"]]
        m = TIMESTAMP_RE.match(ts_text)
        if not m:
            if ts_text:
                # dòng có nội dung nhưng không khớp định dạng — có thể là dòng trang trí, dữ liệu của
                # 1 block KHÁC (cột này rỗng với block khác đó), hoặc timestamp gõ sai định dạng, nên
                # lưu lại vài ví dụ đầu tiên để báo lỗi rõ hơn nếu cuối cùng parse ra 0 cue.
                if len(rejected_timestamps) < 5:
                    rejected_timestamps.append(ts_text)
            continue  # dòng trang trí/rỗng — bỏ qua, không phải lỗi (trừ khi không ra cue nào ở cuối)

        start = to_seconds(m.group(1), m.group(2), m.group(3), m.group(4))
        end = to_seconds(m.group(5), m.group(6), m.group(7), m.group(8))
        if start >= end:
            raise ValueError(f'Cue "{ts_text}": start phải nhỏ hơn end.')

        player = row[col_map["player"]]
        texts = {label: row[text_columns[label]] for label in text_labels}

        cues.append({
            "index": len(cues),
            "start": round(start, 3),
            "end": round(end, 3),
            "player": player or None,
            "image": player or None,  # tên ảnh cần tìm — plugin UXP tự tìm file thật, xem README
            "texts": texts,
        })

    if not cues:
        prefix = f'Bảng "{table_label}": ' if table_label else ""
        if rejected_timestamps:
            examples = "\n".join(f'  - "{t}"' for t in rejected_timestamps)
            raise ValueError(
                f"{prefix}Parse xong nhưng không ra cue nào. Cột \"Time Stamp\" có nội dung nhưng "
                'KHÔNG đúng định dạng bắt buộc "GIO:PHUT:GIAY,MILIGIAY --> GIO:PHUT:GIAY,MILIGIAY" '
                '(vd: 00:00:01,200 --> 00:00:02,500).\n'
                f"Vài giá trị tìm thấy trong cột Time Stamp (không khớp định dạng):\n{examples}"
            )
        raise ValueError(
            f"{prefix}Parse xong nhưng không ra cue nào — cột \"Time Stamp\" trống ở mọi dòng dữ "
            "liệu, kiểm tra lại nội dung bảng."
        )
    return cues, text_labels


def parse_tables(path: Path):
    """Đọc TOÀN BỘ bảng cue trong file — kể cả nhiều SHEET (.xlsx) và nhiều bảng cạnh nhau trong mỗi
    sheet — trả về list, mỗi phần tử là 1 bảng: {"name": <mã bảng, hoặc None nếu cả file chỉ có
    đúng 1 bảng duy nhất>, "sheet": <tên sheet, None nếu không phải .xlsx>, "cues": [...],
    "text_labels": [...]}.

    Cả FILE chỉ có ĐÚNG 1 bảng duy nhất (trường hợp phổ biến nhất, mẫu chuẩn — 1 sheet, không nhiều
    bảng) → "name" = None, giữ nguyên hành vi cũ (xuất file theo tên file gốc, không đòi hỏi dòng tên
    phía trên header).

    File có NHIỀU bảng — dù là nhiều bảng cạnh nhau trong 1 sheet, hay nhiều sheet, hay cả hai — BẮT
    BUỘC mỗi bảng phải có 1 dòng "mã"/tên ngay trên header của nó (ô đầu tiên không rỗng trong phạm
    vi cột bảng đó) — dùng để đặt tên file .cues.json/.srt xuất ra, khớp thẳng với cơ chế "Mã" đã có
    trong plugin Premiere.

    Sheet không có bảng cue nào (vd sheet phụ lục thoại rời, không có cột Time Stamp/Player) tự động
    bị bỏ qua NẾU file còn sheet khác có bảng — chỉ báo lỗi nếu file/sheet duy nhất không có bảng nào."""
    sheets = load_sheets(path)

    per_sheet_blocks = []  # [(sheet_name, rows, blocks)] — chỉ giữ sheet có ít nhất 1 bảng
    for sheet_name, rows in sheets:
        blocks = find_all_table_blocks(rows)
        if not blocks:
            if len(sheets) > 1:
                label = sheet_name or "(không tên)"
                print(f'  (Bỏ qua sheet "{label}" — không có bảng cue nào trong sheet này.)')
                continue
            raise ValueError('Không tìm thấy dòng header có đủ 2 cột "Time Stamp"/"Player" trong bảng.')
        per_sheet_blocks.append((sheet_name, rows, blocks))

    if not per_sheet_blocks:
        raise ValueError("Không tìm thấy bảng cue nào (đủ cột \"Time Stamp\"/\"Player\") trong bất kỳ sheet nào của file.")

    total_blocks = sum(len(blocks) for _, _, blocks in per_sheet_blocks)

    tables = []
    for sheet_name, rows, blocks in per_sheet_blocks:
        for block in blocks:
            name = block_table_name(rows, block) if total_blocks > 1 else None
            if total_blocks > 1 and not name:
                sheet_note = f' sheet "{sheet_name}",' if sheet_name else ""
                raise ValueError(
                    f"File có nhiều hơn 1 bảng cue (tại{sheet_note} cột {block['col_start'] + 1}-"
                    f"{block['col_end'] + 1}) nhưng KHÔNG tìm thấy dòng \"mã\"/tên bảng ngay phía "
                    "trên dòng header của nó. Mỗi bảng cần 1 dòng tên riêng (vd \"VN-FL-D3-G2 Week "
                    '2") ở đúng ô đầu cột của bảng đó, ngay trên dòng "Time Stamp | Player | ...".'
                )
            table_label = name or sheet_name
            cues, text_labels = extract_cues_for_block(rows, block, table_label=table_label)
            tables.append({"name": name, "sheet": sheet_name, "cues": cues, "text_labels": text_labels})

    return tables


def format_srt_timestamp(seconds: float) -> str:
    total_ms = round(seconds * 1000)
    h, rem = divmod(total_ms, 3600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt_for_column(cues, label: str, srt_path: Path) -> int:
    """Ghi 1 file .srt cho đúng 1 cột phụ đề (label). Trả về số dòng phụ đề đã ghi."""
    lines = []
    count = 0
    for i, cue in enumerate(cues, start=1):
        text = (cue["texts"].get(label) or "").strip()
        if not text:
            continue
        lines.append(str(i))
        lines.append(f'{format_srt_timestamp(cue["start"])} --> {format_srt_timestamp(cue["end"])}')
        lines.append(text)
        lines.append("")
        count += 1
    # newline="\n" ép LF thuần — mặc định Python trên Windows tự dịch "\n" thành "\r\n" khi ghi text
    # mode, làm SRT xuất ra khác byte-cho-byte so với file gốc dù nội dung giống hệt.
    srt_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return count


# Dùng CHUNG 1 số version với plugin (mic-check-plugin/plugin/manifest.json) cho cả gói Mic Check —
# bump cả 2 cùng lúc mỗi khi có thay đổi người dùng cuối nhìn thấy, để chỉ cần nhớ đúng 1 con số.
MIC_CHECK_VERSION = "1.5.0"

BANNER = (
    "===============================================\n"
    f"  Mic Check v{MIC_CHECK_VERSION} - Chuyen doi file du lieu\n"
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
        help="(chế độ kéo-thả) đường dẫn file .docx/.csv/.xlsx — tự suy ra --out-dir là thư mục chứa nó",
    )
    ap.add_argument("--input", type=Path)
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

    out_dir = args.out_dir or input_path.parent

    print(f"File du lieu : {input_path}")
    print(f"Thu muc xuat : {out_dir}\n")

    try:
        print(f"Đọc: {input_path}")
        tables = parse_tables(input_path)
        if len(tables) > 1:
            print(f"Phát hiện {len(tables)} bảng cạnh nhau trong file, mỗi bảng xuất riêng 1 bộ file:")

        out_dir.mkdir(parents=True, exist_ok=True)
        stem = input_path.stem

        for table in tables:
            cues = table["cues"]
            text_labels = table["text_labels"]
            base = sanitize_filename_component(table["name"]) if table["name"] else stem
            label_note = f' — mã "{table["name"]}"' if table["name"] else ""
            print(f"\nBảng{label_note}: {len(cues)} cue, {len(text_labels)} cột phụ đề: {', '.join(text_labels)}")

            json_path = out_dir / f"{base}.cues.json"
            output = {
                "sourceFile": input_path.name,
                "sourceTable": table["name"],
                "cueCount": len(cues),
                "subtitleColumns": text_labels,
                "cues": cues,
            }
            json_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n")
            print(f"✅ Đã ghi {json_path}")

            for label in text_labels:
                suffix = sanitize_filename_component(label)
                srt_path = out_dir / f"{base}_{suffix}.srt"
                count = write_srt_for_column(cues, label, srt_path)
                print(f"✅ Đã ghi {srt_path} ({count} dòng phụ đề)")

        print(f'\n✅ Xong! Mo panel "Mic Check" trong Premiere, bam "Chon" chon dung thu muc du lieu:\n   {out_dir}')
    except Exception as e:
        print(f"\n❌ Co loi xay ra: {e}")
        _pause_if_interactive()
        sys.exit(1)

    _pause_if_interactive()


if __name__ == "__main__":
    main()
