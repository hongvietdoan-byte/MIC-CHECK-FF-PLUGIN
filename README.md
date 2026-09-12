# Mic Check — Premiere Pro Plugin (Standalone)

Plugin UXP độc lập cho Premiere Pro, dùng để dựng nhanh timeline gồm video + ảnh nhân vật + phụ đề (1 hoặc nhiều ngôn ngữ) đồng bộ theo thời gian, từ một file `.docx`, `.csv`, hoặc `.xlsx` (bảng Time Stamp/Player/&lt;1+ cột phụ đề&gt;). Hỗ trợ chạy hàng loạt nhiều đội/nhiều trận trong 1 lần bằng cách nhập **mã** — không cần tách riêng từng thư mục cho từng dự án.

**Không cần Claude, MCP, Node server hay mạng internet.** Plugin chạy hoàn toàn trong Premiere, chỉ đọc/ghi file cục bộ trên máy bạn.

## Yêu cầu

- Adobe Premiere Pro **26.2.0 trở lên** (2026 release, tháng 2/2026+). Bản cũ hơn không có API set frame rate cần dùng.
- **Không cần cài Python** — `scripts/Chuyen_Doi_File_Mic_Check.exe` đã đóng gói sẵn Python + thư viện, kéo-thả file `.docx`/`.csv`/`.xlsx` thẳng vào là dùng ngay. (Python 3.9+ chỉ cần nếu bạn muốn tự sửa/build lại từ `docx_to_mic_check.py`.)
- Tuỳ cách cài (xem 2 lựa chọn bên dưới): **Adobe Creative Cloud Desktop** (cách A, khuyên dùng khi chia sẻ ra ngoài) hoặc [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/) (cách B, dùng khi tự dev/sửa code).

## Cài đặt plugin

### Cách A — file `.ccx` (khuyên dùng để chia sẻ ra ngoài)

Đơn giản nhất cho người nhận không rành kỹ thuật — không cần cài UXP Developer Tool, không cần ký số.

1. Người nhận cần có **Adobe Creative Cloud Desktop** đã cài và đăng nhập sẵn (thường có sẵn nếu đã dùng Premiere).
2. Double-click file `.ccx` ở gốc thư mục `MIC CHECK PLUGIN/` (tên có kèm số phiên bản, hiện tại là [`MicCheck_v1.5.0.ccx`](MicCheck_v1.5.0.ccx)) → Creative Cloud Desktop tự nhận diện và cài vào Premiere Pro.
3. Mở Premiere Pro (hoặc khởi động lại nếu đang mở) → panel "Mic Check" xuất hiện ở **Window → Extensions → Mic Check**.

**Cách tự đóng gói file `.ccx` (cho người build/chia sẻ):**
1. Mở **UXP Developer Tool** → **Add Plugin** → chọn `MIC CHECK PLUGIN/plugin/manifest.json` (chỉ để UDT nhận diện, chưa phải bước cài cuối).
2. Trên dòng plugin vừa thêm, bấm **Package** (nút gói/hộp hoặc trong menu "...") → chọn nơi lưu → UDT xuất ra file `.ccx`.
3. Gửi file `.ccx` đó cho người dùng, họ làm theo 3 bước ở trên.
4. Mỗi lần sửa code, cần bump số `version` trong `manifest.json` rồi Package lại — đổi tên file xuất ra theo đúng version mới (vd `MicCheck_v1.5.0.ccx`) và xóa file `.ccx` phiên bản cũ đi, để tên file luôn khớp số phiên bản bên trong. Người dùng cài file `.ccx` mới (tên khác file cũ) là tự cập nhật.

### Cách B — UXP Developer Tool (dùng khi tự dev/sửa code)

1. Mở **UXP Developer Tool**.
2. Bấm **Add Plugin**, chọn file `MIC CHECK PLUGIN/plugin/manifest.json`.
3. Bấm **Load** trên dòng plugin vừa thêm (Premiere Pro phải đang mở sẵn).
4. Panel "Mic Check" xuất hiện trong Premiere: **Window → Extensions (Legacy/UXP) → Mic Check**, hoặc nó tự nổi lên nếu để chế độ floating.
5. Bật **Watch** trên dòng plugin để Premiere tự reload mỗi khi sửa code — tiện khi đang phát triển.

## Kiến trúc dữ liệu (quan trọng — đọc trước khi dùng)

Từ bản này, dữ liệu được tách thành **2 thư mục riêng biệt**, chọn 1 lần và dùng chung cho mọi dự án:

1. **Thư mục ảnh nhân vật** — 1 thư mục DÙNG CHUNG duy nhất, chứa toàn bộ ảnh mọi tuyển thủ của mọi đội (không cần tổ chức gọn gàng — plugin tự tìm ĐỆ QUY cả trong thư mục con). Mỗi ảnh đặt tên **trùng với giá trị cột Player** (vd Player ghi `FL.ABCD` thì cần file `FL.ABCD.png`/`.jpg`/`.jpeg` ở đâu đó trong thư mục này). Plugin nhớ lại thư mục này giữa các lần dùng, không cần chọn lại mỗi lần.
2. **Thư mục dữ liệu** — nơi chứa các file `.cues.json`/`.srt`/video do converter sinh ra, có thể chứa LẪN LỘN nhiều đội/nhiều trận cùng lúc (không cần mỗi dự án 1 thư mục riêng nữa). Plugin dùng **Mã** (xem bên dưới) để chọn đúng bộ file cần chạy trong đống lẫn lộn đó.

### Cơ chế "Mã" — chạy hàng loạt nhiều đội/nhiều trận

Đặt tên file `.docx`/`.csv`/`.xlsx` nguồn với **tiền tố mã riêng biệt**, khuyên dùng **ít nhất 3 cụm cách nhau bằng dấu `-`** để tránh trùng lặp (vd `VN-WAG-D3-G2__Week_2.csv`, mã ở đây là `VN-WAG-D3-G2`). Converter sinh ra file giữ nguyên tên gốc (`VN-WAG-D3-G2__Week_2.cues.json`, `VN-WAG-D3-G2__Week_2_EN.srt`...) nên mã luôn nằm sẵn trong tên file xuất ra.

Trong panel, gõ mã vào ô **"Mã"** (nhiều mã cách nhau bằng `;`, vd `VN-FL-D3-G2; VN-FL-D3-G1; TH-EVOS-D2-G1`):
- Plugin tìm trong **thư mục dữ liệu** mọi file `.cues.json` có tên CHỨA mã đó (không phân biệt hoa/thường).
- Mỗi file khớp → tạo **1 sequence mới riêng** (tên sequence = mã). Nếu 1 mã khớp nhiều file (mã chưa đủ cụ thể) thì vẫn chạy hết tất cả — không báo lỗi, chỉ cần đặt mã đủ dài (≥3 cụm) để tránh việc này.
- Mã nào không khớp file nào → báo rõ ở cuối, không chặn các mã khác.
- File `.srt` khớp theo **tiền tố tên file** trùng với file `.cues.json` đã khớp (tự động, không cần gõ thêm).
- File **video** (`.mp4`/`.mov`/`.mxf`/`.avi`) trong thư mục dữ liệu cũng được dò theo **cùng mã** — nếu 1 mã khớp nhiều video (vd nhiều góc quay), mỗi video được đặt vào **1 track V riêng** (V1, V2, ...), không đè/trồng chéo lên nhau. Ảnh nhân vật luôn nằm ở track ngay sau tất cả video đã đặt.

Nếu để trống ô **Mã** và thư mục dữ liệu chỉ có đúng 1 file `.cues.json`, plugin tự chạy luôn file đó (không bắt buộc phải gõ mã cho trường hợp đơn giản 1 dự án).

### Nhiều bảng cạnh nhau trong 1 file/sheet (vd ghép nhiều trận vào 1 sheet Google Sheets)

Converter (Bước 1) tự nhận diện được nếu 1 file `.csv`/`.xlsx` có **nhiều bảng xếp CẠNH NHAU theo cột**, ngăn cách bởi ít nhất 1 cột trống — mỗi bảng có đủ 1 cặp cột "Time Stamp"/"Player" riêng. Yêu cầu duy nhất: **mỗi bảng phải có 1 dòng mã/tên ngay phía trên dòng header của nó** (ô đầu cột của bảng, vd `VN-FL-D3-G2 Week 2`) — dòng này chính là mã dùng ở ô "Mã" trong panel.

Khi phát hiện nhiều bảng, converter tự xuất **riêng 1 bộ `cues.json` + `.srt`** cho từng bảng, đặt tên file theo đúng mã đó (không còn theo tên file gốc) — dùng thẳng luôn với cơ chế "Mã" ở trên, không cần thêm bước nào. File chỉ có **đúng 1 bảng** (trường hợp phổ biến, mẫu chuẩn) thì không cần dòng mã này, hành vi giữ nguyên như cũ (xuất theo tên file gốc).

**File `.xlsx` nhiều SHEET**: converter tự đọc **TẤT CẢ sheet** trong file (không chỉ sheet đang active), mỗi sheet lại có thể chứa nhiều bảng cạnh nhau như trên — không cần tách riêng từng sheet ra file khác trước khi chuyển đổi.

Nội dung không thuộc bảng nào (vd phần phụ lục thoại rời ở cuối sheet, hoặc cả 1 sheet phụ lục riêng không có cột Time Stamp/Player) tự động được bỏ qua, không cần xóa tay trước khi chuyển đổi.

**Bảng lỗi không chặn cả file**: nếu 1 bảng cụ thể có cột "Time Stamp" sai định dạng (vd chỉ ghi 1 mốc thời gian đơn thay vì khoảng start-end, hoặc dùng timecode Giờ:Phút:Giây:Frame) hoặc thiếu dòng mã khi cần, converter **bỏ qua đúng bảng đó** và in rõ lý do ở cuối log — các bảng khác trong cùng file vẫn được chuyển đổi bình thường, không cần sửa hết lỗi rồi mới chạy lại được.

## Quy trình sử dụng (A → Z)

### Bước 1 — Chuẩn bị dữ liệu

Tạo file `.docx`/`.csv`/`.xlsx` với bảng gồm 2 cột bắt buộc **Time Stamp / Player**, cộng **1 hoặc nhiều cột phụ đề** tuỳ ý (vd chỉ `EN`, hoặc cả `ID` + `EN`, hoặc `VN`/`TH`... — không giới hạn tên/số lượng cột). Chưa có sẵn file? Mở [`File_Mau_Docx_Mic_Check.docx`](File_Mau_Docx_Mic_Check.docx) làm mẫu.

Đặt tên file nguồn có **mã tiền tố** nếu định chạy hàng loạt nhiều đội (xem mục "Cơ chế Mã" ở trên).

Chuyển đổi sang `cues.json` + 1 file `.srt`/cột phụ đề bằng cách kéo thả file `.docx`/`.csv`/`.xlsx` thẳng vào biểu tượng `scripts/Chuyen_Doi_File_Mic_Check.exe` (đã đóng gói sẵn Python, không cần cài gì thêm). Ví dụ bảng có 2 cột `ID`+`EN` sẽ ra 2 file: `<tên>_ID.srt` và `<tên>_EN.srt`; bảng chỉ có `EN` thì ra đúng 1 file `<tên>_EN.srt`.

Dòng lệnh (tuỳ chỉnh thư mục xuất riêng, hoặc chạy từ source `.py`):
```bash
scripts/Chuyen_Doi_File_Mic_Check.exe --input "duong/dan/file.docx" --out-dir "thu muc xuat"
# hoặc: pip install -r scripts/requirements.txt && python scripts/docx_to_mic_check.py --input ... --out-dir ...
```

**Về file `.csv`**: nếu xuất từ Google Sheets/Excel, cột Time Stamp có dấu phẩy trong nội dung (`00:00:01,200 --> ...`) — công cụ export chuẩn sẽ tự bọc dấu ngoặc kép quanh cell đó, không cần chỉnh tay gì thêm. Encoding đọc là UTF-8 (tự bỏ BOM nếu có). Dấu phân cách thời gian chấp nhận cả `-->` (chuẩn SRT), `→` (mũi tên Unicode, hay gặp khi copy từ Google Sheets), lẫn `-` đơn (vd `00:00 - 00:01`, hay gặp trong file thi đấu thật).

Ảnh nhân vật và video (nếu có) **KHÔNG cần nằm cùng thư mục** với file nguồn — chuẩn bị riêng theo đúng kiến trúc 2-thư-mục ở trên.

### Bước 2 — Chạy Mic Check trong Premiere

1. Mở panel **Mic Check**.
2. Bấm **Chọn** ở dòng **Thư mục ảnh** → chọn thư mục ảnh dùng chung (chỉ cần làm 1 lần, plugin nhớ lại cho các lần sau).
3. Bấm **Chọn** ở dòng **Thư mục dữ liệu** → chọn thư mục chứa `cues.json`/`.srt`/video (có thể lẫn nhiều dự án).
4. Gõ **Mã** (bỏ trống nếu thư mục chỉ có 1 dự án) — nhiều mã cách nhau bằng `;` để chạy hàng loạt.
5. Chọn **Hướng khung hình** (áp dụng chung cho mọi sequence tạo trong lần chạy này).
6. Bấm **▶ Chạy Mic Check**. Với mỗi mã/file khớp, plugin tự:
   - Tạo 1 sequence mới, 60fps, đúng hướng đã chọn (tên sequence = mã, hoặc tên file nếu chạy không gõ mã)
   - Đặt video khớp mã (nếu có) lên các track V riêng biệt, đặt ảnh nhân vật lên track kế tiếp
   - Import toàn bộ file `.srt` khớp vào Project panel
   - Bỏ qua (và báo rõ ở cuối) những cue thiếu ảnh, không chặn cả lần chạy

### Bước 3 — Verify

Bấm **✓ Verify** — plugin tự đối chiếu **sequence đang active trong Premiere** (tự suy ra đúng file `cues.json` tương ứng theo tên sequence), báo ảnh nào đặt đúng/lệch vị trí hoặc thời lượng.

### Bước 4 — Chỉnh vị trí ảnh trên timeline (tùy chọn)

Sau khi đã **Chạy Mic Check** (hoặc bất kỳ lúc nào có ảnh trên timeline), panel có thêm khối điều khiển **Position/Scale** để chỉnh hàng loạt vị trí + kích thước toàn bộ ảnh trên 1 track cùng lúc — không cần vào Effect Controls chỉnh tay từng clip.

1. **Track** — gõ đúng số track Premiere hiển thị (vd ảnh nằm ở V2 thì gõ `2`).
2. **Vị trí** — bấm 1 trong 9 ô lưới 3×3 để chọn nhanh vị trí theo vùng (góc/giữa/cạnh, có tính safe zone cơ bản), hoặc gõ thẳng **X/Y theo pixel tuyệt đối** — số này **giống hệt** số hiển thị trong Premiere ở **Effect Controls → Motion → Position**, khớp trực tiếp không cần quy đổi.
3. **Scale %** — cũng giống hệt số ở **Effect Controls → Motion → Scale**.
4. Bấm **Áp dụng thay đổi cho ảnh trên track** — áp Position/Scale đó cho **toàn bộ** clip ảnh đang có trên track đã chọn. Hover vào icon **ⓘ** cạnh nút để xem cảnh báo: thao tác này **ghi đè** vị trí của mọi clip trên track, kể cả những clip bạn đã tự kéo tay chỉnh riêng trước đó.

**Lấy chuẩn từ 1 ảnh đã tự kéo tay chỉnh** — nếu bạn vừa tự kéo/resize 1 ảnh trong Program Monitor và muốn áp đúng vị trí đó cho các ảnh còn lại trên track:
1. Trong Premiere, click chọn đúng clip ảnh đó trên timeline.
2. Trong panel, bấm **Lấy motion từ ảnh đang chọn** — plugin đọc lại Position/Scale **thật** hiện tại của clip đó và tự điền vào ô X/Y/Scale.
3. Bấm **Áp dụng thay đổi cho ảnh trên track** như bình thường để áp cho các ảnh khác.

> Lưu ý: panel **không tự đồng bộ ngược** khi bạn kéo tay chỉnh trong Program Monitor — số trong ô X/Y/Scale chỉ đổi khi bạn tự gõ, chọn ô lưới, hoặc bấm "Lấy motion từ ảnh đang chọn". Nếu vừa tự chỉnh tay nhiều ảnh khác nhau rồi bấm "Áp dụng thay đổi..." với số cũ còn sót trong ô, các ảnh đó sẽ bị ghi đè về cùng 1 vị trí.

### Bước 5 — Thêm caption (thủ công)

UXP API của Premiere hiện **không cho phép gắn SRT vào Caption Track bằng script** — đây là bước duy nhất còn phải làm tay. File `.srt` đã được plugin tự import sẵn vào **Project panel** ở Bước 2 (không cần tìm lại ngoài File Explorer). Nếu có nhiều ngôn ngữ (nhiều file `.srt`), lặp lại bước này cho từng ngôn ngữ, mỗi ngôn ngữ 1 caption track riêng:
1. Trong Premiere, tạo caption track: **Window → Text → Captions** hoặc kéo file `.srt` thẳng vào timeline.
2. Từ **Project panel**, kéo file `.srt` vào track caption, đặt ở vị trí giây 0.

Sau đó có thể bấm lại **✓ Verify** — nếu đã kéo caption, panel sẽ báo số lượng caption item tìm thấy trên track.

## Cấu trúc thư mục

```
MIC CHECK PLUGIN/
├── MicCheck_v<version>.ccx      — bản đóng gói sẵn (tên kèm số phiên bản), double-click cài qua Creative Cloud Desktop (Cách A)
├── File_Mau_Docx_Mic_Check.docx — file .docx mẫu đúng format, dùng làm điểm bắt đầu (Bước 1)
├── plugin/
│   ├── manifest.json     — khai báo UXP plugin
│   ├── index.html        — giao diện panel
│   ├── panel.js          — logic UI, gọi các hàm trong actions.js
│   ├── actions.js         — toàn bộ logic tương tác Premiere (UXP API)
│   └── icons/icon.png
├── scripts/
│   ├── Chuyen_Doi_File_Mic_Check.exe — bản đóng gói sẵn (không cần cài Python) — kéo file .docx/.csv/.xlsx vào đây
│   ├── docx_to_mic_check.py     — source Python (đọc .docx/.csv/.xlsx), chỉ cần khi tự sửa/build lại .exe
│   └── requirements.txt         — dependency để chạy/build từ source .py
└── README.md
```

**Build lại `.exe` sau khi sửa `docx_to_mic_check.py`** (cần Python + pip):
```bash
pip install -r scripts/requirements.txt pyinstaller
cd scripts
pyinstaller --onefile --name Chuyen_Doi_File_Mic_Check --distpath . --workpath build --specpath build docx_to_mic_check.py
```
File `.exe` mới sẽ ghi đè lên bản cũ trong `scripts/`.

**Gói riêng để chia sẻ ra ngoài** (chỉ 4 file, không thư mục con — tránh người mới nhầm lẫn giữa nhiều file): xem thư mục `Mic Check Plugin - Share/` (nằm ngay trong `MIC CHECK PLUGIN/`), gồm `MicCheck_v<version>.ccx` + `File_Mau_Docx_Mic_Check.docx` + `Chuyen_Doi_File_Mic_Check.exe` + `HUONG_DAN_SU_DUNG.txt`.

## Ghi chú / giới hạn đã biết

- Font chữ, cỡ chữ, vị trí caption trên track không thể chỉnh tự động qua script — chỉnh tay trong Premiere như bình thường.
- Nếu hai cue ảnh có thời điểm bắt đầu cách nhau dưới 0.05 giây, việc dò clip vừa đặt có thể nhầm lẫn (trường hợp hiếm, chưa gặp trong dữ liệu thực tế).
- Khi chạy Mic Check với số lượng ảnh lớn (50+), plugin tự giãn cách 150ms giữa mỗi lần đặt clip để giảm rủi ro treo/crash Premiere — quá trình có thể mất vài chục giây, đừng thao tác vào Premiere trong lúc chạy.
- **Premiere Pro vẫn có thể tự đóng đột ngột (crash) giữa lúc chạy Mic Check** với các dự án nhiều ảnh (đây là giới hạn của bản thân Premiere khi dồn nhiều lệnh dựng timeline liên tiếp, không phải lỗi cú pháp cues.json). Nếu gặp crash:
  1. Mở lại Premiere — dùng bản Auto-Save/Recovery gần nhất nếu được hỏi.
  2. Mở lại panel Mic Check, **chọn lại đúng thư mục dự án** đó.
  3. Bấm **▶ Chạy Mic Check** lại bình thường — thao tác đặt clip dùng chế độ overwrite nên idempotent (an toàn chạy lại nhiều lần), các ảnh đã đặt đúng vị trí trước đó sẽ chỉ bị ghi đè lại chứ không nhân đôi.
  4. Nên **Save project (Ctrl+S)** thủ công trước khi chạy Mic Check với dự án nhiều ảnh, để có điểm khôi phục gần nhất nếu crash.
- **Thiếu ảnh không chặn cả lần chạy** — cue nào không tìm thấy ảnh khớp tên Player trong thư mục ảnh sẽ bị bỏ qua (không đặt lên timeline), các cue khác vẫn chạy bình thường, danh sách player thiếu ảnh được báo rõ ở cuối log.
- **Video khớp mã**: nếu 1 mã khớp nhiều video, mỗi video vào 1 track V + 1 track audio riêng (V1/A1, V2/A2...) để không đè hình lẫn tiếng. Ảnh nhân vật luôn ở track V ngay sau track video cuối cùng.
- Nút **Verify** tự suy ra file `cues.json` cần đối chiếu dựa theo **tên sequence đang active** trong Premiere — đặt tên sequence khác đi thủ công sau khi tạo sẽ khiến Verify không tìm được đúng file.
