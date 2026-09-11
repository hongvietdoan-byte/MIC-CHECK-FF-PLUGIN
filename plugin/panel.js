// panel.js — UI logic cho plugin "Mic Check" độc lập. Gọi trực tiếp các hàm trong actions.js
// (global, cùng script scope) — không có WS/MCP/Claude nào ở đây.

(function () {
  const uxpFsPanel = require("uxp").storage.localFileSystem;
  const VIDEO_EXT = [".mp4", ".mov", ".mxf", ".avi"];
  const IMAGES_DIR_STORAGE_KEY = "micCheckImagesDir";

  function $(id) { return document.getElementById(id); }

  function logLine(msg) {
    const el = $("log");
    const time = new Date().toLocaleTimeString();
    el.textContent += `[${time}] ${msg}\n`;
    el.scrollTop = el.scrollHeight;
  }

  function shortenPath(p) {
    if (!p) return "(chưa chọn)";
    const parts = p.split(/[\\/]/);
    return parts.length > 2 ? "…\\" + parts.slice(-2).join("\\") : p;
  }

  $("pluginStatus").textContent = "🟢";

  // --------------------------------------------------------------------------
  // Mic Check
  // --------------------------------------------------------------------------
  let mcState = {
    imagesDirPath: null,
    dataDirPath: null,
    cuesCandidates: [],  // {name, nativePath}
    srtCandidates: [],
    videoCandidates: []
  };

  // Thư mục ảnh dùng chung nhiều dự án — nhớ lại lần chọn gần nhất để khỏi phải chọn lại mỗi lần.
  try {
    const saved = localStorage.getItem(IMAGES_DIR_STORAGE_KEY);
    if (saved) {
      mcState.imagesDirPath = saved;
      $("mcImagesPath").textContent = shortenPath(saved);
      $("mcImagesPath").title = saved;
    }
  } catch {}

  function updateButtonsEnabled() {
    const canRun = !!(mcState.imagesDirPath && mcState.dataDirPath && mcState.cuesCandidates.length > 0);
    $("mcRunBtn").disabled = !canRun;
    $("mcVerifyBtn").disabled = !(mcState.imagesDirPath && mcState.dataDirPath && mcState.cuesCandidates.length > 0);
  }

  $("mcPickImages").addEventListener("click", async () => {
    let folderEntry;
    try {
      folderEntry = await uxpFsPanel.getFolder();
    } catch (e) {
      logLine(`Lỗi chọn thư mục ảnh: ${e.message}`);
      return;
    }
    if (!folderEntry) return;
    mcState.imagesDirPath = folderEntry.nativePath;
    $("mcImagesPath").textContent = shortenPath(mcState.imagesDirPath);
    $("mcImagesPath").title = mcState.imagesDirPath;
    try { localStorage.setItem(IMAGES_DIR_STORAGE_KEY, mcState.imagesDirPath); } catch {}
    logLine(`Đã chọn thư mục ảnh (dùng chung): ${mcState.imagesDirPath}`);
    updateButtonsEnabled();
  });

  async function scanDataFolder(folderEntry) {
    const entries = await folderEntry.getEntries();
    const cuesCandidates = [];
    const srtCandidates = [];
    const videoCandidates = [];
    for (const e of entries) {
      if (!e.isFile) continue;
      const name = e.name;
      if (/\.cues\.json$/i.test(name)) {
        cuesCandidates.push({ name, nativePath: e.nativePath });
      } else if (name.toLowerCase().endsWith(".srt")) {
        srtCandidates.push({ name, nativePath: e.nativePath });
      } else if (VIDEO_EXT.some((ext) => name.toLowerCase().endsWith(ext))) {
        videoCandidates.push({ name, nativePath: e.nativePath });
      }
    }
    return { cuesCandidates, srtCandidates, videoCandidates };
  }

  function renderDetected() {
    const el = $("mcDetected");
    const rows = [];
    const c = mcState.cuesCandidates.length;
    const s = mcState.srtCandidates.length;
    const v = mcState.videoCandidates.length;
    rows.push(`<div class="detected-row"><span class="detected-icon ${c ? "ok" : "err"}">${c ? "✓" : "✕"}</span>
      <span>${c} file cues.json, ${s} file .srt, ${v} file video trong thư mục.</span></div>`);
    if (c > 1) {
      const shown = mcState.cuesCandidates.slice(0, 15).map((f) => "• " + f.name.replace(/\.cues\.json$/i, ""));
      const more = c > 15 ? `<br>... và ${c - 15} file khác` : "";
      rows.push(`<div class="detected-row" style="align-items:flex-start"><span class="detected-icon warn">?</span>
        <span style="white-space:normal">Nhiều file — nhập Mã để chọn đúng:<br>${shown.join("<br>")}${more}</span></div>`);
    }
    el.innerHTML = rows.join("");
  }

  $("mcPickFolder").addEventListener("click", async () => {
    let folderEntry;
    try {
      folderEntry = await uxpFsPanel.getFolder();
    } catch (e) {
      logLine(`Lỗi chọn thư mục dữ liệu: ${e.message}`);
      return;
    }
    if (!folderEntry) return;

    mcState.dataDirPath = folderEntry.nativePath;
    $("mcFolderPath").textContent = shortenPath(mcState.dataDirPath);
    $("mcFolderPath").title = mcState.dataDirPath;
    logLine(`Đã chọn thư mục dữ liệu: ${mcState.dataDirPath}`);

    const { cuesCandidates, srtCandidates, videoCandidates } = await scanDataFolder(folderEntry);
    mcState.cuesCandidates = cuesCandidates;
    mcState.srtCandidates = srtCandidates;
    mcState.videoCandidates = videoCandidates;

    logLine(`Dò được: ${cuesCandidates.length} cues.json, ${srtCandidates.length} srt, ${videoCandidates.length} video.`);
    renderDetected();
    updateButtonsEnabled();
  });

  function findByCode(list, code) {
    const lower = code.toLowerCase();
    return list.filter((f) => f.name.toLowerCase().includes(lower));
  }

  function findSrtForStem(stem) {
    // SRT sinh ra CÙNG LÚC với cues.json từ cùng 1 file nguồn nên luôn có tiền tố "<stem>_"
    // (vd "VNFLD3G2__Week_2_EN.srt" cho stem "VNFLD3G2__Week_2").
    const prefix = (stem + "_").toLowerCase();
    return mcState.srtCandidates.filter((f) => f.name.toLowerCase().startsWith(prefix));
  }

  // ------------------------------------------------------------------------
  // Chạy Mic Check — theo Mã (1 hoặc nhiều, cách nhau ";"), mỗi file cues.json khớp mã tạo 1
  // sequence riêng. Nếu bỏ trống ô Mã: chạy thẳng nếu thư mục chỉ có đúng 1 file cues.json.
  // ------------------------------------------------------------------------
  $("mcRunBtn").addEventListener("click", async () => {
    $("mcRunBtn").disabled = true;
    $("mcVerifyBtn").disabled = true;
    const orientation = $("mcOrientation").value;
    const codesRaw = $("mcCodes").value.trim();
    const codes = codesRaw ? codesRaw.split(";").map((c) => c.trim()).filter(Boolean) : [];

    const runs = []; // { cuesFile, code }
    const notFoundCodes = [];

    if (codes.length > 0) {
      for (const code of codes) {
        const matches = findByCode(mcState.cuesCandidates, code);
        if (matches.length === 0) { notFoundCodes.push(code); continue; }
        for (const m of matches) runs.push({ cuesFile: m, code });
      }
      if (runs.length === 0) {
        logLine(`❌ Không tìm thấy file cues.json nào khớp mã: ${notFoundCodes.join(", ")}`);
        updateButtonsEnabled();
        return;
      }
    } else if (mcState.cuesCandidates.length === 1) {
      runs.push({ cuesFile: mcState.cuesCandidates[0], code: null });
    } else if (mcState.cuesCandidates.length === 0) {
      logLine("❌ Không có file cues.json nào trong thư mục dữ liệu.");
      updateButtonsEnabled();
      return;
    } else {
      logLine(`❌ Có ${mcState.cuesCandidates.length} file cues.json trong thư mục — nhập Mã để chọn đúng file (cách nhau bằng ";" nếu chạy nhiều).`);
      updateButtonsEnabled();
      return;
    }

    logLine(`▶ Sẽ chạy ${runs.length} sequence: ${runs.map((r) => r.cuesFile.name).join(", ")}`);
    if (notFoundCodes.length > 0) logLine(`⚠️ Không tìm thấy file khớp các mã: ${notFoundCodes.join(", ")}`);

    let successCount = 0;
    for (const run of runs) {
      const stem = run.cuesFile.name.replace(/\.cues\.json$/i, "");
      const sequenceName = run.code || stem;
      logLine(`\n=== ${sequenceName} (${run.cuesFile.name}) ===`);
      try {
        const srtFiles = findSrtForStem(stem).map((f) => f.nativePath);
        const videoFiles = (run.code ? findByCode(mcState.videoCandidates, run.code) : []).map((f) => f.nativePath);
        if (srtFiles.length > 0) logLine(`  SRT khớp: ${srtFiles.length} file.`);
        if (videoFiles.length > 0) logLine(`  Video khớp: ${videoFiles.length} file (mỗi file 1 track V riêng).`);

        const result = await runMicCheckWorkflow({
          cuesJsonPath: run.cuesFile.nativePath,
          srtPaths: srtFiles,
          videoPaths: videoFiles,
          imagesDir: mcState.imagesDirPath,
          sequenceName,
          orientation
        }, (msg) => logLine("  " + msg));

        logLine(`  ✅ "${result.sequenceName}" (${result.actualFps}fps) — ảnh: ${result.images.placed}/${result.totalCues}.`);
        if (result.images.missingPlayers && result.images.missingPlayers.length > 0) {
          logLine(`  ⚠️ Không tìm thấy ảnh cho: ${result.images.missingPlayers.join(", ")}`);
        }
        if (result.images.failed && result.images.failed.length > 0) {
          logLine(`  ⚠️ ${result.images.failed.length} ảnh đặt lỗi vị trí.`);
        }
        logLine(`  ${result.nextStep}`);
        successCount++;
      } catch (e) {
        logLine(`  ❌ Lỗi: ${e.message}`);
      }
    }

    logLine(`\n== Tổng kết: ${successCount}/${runs.length} sequence tạo thành công. ==`);
    if (notFoundCodes.length > 0) logLine(`Mã không tìm thấy file: ${notFoundCodes.join(", ")}`);

    updateButtonsEnabled();
  });

  // ------------------------------------------------------------------------
  // Verify — luôn đối chiếu SEQUENCE ĐANG ACTIVE trong Premiere, tự suy ra đúng file cues.json theo
  // tên sequence (vì 1 lần chạy có thể tạo nhiều sequence theo nhiều mã).
  // ------------------------------------------------------------------------
  $("mcVerifyBtn").addEventListener("click", async () => {
    $("mcVerifyBtn").disabled = true;
    logLine("🔍 Đang verify sequence đang active...");
    try {
      const activeName = await getActiveSequenceNameTool();
      let match = mcState.cuesCandidates.find(
        (f) => f.name.replace(/\.cues\.json$/i, "").toLowerCase() === activeName.toLowerCase()
      );
      if (!match) {
        match = mcState.cuesCandidates.find((f) => f.name.toLowerCase().includes(activeName.toLowerCase()));
      }
      if (!match) {
        logLine(`❌ Không tìm được file cues.json khớp với sequence đang active ("${activeName}"). Kiểm tra lại đã chọn đúng thư mục dữ liệu chưa.`);
        return;
      }
      logLine(`Đối chiếu sequence "${activeName}" với: ${match.name}`);

      // Suy lại số video đã dùng lúc chạy (cùng logic khớp mã) để biết đúng track ảnh nằm ở đâu.
      const videoCount = findByCode(mcState.videoCandidates, activeName).length;

      const result = await verifyMicCheckWorkflow({
        cuesJsonPath: match.nativePath,
        imagesDir: mcState.imagesDirPath,
        imageVideoTrackIndex: videoCount
      });
      logLine(`Ảnh: mong đợi ${result.imageCuesExpected}, tìm thấy ${result.imageClipsFound} trên timeline.`);
      if (result.allImagesOk) {
        logLine("✅ Tất cả ảnh khớp đúng vị trí + thời lượng.");
      } else {
        logLine(`⚠️ ${result.mismatches.length} chỗ lệch:`);
        for (const m of result.mismatches.slice(0, 10)) logLine(`   - index ${m.index}: ${m.issue}`);
        if (result.mismatches.length > 10) logLine(`   ...và ${result.mismatches.length - 10} chỗ khác.`);
      }
      logLine(`Caption: track=${result.captionTrackCount}, item=${result.captionItemCount}/${result.captionCuesExpected}. ${result.captionNote}`);
    } catch (e) {
      logLine(`❌ Lỗi verify: ${e.message}`);
    } finally {
      updateButtonsEnabled();
    }
  });

  updateButtonsEnabled();
})();
