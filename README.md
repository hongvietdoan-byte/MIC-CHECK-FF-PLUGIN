# Mic Check — Premiere Pro Plugin (Standalone)

Plugin UXP độc lập cho Premiere Pro, dùng để dựng nhanh timeline gồm video nền + ảnh nhân vật + caption đồng bộ theo thời gian, từ một file docx (bảng Time Stamp/Player/EN/Ảnh) và/hoặc SRT.

**Không cần Claude, MCP, Node server hay mạng internet.** Plugin chạy hoàn toàn trong Premiere, chỉ đọc/ghi file cục bộ trên máy bạn.

## Yêu cầu

- Adobe Premiere Pro **26.2.0 trở lên** (2026 release, tháng 2/2026+). Bản cũ hơn không có API set frame rate cần dùng.
- Python 3.9+ (chỉ cần cho bước chuyển đổi docx → json, không cần để chạy plugin).
- Tuỳ cách cài (xem 2 lựa chọn bên dưới): **Adobe Creative Cloud Desktop** (cách A, khuyên dùng khi chia sẻ ra ngoài) hoặc [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/) (cách B, dùng khi tự dev/sửa code).

## Cài đặt plugin

### Cách A — file `.ccx` (khuyên dùng để chia sẻ ra ngoài)

Đơn giản nhất cho người nhận không rành kỹ thuật — không cần cài UXP Developer Tool, không cần ký số.

1. Người nhận cần có **Adobe Creative Cloud Desktop** đã cài và đăng nhập sẵn (thường có sẵn nếu đã dùng Premiere).
2. Double-click file [`MicCheck.ccx`](MicCheck.ccx) (nằm sẵn ở gốc thư mục `mic-check-plugin/`) → Creative Cloud Desktop tự nhận diện và cài vào Premiere Pro.
3. Mở Premiere Pro (hoặc khởi động lại nếu đang mở) → panel "Mic Check" xuất hiện ở **Window → Extensions → Mic Check**.

**Cách tự đóng gói file `.ccx` (cho người build/chia sẻ):**
1. Mở **UXP Developer Tool** → **Add Plugin** → chọn `mic-check-plugin/plugin/manifest.json` (chỉ để UDT nhận diện, chưa phải bước cài cuối).
2. Trên dòng plugin vừa thêm, bấm **Package** (nút gói/hộp hoặc trong menu "...") → chọn nơi lưu → UDT xuất ra file `.ccx`.
3. Gửi file `.ccx` đó cho người dùng, họ làm theo 3 bước ở trên.
4. Mỗi lần sửa code, cần bump số `version` trong `manifest.json` rồi Package lại — người dùng cài đè `.ccx` mới lên là tự cập nhật.

### Cách B — UXP Developer Tool (dùng khi tự dev/sửa code)

1. Mở **UXP Developer Tool**.
2. Bấm **Add Plugin**, chọn file `mic-check-plugin/plugin/manifest.json`.
3. Bấm **Load** trên dòng plugin vừa thêm (Premiere Pro phải đang mở sẵn).
4. Panel "Mic Check" xuất hiện trong Premiere: **Window → Extensions (Legacy/UXP) → Mic Check**, hoặc nó tự nổi lên nếu để chế độ floating.
5. Bật **Watch** trên dòng plugin để Premiere tự reload mỗi khi sửa code — tiện khi đang phát triển.

## Quy trình sử dụng (A → Z)

### Bước 1 — Chuẩn bị dữ liệu

Bạn cần một thư mục chứa:
- File `.docx` gốc (bảng Time Stamp / Player / EN / Ảnh) **hoặc** đã có sẵn file `<tên>.cues.json`
- Các file ảnh nhân vật được tham chiếu trong docx
- (Tuỳ chọn) 1 file video nền (`.mp4`/`.mov`/`.mxf`/`.avi`)
- (Tuỳ chọn) file `.srt` nếu muốn caption

Nếu chỉ có `.docx`, chuyển đổi sang `cues.json` + `.srt` bằng một trong hai cách:

**Cách nhanh (khuyên dùng cho người không rành kỹ thuật):**
Kéo thả file `.docx` vào `scripts/Chuyen_Doi_Mic_Check.bat`. Kết quả (`<tên>.cues.json`, `<tên>.srt`) sẽ được tạo ngay trong thư mục chứa file docx.

**Cách dùng dòng lệnh:**
```bash
pip install -r scripts/requirements.txt
python scripts/docx_to_mic_check.py "duong/dan/file.docx"
```

### Bước 2 — Chạy Mic Check trong Premiere

1. Mở panel **Mic Check**.
2. Bấm **Chọn** → chọn thư mục chứa `cues.json` + ảnh (+ video nền, `.srt` nếu có). Plugin tự dò file, nếu có nhiều lựa chọn (nhiều video hoặc nhiều `.srt`) sẽ cho chọn qua dropdown.
3. Nhập **Tên sequence** (gợi ý tự điền theo tên file cues.json).
4. Chọn **Hướng khung hình** (Landscape 1920x1080 hoặc Portrait 1080x1920).
5. Bấm **▶ Chạy Mic Check**. Plugin sẽ:
   - Tạo sequence mới ở 60fps đúng hướng đã chọn
   - Import video nền + file `.srt` (nếu có) + toàn bộ ảnh vào Project panel
   - Đặt video nền và từng ảnh lên timeline đúng thời điểm + thời lượng theo `cues.json`

### Bước 3 — Verify

Bấm **✓ Verify** để plugin so sánh timeline hiện tại với `cues.json`, báo cáo ảnh nào đặt đúng/lệch vị trí hoặc thời lượng.

### Bước 4 — Thêm caption (thủ công)

UXP API của Premiere hiện **không cho phép gắn SRT vào Caption Track bằng script** — đây là bước duy nhất còn phải làm tay. File `.srt` đã được plugin tự import sẵn vào **Project panel** ở Bước 2 (không cần tìm lại ngoài File Explorer):
1. Trong Premiere, tạo caption track: **Window → Text → Captions** hoặc kéo file `.srt` thẳng vào timeline.
2. Từ **Project panel**, kéo file `.srt` vào track caption, đặt ở vị trí giây 0.

Sau đó có thể bấm lại **✓ Verify** — nếu đã kéo caption, panel sẽ báo số lượng caption item tìm thấy trên track.

## Cấu trúc thư mục

```
mic-check-plugin/
├── MicCheck.ccx           — bản đóng gói sẵn, double-click cài qua Creative Cloud Desktop (Cách A)
├── plugin/
│   ├── manifest.json     — khai báo UXP plugin
│   ├── index.html        — giao diện panel
│   ├── panel.js          — logic UI, gọi các hàm trong actions.js
│   ├── actions.js         — toàn bộ logic tương tác Premiere (UXP API)
│   └── icons/icon.png
├── scripts/
│   ├── docx_to_mic_check.py     — chuyển docx → cues.json + srt
│   ├── Chuyen_Doi_Mic_Check.bat — launcher kéo-thả cho người không rành kỹ thuật
│   └── requirements.txt
└── README.md
```

## Ghi chú / giới hạn đã biết

- Font chữ, cỡ chữ, vị trí caption trên track không thể chỉnh tự động qua script — chỉnh tay trong Premiere như bình thường.
- Nếu hai cue ảnh có thời điểm bắt đầu cách nhau dưới 0.05 giây, việc dò clip vừa đặt có thể nhầm lẫn (trường hợp hiếm, chưa gặp trong dữ liệu thực tế).
- Khi chạy Mic Check với số lượng ảnh lớn (50+), plugin tự giãn cách 150ms giữa mỗi lần đặt clip để giảm rủi ro treo/crash Premiere — quá trình có thể mất vài chục giây, đừng thao tác vào Premiere trong lúc chạy.
- **Premiere Pro vẫn có thể tự đóng đột ngột (crash) giữa lúc chạy Mic Check** với các dự án nhiều ảnh (đây là giới hạn của bản thân Premiere khi dồn nhiều lệnh dựng timeline liên tiếp, không phải lỗi cú pháp cues.json). Nếu gặp crash:
  1. Mở lại Premiere — dùng bản Auto-Save/Recovery gần nhất nếu được hỏi.
  2. Mở lại panel Mic Check, **chọn lại đúng thư mục dự án** đó.
  3. Bấm **▶ Chạy Mic Check** lại bình thường — thao tác đặt clip dùng chế độ overwrite nên idempotent (an toàn chạy lại nhiều lần), các ảnh đã đặt đúng vị trí trước đó sẽ chỉ bị ghi đè lại chứ không nhân đôi.
  4. Nên **Save project (Ctrl+S)** thủ công trước khi chạy Mic Check với dự án nhiều ảnh, để có điểm khôi phục gần nhất nếu crash.
