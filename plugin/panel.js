// panel.js — UI logic cho plugin "Mic Check" độc lập. Gọi trực tiếp các hàm trong actions.js
// (global, cùng script scope) — không có WS/MCP/Claude nào ở đây.

(function () {
  const uxpFsPanel = require("uxp").storage.localFileSystem;
  const VIDEO_EXT = [".mp4", ".mov", ".mxf", ".avi"];

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
  // Collapsible "Tool chung"
  // --------------------------------------------------------------------------
  $("toolsToggle").addEventListener("click", () => {
    const section = $("toolsSection");
    section.classList.toggle("collapsed");
    $("toolsToggle").querySelector(".arrow").textContent = section.classList.contains("collapsed") ? "▸" : "▾";
  });

  // --------------------------------------------------------------------------
  // Mic Check
  // --------------------------------------------------------------------------
  let mcState = {
    folderPath: null,
    cuesCandidates: [],
    videoCandidates: [],
    selectedCuesPath: null,
    selectedVideoPath: null
  };

  function updateMcRunEnabled() {
    const canRun = !!(mcState.selectedCuesPath && mcState.folderPath && $("mcSequenceName").value.trim());
    $("mcRunBtn").disabled = !canRun;
    $("mcVerifyBtn").disabled = !mcState.selectedCuesPath;
  }

  function baseName(nativePath) {
    return nativePath.split(/[\\/]/).pop();
  }

  function suggestSequenceName(cuesFileName) {
    return cuesFileName.replace(/\.cues\.json$/i, "").replace(/[_-]+/g, " ").trim();
  }

  async function scanFolder(folderEntry) {
    const entries = await folderEntry.getEntries();
    const cuesCandidates = [];
    const videoCandidates = [];
    for (const e of entries) {
      if (!e.isFile) continue;
      const name = e.name;
      if (/\.cues\.json$/i.test(name)) {
        cuesCandidates.push({ name, nativePath: e.nativePath });
      } else if (VIDEO_EXT.some((ext) => name.toLowerCase().endsWith(ext))) {
        videoCandidates.push({ name, nativePath: e.nativePath });
      }
    }
    return { cuesCandidates, videoCandidates };
  }

  function renderDetected() {
    const el = $("mcDetected");
    const rows = [];

    if (mcState.cuesCandidates.length === 0) {
      rows.push(`<div class="detected-row"><span class="detected-icon err">✕</span>
        <span>Không thấy file *.cues.json — chạy scripts/docx_to_mic_check.py trước (hoặc kéo file .docx vào Chuyen_Doi_Mic_Check.bat).</span></div>`);
    } else if (mcState.cuesCandidates.length === 1) {
      rows.push(`<div class="detected-row"><span class="detected-icon ok">✓</span>
        <span>cues.json: ${mcState.cuesCandidates[0].name}</span></div>`);
    } else {
      rows.push(`<div class="detected-row"><span class="detected-icon warn">?</span>
        <span>${mcState.cuesCandidates.length} file cues.json — chọn 1:</span></div>
        <div class="detected-row"><select id="mcCuesSelect" style="flex:1">
          ${mcState.cuesCandidates.map((c, i) => `<option value="${i}">${c.name}</option>`).join("")}
        </select></div>`);
    }

    if (mcState.videoCandidates.length === 0) {
      rows.push(`<div class="detected-row"><span class="detected-icon warn">–</span>
        <span>Không thấy video nền (tuỳ chọn).</span></div>`);
    } else if (mcState.videoCandidates.length === 1) {
      rows.push(`<div class="detected-row"><span class="detected-icon ok">✓</span>
        <span>Video nền: ${mcState.videoCandidates[0].name}</span></div>`);
    } else {
      rows.push(`<div class="detected-row"><span class="detected-icon warn">?</span>
        <span>${mcState.videoCandidates.length} video — chọn 1 (hoặc để trống):</span></div>
        <div class="detected-row"><select id="mcVideoSelect" style="flex:1">
          <option value="-1">(không dùng video nền)</option>
          ${mcState.videoCandidates.map((c, i) => `<option value="${i}">${c.name}</option>`).join("")}
        </select></div>`);
    }

    el.innerHTML = rows.join("");

    const cuesSelect = $("mcCuesSelect");
    if (cuesSelect) {
      cuesSelect.addEventListener("change", () => {
        mcState.selectedCuesPath = mcState.cuesCandidates[+cuesSelect.value].nativePath;
        updateMcRunEnabled();
      });
    }
    const videoSelect = $("mcVideoSelect");
    if (videoSelect) {
      videoSelect.addEventListener("change", () => {
        const idx = +videoSelect.value;
        mcState.selectedVideoPath = idx >= 0 ? mcState.videoCandidates[idx].nativePath : null;
      });
    }
  }

  $("mcPickFolder").addEventListener("click", async () => {
    let folderEntry;
    try {
      folderEntry = await uxpFsPanel.getFolder();
    } catch (e) {
      logLine(`Lỗi chọn thư mục: ${e.message}`);
      return;
    }
    if (!folderEntry) return;

    mcState.folderPath = folderEntry.nativePath;
    $("mcFolderPath").textContent = shortenPath(mcState.folderPath);
    $("mcFolderPath").title = mcState.folderPath;
    logLine(`Đã chọn thư mục: ${mcState.folderPath}`);

    const { cuesCandidates, videoCandidates } = await scanFolder(folderEntry);
    mcState.cuesCandidates = cuesCandidates;
    mcState.videoCandidates = videoCandidates;
    mcState.selectedCuesPath = cuesCandidates.length === 1 ? cuesCandidates[0].nativePath : null;
    mcState.selectedVideoPath = videoCandidates.length === 1 ? videoCandidates[0].nativePath : null;

    logLine(`Dò được: ${cuesCandidates.length} cues.json, ${videoCandidates.length} video.`);
    renderDetected();

    if (mcState.selectedCuesPath && !$("mcSequenceName").value.trim()) {
      $("mcSequenceName").value = suggestSequenceName(baseName(mcState.selectedCuesPath));
    }
    updateMcRunEnabled();
  });

  $("mcSequenceName").addEventListener("input", updateMcRunEnabled);

  $("mcRunBtn").addEventListener("click", async () => {
    $("mcRunBtn").disabled = true;
    $("mcVerifyBtn").disabled = true;
    const sequenceName = $("mcSequenceName").value.trim();
    const orientation = $("mcOrientation").value;
    logLine(`▶ Bắt đầu Mic Check: "${sequenceName}" (${orientation})...`);
    try {
      const result = await runMicCheckWorkflow({
        cuesJsonPath: mcState.selectedCuesPath,
        backgroundVideoPath: mcState.selectedVideoPath || undefined,
        imagesDir: mcState.folderPath,
        sequenceName,
        orientation
      }, (msg) => logLine(msg));

      logLine(`✅ Xong. Sequence "${result.sequenceName}" (${result.actualFps}fps).`);
      logLine(`   Ảnh: ${result.images.placed}/${result.images.total} đặt thành công.`);
      if (result.images.failed.length > 0) {
        logLine(`   ⚠️ ${result.images.failed.length} ảnh lỗi:`);
        for (const f of result.images.failed) logLine(`     - index ${f.index} "${f.itemName}": ${f.error}`);
      }
      logLine(`   ${result.nextStep}`);
    } catch (e) {
      logLine(`❌ Lỗi: ${e.message}`);
    } finally {
      updateMcRunEnabled();
    }
  });

  $("mcVerifyBtn").addEventListener("click", async () => {
    $("mcVerifyBtn").disabled = true;
    logLine("🔍 Đang verify timeline so với cues.json...");
    try {
      const result = await verifyMicCheckWorkflow({ cuesJsonPath: mcState.selectedCuesPath });
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
      updateMcRunEnabled();
    }
  });

  // --------------------------------------------------------------------------
  // Tool chung
  // --------------------------------------------------------------------------
  $("tCreateBtn").addEventListener("click", async () => {
    const name = $("tCreateName").value.trim();
    if (!name) { logLine("❌ Cần nhập tên sequence."); return; }
    const orientation = $("tCreateOrientation").value;
    const fps = parseFloat($("tCreateFps").value) || 60;
    const frameWidth = orientation === "portrait" ? 1080 : 1920;
    const frameHeight = orientation === "portrait" ? 1920 : 1080;
    logLine(`Đang tạo sequence "${name}"...`);
    try {
      const r = await createSequence({ name, timebase: fps, frameWidth, frameHeight });
      if (r.timebaseApplied) {
        logLine(`✅ Tạo xong "${r.name}" — ${r.actualFps}fps, ${frameWidth}x${frameHeight}.`);
      } else {
        logLine(`⚠️ Tạo xong "${r.name}" nhưng KHÔNG set được fps: ${r.timebaseError}`);
      }
    } catch (e) {
      logLine(`❌ Lỗi tạo sequence: ${e.message}`);
    }
  });

  $("tClipBtn").addEventListener("click", async () => {
    const itemName = $("tClipName").value.trim();
    if (!itemName) { logLine("❌ Cần nhập tên item."); return; }
    const startSeconds = parseFloat($("tClipStart").value) || 0;
    const durationRaw = $("tClipDuration").value.trim();
    const durationSeconds = durationRaw ? parseFloat(durationRaw) : undefined;
    const videoTrackIndex = parseInt($("tClipTrack").value, 10) || 0;
    const mode = $("tClipMode").value;
    logLine(`Đang đặt "${itemName}" @ ${startSeconds}s (track ${videoTrackIndex}, ${mode})...`);
    try {
      const r = await insertOrOverwriteClip({ itemName, startSeconds, durationSeconds, videoTrackIndex, mode });
      logLine(`✅ Đặt xong tại ${r.finalStartSeconds.toFixed(3)}s${r.durationApplied ? `, dài ${r.durationSeconds}s` : ""}.`);
    } catch (e) {
      logLine(`❌ Lỗi đặt clip: ${e.message}`);
    }
  });

  $("tDeleteBtn").addEventListener("click", async () => {
    const name = $("tDeleteName").value.trim();
    if (!name) { logLine("❌ Cần nhập tên sequence."); return; }
    logLine(`Đang xoá sequence "${name}"...`);
    try {
      await deleteSequenceTool({ name });
      logLine(`✅ Đã xoá "${name}".`);
    } catch (e) {
      logLine(`❌ Lỗi xoá sequence: ${e.message}`);
    }
  });

  updateMcRunEnabled();
})();
