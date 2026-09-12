# -*- coding: utf-8 -*-
"""
QC script for Mic Check subtitle cue tables.
Reads the source workbook (Week 1..4 + Sheet3), finds each "Time Stamp / Player / <langs>"
table block per sheet, validates the Time Stamp format ("M:SS - M:SS" or "H:MM:SS - H:MM:SS"),
and writes a QC Report workbook identical in shape to QC_Report_FFWS_Sea_Fall_2026.xlsx.
"""
import re
import sys
import openpyxl
from openpyxl.styles import Font

SRC = sys.argv[1] if len(sys.argv) > 1 else r"F:\tải xuống\Copy of FFWS Sea Fall 2026.xlsx"
OUT = sys.argv[2] if len(sys.argv) > 2 else r"F:\tải xuống\QC_Report_FFWS_Sea_Fall_2026_v2.xlsx"

TS_RE = re.compile(
    r"^\s*(\d{1,2}(?::\d{2}){1,2}(?:[.,]\d{1,3})?)\s*(?:-->|→|-)\s*"
    r"(\d{1,2}(?::\d{2}){1,2}(?:[.,]\d{1,3})?)\s*$"
)


def to_seconds(t):
    t = t.replace(",", ".")
    if "." in t:
        t, ms = t.split(".")
        ms = float("0." + ms)
    else:
        ms = 0.0
    parts = [int(p) for p in t.split(":")]
    sec = 0
    for p in parts:
        sec = sec * 60 + p
    return sec + ms


def find_table_starts(header_row, width):
    return [c for c in range(width) if header_row[c] == "Time Stamp"]


def col_letter_range(start0, end0):
    def L(i):
        s = ""
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s
    return f"{start0 + 1}-{end0 + 1}"


def process_sheet(ws, sheet_name, results):
    max_row = ws.max_row
    max_col = ws.max_column
    rows = list(ws.iter_rows(min_row=1, max_row=max_row, min_col=1, max_col=max_col, values_only=True))
    if len(rows) < 2:
        results.append([sheet_name, None, "-", "SKIP", None, None,
                         f'Sheet "{sheet_name}": không đủ dữ liệu.'])
        return
    title_row, header_row = rows[0], rows[1]

    starts = find_table_starts(header_row, max_col)
    if not starts:
        results.append([sheet_name, None, "-", "SKIP", None, None,
                         f'Sheet "{sheet_name}": không có bảng cue nào (không có cột "Time Stamp"/"Player").'])
        return

    for idx, start in enumerate(starts):
        end = (starts[idx + 1] - 1) if idx + 1 < len(starts) else (max_col - 1)
        # trim trailing blank separator column(s)
        block_end = end
        while block_end > start and header_row[block_end] is None and title_row[block_end] is None:
            block_end -= 1

        headers = header_row[start:block_end + 1]
        lang_cols = [start + i for i, h in enumerate(headers) if h not in ("Time Stamp", "Player", None)]
        lang_names = [header_row[c] for c in lang_cols]

        table_name = title_row[start]
        if table_name is None:
            for c in range(start, block_end + 1):
                if title_row[c] is not None:
                    table_name = title_row[c]
                    break
        table_name = (table_name or "").split("\n")[0].strip()

        col_range = col_letter_range(start, end)

        cue_count = 0
        bad_samples = []
        bad_cue_msg = None

        for r in rows[3:]:
            ts = r[start]
            player = r[start + 1] if start + 1 <= block_end else None
            if ts is None and player is None:
                continue
            ts_str = str(ts).strip() if ts is not None else ""
            m = TS_RE.match(ts_str)
            if not m:
                if len(bad_samples) < 5:
                    bad_samples.append(ts_str)
                continue
            s_sec, e_sec = to_seconds(m.group(1)), to_seconds(m.group(2))
            if s_sec >= e_sec and bad_cue_msg is None:
                bad_cue_msg = f'Cue "{m.group(1)} - {m.group(2)}": start phải nhỏ hơn end.'
                continue
            if bad_cue_msg is not None:
                continue
            cue_count += 1

        if bad_cue_msg:
            results.append([sheet_name, table_name, col_range, "SKIP", None, None, bad_cue_msg])
        elif cue_count == 0:
            sample_txt = "\n".join(f'  - "{s}"' for s in bad_samples)
            msg = (f'Bảng "{table_name}": Parse xong nhưng không ra cue nào. Cột "Time Stamp" có nội dung '
                   f'nhưng KHÔNG đúng định dạng bắt buộc "M:SS - M:SS" (vd: 00:00 - 00:01).\n'
                   f'Vài giá trị tìm thấy trong cột Time Stamp (không khớp định dạng):\n{sample_txt}')
            results.append([sheet_name, table_name, col_range, "SKIP", None, None, msg])
        else:
            results.append([sheet_name, table_name, col_range, "OK", cue_count, ", ".join(lang_names), None])


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    results = []
    for name in wb.sheetnames:
        process_sheet(wb[name], name, results)

    ok = sum(1 for r in results if r[3] == "OK")
    skip = sum(1 for r in results if r[3] == "SKIP")

    out = openpyxl.Workbook()
    ws = out.active
    ws.title = "QC Report"
    ws.append([f"Tổng: {len(results)} bảng — {ok} OK, {skip} SKIP", None, None, None, None, None, None])
    ws.append(["Sheet", "Mã bảng", "Vị trí cột", "Trạng thái", "Số cue", "Cột phụ đề", "Lý do lỗi"])
    for row in results:
        status = "✅ OK" if row[3] == "OK" else "❌ SKIP"
        ws.append([row[0], row[1], row[2], status, row[4], row[5], row[6]])
    ws["A1"].font = Font(bold=True)
    ws["A2"].font = Font(bold=True)
    for col, width in zip("ABCDEFG", [16, 32, 12, 10, 8, 14, 90]):
        ws.column_dimensions[col].width = width
    for row in ws.iter_rows(min_row=3):
        row[6].alignment = row[6].alignment.copy(wrapText=True)

    out.save(OUT)
    print("Saved:", OUT)
    print(f"Tong: {len(results)} bang - {ok} OK, {skip} SKIP")
    for row in results:
        print(row[0], "|", row[1], "|", row[2], "|", row[3], "|", row[4], "|", row[5])


if __name__ == "__main__":
    main()
