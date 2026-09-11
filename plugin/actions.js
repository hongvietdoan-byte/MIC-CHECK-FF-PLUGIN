// actions.js — Premiere Scripting API cho plugin "Mic Check" độc lập.
//
// Tách ra từ dự án Premiere MCP standalone (xem TODO.md/README của dự án gốc) — CHỈ giữ lại các
// hàm cần cho: (1) workflow Mic Check, (2) vài tool timeline chung hữu ích (tạo sequence, đặt clip).
// Bỏ hết ~60 tool không liên quan (color grading, audio ducking, MOGRT, keyframe, captions ExtendScript...).
//
// KHÔNG có kết nối MCP/WS/Claude nào — plugin này gọi thẳng Premiere Scripting API qua UXP, hoạt
// động hoàn toàn độc lập. Yêu cầu Premiere Pro 26.2+ (xem lý do trong README.md — API set frame rate
// chỉ tồn tại từ bản đó trở lên).

const ppro = require("premierepro");
const uxpFs = require("uxp").storage.localFileSystem;
const uxpFormats = require("uxp").storage.formats;

// ----------------------------------------------------------------------------
// Helpers dùng chung
// ----------------------------------------------------------------------------

function secondsToTick(seconds) {
  return ppro.TickTime.createWithSeconds(seconds);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// LƯU Ý: uxpFs.getEntryWithUrl() tự percent-encode URL 1 lần nữa — nếu path đã encode sẵn (vd qua
// encodeURIComponent) sẽ bị double-encode và lỗi "Could not find an entry". Dùng URL RAW (không tự
// encode) để tránh.
async function readTextFile(path) {
  const rawUrl = "file:///" + path.replace(/\\/g, "/");
  const entry = await uxpFs.getEntryWithUrl(rawUrl);
  return await entry.read({ format: uxpFormats.utf8 });
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

// Quét ĐỆ QUY toàn bộ thư mục ảnh (kể cả thư mục con lộn xộn nhiều cấp) 1 lần, dựng map
// "tên file không đuôi (chữ thường)" -> đường dẫn thật. Dùng 1 lần quét chung cho mọi player thay vì
// quét riêng từng player — nhanh hơn nhiều khi có hàng chục cue cùng thư mục ảnh lớn.
async function buildImageIndex(imagesDirPath) {
  const rawUrl = "file:///" + imagesDirPath.replace(/\\/g, "/");
  const rootEntry = await uxpFs.getEntryWithUrl(rawUrl);
  const index = new Map();

  async function walk(folderEntry) {
    let entries;
    try { entries = await folderEntry.getEntries(); } catch { return; }
    for (const entry of entries) {
      if (entry.isFolder) {
        await walk(entry);
        continue;
      }
      if (!entry.isFile) continue;
      const dot = entry.name.lastIndexOf(".");
      if (dot < 0) continue;
      const ext = entry.name.slice(dot).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;
      const base = entry.name.slice(0, dot).toLowerCase();
      if (!index.has(base)) index.set(base, entry.nativePath); // giữ file tìm thấy ĐẦU TIÊN nếu trùng tên khác đuôi
    }
  }

  await walk(rootEntry);
  return index;
}

async function findProjectItemInBin(binItem, name) {
  let items;
  try { items = await binItem.getItems(); } catch { return null; }
  for (const child of (items || [])) {
    let childName = null;
    try { childName = child.name; } catch {}
    if (childName === name) return child;
    try {
      const folder = await ppro.FolderItem.cast(child);
      if (folder) {
        const found = await findProjectItemInBin(folder, name);
        if (found) return found;
      }
    } catch {}
  }
  return null;
}

async function findProjectItemByName(project, name) {
  const rootItem = await project.getRootItem();
  return await findProjectItemInBin(rootItem, name);
}

// Signature = getStartTime().seconds (vị trí thật trên timeline — KHÁC getInPoint()/getOutPoint(),
// đó là source trim, không phải vị trí).
async function collectStartTimeSignatures(track, itemName) {
  const set = new Set();
  if (!track) return set;
  let items;
  try { items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false); } catch { return set; }
  for (const item of items) {
    let projItem;
    try { projItem = await item.getProjectItem(); } catch { continue; }
    let name;
    try { name = projItem && projItem.name; } catch { continue; }
    if (name !== itemName) continue;
    try {
      const start = await item.getStartTime();
      set.add(start.seconds.toFixed(6));
    } catch {}
  }
  return set;
}

async function findNewMatchingTrackItem(track, itemName, beforeSignatures) {
  if (!track) return null;
  let items;
  try { items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false); } catch { return null; }
  for (const item of items) {
    let projItem;
    try { projItem = await item.getProjectItem(); } catch { continue; }
    let name;
    try { name = projItem && projItem.name; } catch { continue; }
    if (name !== itemName) continue;
    let start;
    try { start = await item.getStartTime(); } catch { continue; }
    if (!beforeSignatures.has(start.seconds.toFixed(6))) return item;
  }
  return null;
}

// Fallback khi overwrite đè lên đúng vị trí đã có clip cùng tên/cùng startSeconds từ trước (vd chạy
// lại workflow idempotent) — Premiere có thể merge vào track item CŨ thay vì tạo item mới.
// LƯU Ý: dung sai 0.05s — nếu 2 cue CÙNG itemName nằm cách nhau < 0.05s có thể khớp nhầm (chưa gặp
// trong dữ liệu thật, cue gần nhau nhất đã test là ~0.1s).
async function findExistingItemAtPosition(track, itemName, desiredSeconds) {
  if (!track) return null;
  let items;
  try { items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false); } catch { return null; }
  for (const item of items) {
    let projItem;
    try { projItem = await item.getProjectItem(); } catch { continue; }
    let name;
    try { name = projItem && projItem.name; } catch { continue; }
    if (name !== itemName) continue;
    let start;
    try { start = await item.getStartTime(); } catch { continue; }
    if (Math.abs(start.seconds - desiredSeconds) < 0.05) return item;
  }
  return null;
}

// ----------------------------------------------------------------------------
// Import media
// ----------------------------------------------------------------------------

async function importFilesToProject({ paths, binName }) {
  if (!paths || paths.length === 0) throw new Error("Phải truyền ít nhất 1 đường dẫn file.");
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Không tìm thấy project đang mở.");

  let targetBin = null;
  if (binName) {
    try {
      const rootItem = await project.getRootItem();
      const items = (await rootItem.getItems()) || [];
      for (const child of items) {
        const name = child.name || (await child.getName());
        if (name === binName) { targetBin = child; break; }
      }
    } catch {}
  }

  try {
    const ok = await project.importFiles(paths, true, targetBin, false);
    return {
      imported: paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() })),
      skipped: [],
      binName: binName || "root",
      ok
    };
  } catch (e) {
    throw new Error(`importFiles thất bại: ${e.message}. Kiểm tra đường dẫn file có đúng không.`);
  }
}

// ----------------------------------------------------------------------------
// Đặt clip lên timeline (insert/overwrite) — pattern chèn-tạm-rồi-di-chuyển vì
// SequenceEditor.createInsertProjectItemAction/createOverwriteItemAction bỏ qua tham số vị trí.
// ----------------------------------------------------------------------------

async function insertOrOverwriteClip({ itemName, startSeconds, videoTrackIndex = 0, audioTrackIndex = 0, durationSeconds, mode }, log) {
  if (!itemName) throw new Error("Phải truyền itemName (tên item trong Project panel, kể cả trong bin con).");
  if (startSeconds == null) throw new Error("Phải truyền startSeconds.");

  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Không tìm thấy project đang mở.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("Không có sequence active.");

  const projectItem = await findProjectItemByName(project, itemName);
  if (!projectItem) throw new Error(`Không tìm thấy item "${itemName}" trong Project panel (đã tìm cả trong bin con).`);

  const sequenceEditor = ppro.SequenceEditor.getEditor(sequence);
  if (!sequenceEditor) throw new Error("Không lấy được SequenceEditor cho sequence hiện tại.");

  const videoTrack = await sequence.getVideoTrack(videoTrackIndex).catch(() => null);
  const audioTrack = await sequence.getAudioTrack(audioTrackIndex).catch(() => null);

  const beforeVideoSigs = await collectStartTimeSignatures(videoTrack, itemName);
  const beforeAudioSigs = await collectStartTimeSignatures(audioTrack, itemName);

  const placeholderTick = secondsToTick(startSeconds);

  let placedOk;
  await project.lockedAccess(() => {
    placedOk = project.executeTransaction((compoundAction) => {
      const action = mode === "insert"
        ? sequenceEditor.createInsertProjectItemAction(projectItem, placeholderTick, videoTrackIndex, audioTrackIndex, true)
        : sequenceEditor.createOverwriteItemAction(projectItem, placeholderTick, videoTrackIndex, audioTrackIndex);
      compoundAction.addAction(action);
    }, `${mode === "insert" ? "Insert" : "Overwrite"} "${itemName}" (bước 1/3: đặt tạm)`);
  });
  if (!placedOk) throw new Error("executeTransaction trả về false khi đặt clip lên timeline.");

  let newVideoItem = await findNewMatchingTrackItem(videoTrack, itemName, beforeVideoSigs);
  let newAudioItem = await findNewMatchingTrackItem(audioTrack, itemName, beforeAudioSigs);
  let usedFallback = false;

  if (!newVideoItem && !newAudioItem) {
    newVideoItem = await findExistingItemAtPosition(videoTrack, itemName, startSeconds);
    newAudioItem = await findExistingItemAtPosition(audioTrack, itemName, startSeconds);
    usedFallback = true;
  }
  const movedItems = [newVideoItem, newAudioItem].filter(Boolean);

  if (movedItems.length === 0) {
    throw new Error(
      `Đã đặt "${itemName}" lên timeline nhưng KHÔNG xác định được track item mới để di chuyển về đúng vị trí ` +
      `(startSeconds=${startSeconds}). Clip có thể đang nằm sai chỗ trên timeline — kiểm tra và xoá thủ công nếu cần.`
    );
  }

  if (!usedFallback) {
    const desiredTick = secondsToTick(startSeconds);
    const currentStarts = [];
    for (const item of movedItems) currentStarts.push(await item.getStartTime());
    const offsets = currentStarts.map((cur) => desiredTick.subtract(cur));

    let movedOk;
    await project.lockedAccess(() => {
      movedOk = project.executeTransaction((compoundAction) => {
        movedItems.forEach((item, i) => {
          compoundAction.addAction(item.createMoveAction(offsets[i]));
        });
      }, `${mode === "insert" ? "Insert" : "Overwrite"} "${itemName}" (bước 2/3: di chuyển về đúng vị trí)`);
    });
    if (!movedOk) {
      throw new Error(
        `Đã đặt "${itemName}" lên timeline nhưng createMoveAction trả về false khi di chuyển về startSeconds=${startSeconds}.`
      );
    }
  }

  const finalStart = await movedItems[0].getStartTime();
  const diffSeconds = Math.abs(finalStart.seconds - startSeconds);
  if (diffSeconds > 0.05) {
    throw new Error(
      `Đã di chuyển clip nhưng vị trí cuối cùng (${finalStart.seconds.toFixed(3)}s) không khớp startSeconds ` +
      `yêu cầu (${startSeconds}s, lệch ${diffSeconds.toFixed(3)}s).`
    );
  }

  let durationApplied = null;
  if (durationSeconds != null && durationSeconds > 0) {
    const endTick = secondsToTick(startSeconds + durationSeconds);
    let durOk;
    await project.lockedAccess(() => {
      durOk = project.executeTransaction((compoundAction) => {
        movedItems.forEach((item) => { compoundAction.addAction(item.createSetEndAction(endTick)); });
      }, `${mode === "insert" ? "Insert" : "Overwrite"} "${itemName}" (bước 3/3: set duration)`);
    });
    durationApplied = !!durOk;
    if (durOk) {
      const finalEnd = await movedItems[0].getEndTime();
      const endDiff = Math.abs(finalEnd.seconds - (startSeconds + durationSeconds));
      if (endDiff > 0.05) {
        throw new Error(
          `Đã set duration nhưng end time cuối cùng (${finalEnd.seconds.toFixed(3)}s) không khớp yêu cầu ` +
          `(${(startSeconds + durationSeconds).toFixed(3)}s, lệch ${endDiff.toFixed(3)}s).`
        );
      }
    }
  }

  return {
    itemName,
    mode,
    startSeconds,
    durationSeconds: durationSeconds ?? null,
    durationApplied,
    videoTrackIndex,
    audioTrackIndex,
    movedItemsCount: movedItems.length,
    finalStartSeconds: finalStart.seconds
  };
}

// Đặt nhiều clip trong 1 lệnh — có delay nhỏ giữa mỗi placement để giảm rủi ro crash Premiere khi
// dồn quá nhiều executeTransaction liên tiếp. Premiere đã crash thật nhiều lần trong quá trình phát
// triển kể cả với delay 80ms (crash quan sát được ở khoảng placement 37-38/64) — 150ms giảm tần suất
// nhưng KHÔNG loại bỏ hoàn toàn rủi ro; xem README.md mục "Ghi chú / giới hạn đã biết".
const BATCH_PLACEMENT_DELAY_MS = 150;

async function batchPlaceClips({ placements }, log) {
  if (!Array.isArray(placements) || placements.length === 0) {
    throw new Error("Phải truyền placements là mảng không rỗng.");
  }
  const results = [];
  const failed = [];
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    try {
      const r = await insertOrOverwriteClip({
        itemName: p.itemName,
        startSeconds: p.startSeconds,
        durationSeconds: p.durationSeconds,
        videoTrackIndex: p.videoTrackIndex != null ? p.videoTrackIndex : 0,
        audioTrackIndex: p.audioTrackIndex != null ? p.audioTrackIndex : 0,
        mode: p.mode === "insert" ? "insert" : "overwrite"
      }, log);
      results.push({ index: i, ...r });
      if (log) log(`Placement ${i}: "${p.itemName}" @ ${p.startSeconds}s → OK`);
    } catch (e) {
      const err = String(e && e.message || e);
      failed.push({ index: i, itemName: p.itemName, startSeconds: p.startSeconds, error: err });
      if (log) log(`Placement ${i} LỖI: ${err}`, "warn");
    }
    if (i < placements.length - 1) await sleep(BATCH_PLACEMENT_DELAY_MS);
  }
  return { total: placements.length, placed: results.length, failed };
}

// ----------------------------------------------------------------------------
// Sequence: tạo, chuyển active, xoá, đọc/set frame rate (chỉ hoạt động Premiere Pro 26.2+)
// ----------------------------------------------------------------------------

async function _resolveSequenceByName(project, sequenceName) {
  if (!sequenceName) return await project.getActiveSequence();
  const all = (await project.getSequences()) || [];
  for (const s of all) {
    try { if ((s.name || (await s.getName())) === sequenceName) return s; } catch {}
  }
  throw new Error(`Không tìm thấy sequence "${sequenceName}" trong project.`);
}

// Canonical rational fps — KHÔNG so sánh 59.94/29.97/23.976 bằng float trực tiếp.
const CANONICAL_FPS = {
  23.976: 24000 / 1001,
  29.97: 30000 / 1001,
  59.94: 60000 / 1001
};

async function setSequenceFrameRate({ fps, sequenceName } = {}) {
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) {
    throw new Error(`fps không hợp lệ: ${fps}`);
  }
  const resolvedFps = CANONICAL_FPS[fps] || fps;

  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Không tìm thấy project đang mở.");
  const sequence = await _resolveSequenceByName(project, sequenceName);
  if (!sequence) throw new Error("Không có sequence active và không truyền sequenceName.");

  const settings = await sequence.getSettings();
  if (typeof settings.setVideoFrameRate !== "function") {
    throw new Error("SequenceSettings.setVideoFrameRate không tồn tại — cần Premiere Pro 26.2+.");
  }

  const before = await settings.getVideoFrameRate();
  const beforeFps = before ? before.value : null;

  const frameRate = ppro.FrameRate.createWithValue(resolvedFps);
  settings.setVideoFrameRate(frameRate);

  let ok;
  await project.lockedAccess(() => {
    ok = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(sequence.createSetSettingsAction(settings));
    }, `Set frame rate ${fps}fps`);
  });
  if (!ok) throw new Error("executeTransaction trả về false khi set frame rate.");

  const afterSettings = await sequence.getSettings();
  const after = await afterSettings.getVideoFrameRate();
  const afterFps = after ? after.value : null;
  const success = Math.abs(afterFps - resolvedFps) < 0.001;

  if (!success) {
    throw new Error(
      `Premiere KHÔNG đổi frame rate dù executeTransaction báo OK (no-op thật) — yêu cầu ${fps}fps, ` +
      `before=${beforeFps}fps, after=${afterFps}fps.`
    );
  }

  return { success: true, requestedFps: fps, beforeFps, afterFps };
}

// Tạo sequence trắng rồi set frame rate + frame size thật (có verify read-back). Yêu cầu Premiere
// Pro 26.2+ để đảm bảo đúng fps — nếu bản cũ hơn, sequence vẫn tạo được nhưng timebaseApplied:false.
async function createSequence({ name, timebase = 60, frameWidth, frameHeight }) {
  if (!name) throw new Error("Phải truyền name cho sequence mới.");
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Không tìm thấy project đang mở.");

  const before = await project.getSequences();
  const beforeNames = new Set();
  for (const s of (before || [])) { try { beforeNames.add(s.name || (await s.getName())); } catch {} }

  await project.createSequence(name);

  const afterList = (await project.getSequences()) || [];
  let confirmedName = null;
  let newSeq = null;
  for (const s of afterList) {
    let n = null;
    try { n = s.name || (await s.getName()); } catch {}
    if (n != null && !beforeNames.has(n)) { confirmedName = n; newSeq = s; break; }
  }
  if (confirmedName == null) {
    throw new Error("createSequence() đã chạy nhưng không tìm thấy sequence mới — không xác nhận được tạo thành công.");
  }

  const newSettings = await newSeq.getSettings();
  if (typeof newSettings.setVideoFrameRate !== "function") {
    return {
      created: true,
      name: confirmedName,
      method: "blank_no_api",
      timebase,
      timebaseApplied: false,
      timebaseError: "Premiere Pro bản này < 26.2, không có API setVideoFrameRate. Cần tự chỉnh tay Sequence Settings, hoặc nâng cấp Premiere.",
      frameWidth: frameWidth || null,
      frameHeight: frameHeight || null
    };
  }

  let frameRateResult = null;
  let frameRateError = null;
  if (timebase) {
    try {
      frameRateResult = await setSequenceFrameRate({ fps: timebase, sequenceName: confirmedName });
    } catch (e) {
      frameRateError = String(e && e.message || e);
    }
  }

  let frameSizeApplied = null;
  let frameSizeError = null;
  if (frameWidth && frameHeight) {
    try {
      const s2 = await newSeq.getSettings();
      const rect = await s2.getVideoFrameRect();
      rect.width = frameWidth;
      rect.height = frameHeight;
      s2.setVideoFrameRect(rect);
      let ok2;
      await project.lockedAccess(() => {
        ok2 = project.executeTransaction((compoundAction) => {
          compoundAction.addAction(newSeq.createSetSettingsAction(s2));
        }, `Set frame size ${frameWidth}x${frameHeight}`);
      });
      frameSizeApplied = !!ok2;
    } catch (e) {
      frameSizeApplied = false;
      frameSizeError = String(e && e.message || e);
    }
  }

  return {
    created: true,
    name: confirmedName,
    method: "blank_direct_api",
    timebase,
    timebaseApplied: !!(frameRateResult && frameRateResult.success),
    timebaseError: frameRateError,
    actualFps: frameRateResult ? frameRateResult.afterFps : null,
    frameWidth: frameWidth || null,
    frameHeight: frameHeight || null,
    frameSizeApplied,
    frameSizeError
  };
}

async function setActiveSequenceTool({ name }) {
  if (!name) throw new Error("Phải truyền name của sequence cần chuyển sang active.");
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Không tìm thấy project đang mở.");

  const all = (await project.getSequences()) || [];
  let target = null;
  for (const s of all) {
    try { if ((s.name || (await s.getName())) === name) { target = s; break; } } catch {}
  }
  if (!target) throw new Error(`Không tìm thấy sequence "${name}" trong project.`);

  await project.setActiveSequence(target);

  const confirm = await project.getActiveSequence();
  let confirmName = null;
  try { confirmName = confirm ? (confirm.name || (await confirm.getName())) : null; } catch {}
  if (confirmName !== name) {
    throw new Error(`setActiveSequence() chạy xong nhưng sequence active hiện tại là "${confirmName}", không phải "${name}".`);
  }

  return { activated: true, name };
}

// Dùng cho nút "Verify" trong panel — panel không tự lưu sequence nào ứng với cues.json nào (có thể
// đã tạo nhiều sequence trong 1 lần chạy batch theo mã), nên tự hỏi Premiere sequence nào đang active
// rồi suy ngược ra file cues.json tương ứng theo tên.
async function getActiveSequenceNameTool() {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Không tìm thấy project đang mở.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("Không có sequence active.");
  let name = null;
  try { name = sequence.name || (await sequence.getName()); } catch {}
  if (!name) throw new Error("Không đọc được tên sequence đang active.");
  return name;
}

// ----------------------------------------------------------------------------
// Workflow "Mic Check" — 1 lệnh gộp toàn bộ pipeline. Nhận cues.json đã chuẩn hoá sẵn từ
// scripts/docx_to_mic_check.py (chạy ngoài Premiere, không tự parse docx trong plugin).
// ----------------------------------------------------------------------------

async function runMicCheckWorkflow({
  cuesJsonPath,
  srtPaths = [],     // 0+ file .srt (1 file / cột phụ đề — vd _ID.srt, _EN.srt), khớp theo mã, không bắt buộc
  videoPaths = [],   // 0+ file video khớp theo mã — MỖI video 1 track V riêng (V1, V2, ...), không đè lên nhau
  imagesDir,         // thư mục ảnh nhân vật DÙNG CHUNG — quét ĐỆ QUY tìm ảnh theo tên Player
  sequenceName,
  orientation = "landscape",
  timebase = 60
}, log) {
  if (!cuesJsonPath) throw new Error("Phải truyền cuesJsonPath.");
  if (!sequenceName) throw new Error("Phải truyền sequenceName.");
  if (!imagesDir) throw new Error("Phải truyền imagesDir.");

  const cuesRaw = await readTextFile(cuesJsonPath);
  let cuesData;
  try { cuesData = JSON.parse(cuesRaw); } catch (e) { throw new Error(`Không parse được "${cuesJsonPath}" thành JSON: ${e.message}`); }
  const cues = cuesData.cues;
  if (!Array.isArray(cues) || cues.length === 0) throw new Error(`"${cuesJsonPath}" không có mảng "cues" hợp lệ.`);

  const frameWidth = orientation === "portrait" ? 1080 : 1920;
  const frameHeight = orientation === "portrait" ? 1920 : 1080;

  if (log) log(`Tạo sequence "${sequenceName}" (${frameWidth}x${frameHeight}, ${timebase}fps)...`);
  const seqResult = await createSequence({ name: sequenceName, timebase, frameWidth, frameHeight });
  await setActiveSequenceTool({ name: seqResult.name });

  // Ảnh nhân vật lấy theo tên Player, tìm ĐỆ QUY trong imagesDir (thư mục dùng chung nhiều dự án,
  // không cần nằm cùng chỗ với cues.json/srt/video nữa) — 1 lần quét chung cho toàn bộ cue.
  if (log) log(`Dò thư mục ảnh "${imagesDir}"...`);
  const imageIndex = await buildImageIndex(imagesDir);

  const uniquePlayers = [...new Set(cues.map((c) => c.image).filter(Boolean))];
  const resolvedImagePaths = new Map(); // player (nguyên văn) -> đường dẫn ảnh thật
  const missingPlayers = [];
  for (const player of uniquePlayers) {
    const found = imageIndex.get(player.toLowerCase());
    if (found) resolvedImagePaths.set(player, found);
    else missingPlayers.push(player);
  }
  if (missingPlayers.length > 0 && log) {
    log(`⚠️ Không tìm thấy ảnh cho ${missingPlayers.length} player: ${missingPlayers.join(", ")} — các cue này sẽ bị bỏ qua.`);
  }

  const allPaths = [
    ...videoPaths,
    ...srtPaths,
    ...[...resolvedImagePaths.values()]
  ];
  if (log) log(`Import ${allPaths.length} file media...`);
  const importResult = await importFilesToProject({ paths: allPaths });

  // Mỗi video khớp mã đi lên 1 track riêng (V1, V2, ...) để không đè/trồng chéo nếu 1 mã khớp nhiều
  // video (vd nhiều góc quay). Ảnh nhân vật luôn đặt ở track NGAY SAU toàn bộ video đã đặt.
  const videoResults = [];
  for (let i = 0; i < videoPaths.length; i++) {
    const vName = videoPaths[i].split(/[\\/]/).pop();
    if (log) log(`Đặt video "${vName}" vào track V${i + 1}...`);
    try {
      const r = await insertOrOverwriteClip({
        itemName: vName,
        startSeconds: 0,
        videoTrackIndex: i,
        audioTrackIndex: i, // mỗi video 1 track audio riêng luôn, tránh chồng tiếng nếu nhiều video có audio
        mode: "overwrite"
      }, log);
      videoResults.push({ path: videoPaths[i], name: vName, track: i, ...r });
    } catch (e) {
      videoResults.push({ path: videoPaths[i], name: vName, track: i, error: String(e && e.message || e) });
    }
  }
  const imageVideoTrackIndex = videoPaths.length; // track kế tiếp sau hết video

  const placements = cues
    .filter((c) => c.image && resolvedImagePaths.has(c.image))
    .map((c) => ({
      // itemName PHẢI là tên file THẬT (có đuôi, vd "FL.ABCD.png") vì đó là tên project item trong
      // Premiere — c.image chỉ là tên Player thô (không đuôi), không dùng trực tiếp để tìm item được.
      itemName: resolvedImagePaths.get(c.image).split(/[\\/]/).pop(),
      startSeconds: c.start,
      durationSeconds: c.end - c.start,
      videoTrackIndex: imageVideoTrackIndex,
      mode: "overwrite"
    }));
  if (log) log(`Đặt ${placements.length} ảnh theo cues (track V${imageVideoTrackIndex + 1})...`);
  // batchPlaceClips() ném lỗi nếu placements rỗng — hoàn toàn có thể rỗng nếu TOÀN BỘ player của
  // cues.json này đều thiếu ảnh (vd chọn nhầm/chưa có ảnh trong thư mục ảnh dùng chung), không nên
  // để lỗi đó làm gãy cả lần chạy, chỉ cần báo rõ 0 ảnh đặt được qua missingPlayers.
  const placeResult = placements.length > 0
    ? await batchPlaceClips({ placements }, log)
    : { total: 0, placed: 0, failed: [] };
  placeResult.missingPlayers = missingPlayers;

  return {
    sequenceName: seqResult.name,
    timebaseApplied: seqResult.timebaseApplied,
    actualFps: seqResult.actualFps,
    importedFiles: importResult.imported.length,
    videos: videoResults,
    imageVideoTrackIndex,
    images: placeResult,
    totalCues: cues.length,
    srtImported: srtPaths.length,
    nextStep: srtPaths.length > 0
      ? `${srtPaths.length} file SRT đã được import vào Project panel. Kéo từng file từ Project panel vào ` +
        "1 caption track riêng trên timeline (đảm bảo không còn caption track cũ nào trước đó, nếu không " +
        "Premiere có thể giữ track cũ thay vì dùng SRT mới) — bước duy nhất chưa tự động hoá được, giới hạn " +
        "thật của Premiere UXP."
      : "Không có file SRT nào được truyền vào — nếu có caption, hãy tự import + kéo file SRT vào 1 " +
        "caption track trên timeline."
  };
}

// Đối chiếu lại timeline (sequence đang active) với cues.json. Chỉ verify được clip ảnh trên video
// track (name/start/end) — KHÔNG verify được nội dung text caption (CaptionTrackItem không có API
// đọc text), chỉ đếm được số lượng item.
async function verifyMicCheckWorkflow({ cuesJsonPath, imageVideoTrackIndex = 0, imagesDir }) {
  if (!cuesJsonPath) throw new Error("Phải truyền cuesJsonPath.");
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Không tìm thấy project đang mở.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("Không có sequence active.");

  const cuesRaw = await readTextFile(cuesJsonPath);
  let cuesData;
  try { cuesData = JSON.parse(cuesRaw); } catch (e) { throw new Error(`Không parse được "${cuesJsonPath}": ${e.message}`); }
  const allCues = cuesData.cues || [];

  // Nếu có truyền imagesDir, dò lại đúng bộ ảnh THẬT SỰ tìm thấy (giống lúc chạy Mic Check) — cue
  // nào thiếu ảnh lúc chạy sẽ bị bỏ qua khi đặt, nên cũng phải bỏ qua khi verify để không báo nhầm
  // "thiếu clip trên timeline".
  let imageCues = allCues.filter((c) => c.image);
  if (imagesDir) {
    const imageIndex = await buildImageIndex(imagesDir);
    imageCues = imageCues.filter((c) => imageIndex.has(c.image.toLowerCase()));
  }

  const track = await sequence.getVideoTrack(imageVideoTrackIndex);
  const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  const actual = [];
  for (const it of items) {
    const e = {};
    try { e.name = await it.getName(); } catch {}
    try { e.start = (await it.getStartTime()).seconds; } catch {}
    try { e.end = (await it.getEndTime()).seconds; } catch {}
    actual.push(e);
  }

  const mismatches = [];
  const count = Math.max(imageCues.length, actual.length);
  for (let i = 0; i < count; i++) {
    const expected = imageCues[i];
    const real = actual[i];
    if (!expected) {
      mismatches.push({ index: i, issue: "Clip thừa trên timeline, không có cue tương ứng", actual: real });
      continue;
    }
    if (!real) {
      mismatches.push({ index: i, issue: "Thiếu clip trên timeline", expected });
      continue;
    }
    // expected.image là tên Player thô (không đuôi file), real.name là tên project item THẬT (có
    // đuôi, vd "FL.ABCD.png") — so sánh kiểu "bắt đầu bằng", không so bằng tuyệt đối.
    const nameOk = real.name && real.name.toLowerCase().startsWith(expected.image.toLowerCase());
    const startOk = Math.abs(real.start - expected.start) < 0.05;
    const endOk = Math.abs(real.end - expected.end) < 0.05;
    if (!nameOk || !startOk || !endOk) {
      mismatches.push({ index: i, issue: "Lệch dữ liệu", expected, actual: real, nameOk, startOk, endOk });
    }
  }

  let captionTrackCount = 0;
  let captionItemCount = 0;
  try {
    captionTrackCount = await sequence.getCaptionTrackCount();
    if (captionTrackCount > 0) {
      const ct = await sequence.getCaptionTrack(0);
      const citems = await ct.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
      captionItemCount = citems.length;
    }
  } catch {}
  const captionCuesExpected = allCues.filter((c) => c.texts && Object.values(c.texts).some((t) => t)).length;

  return {
    imageCuesExpected: imageCues.length,
    imageClipsFound: actual.length,
    mismatches,
    allImagesOk: mismatches.length === 0,
    captionTrackCount,
    captionItemCount,
    captionCuesExpected,
    captionCountMatches: captionTrackCount > 0 && captionItemCount === captionCuesExpected,
    captionNote: captionTrackCount === 0
      ? "Chưa có caption track nào — cần kéo tay file SRT vào timeline."
      : "Chỉ verify được SỐ LƯỢNG caption item, không verify được nội dung text (giới hạn UXP API)."
  };
}
