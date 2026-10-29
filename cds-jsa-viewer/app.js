/*
 * Copyright (c) 2026, Huawei Technologies Co., Ltd. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * This code is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2 only, as
 * published by the Free Software Foundation.  Oracle designates this
 * particular file as subject to the "Classpath" exception as provided
 * by Oracle in the LICENSE file that accompanied this code.
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = { report: null, fileName: "", selection: { name: "Header", offset: 0, size: 0 }, contentTab: "RW", jvmReport: null };
  const typeNames = { static: "静态归档", dynamic: "动态归档", "aggressive-dynamic": "Aggressive 动态归档" };
  const colors = { RW: "rw", RO: "ro", BM: "bm", HP: "hp" };

  function formatBytes(value) {
    const n = typeof value === "bigint" ? Number(value) : value;
    if (!Number.isFinite(n)) return "—";
    if (n < 1024) return `${n} B`;
    const units = ["KiB", "MiB", "GiB", "TiB"];
    let v = n / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
  }
  function hex(value, width) {
    const v = typeof value === "bigint" ? value : BigInt(Math.max(0, Math.trunc(value)));
    return `0x${v.toString(16).padStart(width || 2, "0")}`;
  }
  function displayValue(field) {
    if (typeof field.value === "boolean") return field.value ? "true" : "false";
    if (typeof field.value === "bigint") return `${hex(field.value, state.report.pointerSize * 2)} (${formatBytes(field.value)})`;
    if (typeof field.value === "number" && ["magic", "crc"].includes(field.name)) return hex(field.value, 8);
    return String(field.value);
  }
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function renderFileMap() {
    const report = state.report;
    const segments = [{ name: "Header", className: "header", offset: 0, size: report.generic.headerSize }]
      .concat(report.regions.filter(r => Number(r.used) > 0).map(r => ({ name: r.name, className: colors[r.name], offset: Number(r.fileOffset), size: Number(r.used) })));
    const weights = segments.map(s => Math.sqrt(Math.max(1, s.size)));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    $("fileMap").innerHTML = segments.map((s, i) =>
      `<button type="button" class="file-segment ${s.className}" data-segment="${i}" style="flex:${weights[i] / totalWeight}"><strong>${s.name}</strong><small>${formatBytes(s.size)}</small></button>`
    ).join("");
    $("fileMapScale").innerHTML = `<span>0x00000000</span><span>${hex(report.fileSize, 8)}</span>`;
    $("fileMap").querySelectorAll("[data-segment]").forEach(button => button.addEventListener("click", () => selectSegment(segments[Number(button.dataset.segment)])));
  }

  function selectSegment(segment) {
    state.selection = segment;
    document.querySelectorAll(".file-segment").forEach(el => el.classList.toggle("selected", el.textContent.trim().startsWith(segment.name)));
    $("hexTitle").textContent = `${segment.name} 十六进制 · ${hex(segment.offset, 8)}`;
    renderHex();
  }

  function renderRegions() {
    $("regionRows").innerHTML = state.report.regions.map(r => {
      const attrs = [r.readOnly ? "RO" : "RW", r.allowExec ? "EXEC" : "", r.isHeap ? "HEAP" : "", r.isBitmap ? "BITMAP" : ""].filter(Boolean).join(" · ");
      const status = r.crcValid ? `<span class="status ok">✓ ${hex(r.crc, 8)}</span>` : `<span class="status bad">✕ ${hex(r.crc, 8)}</span>`;
      const bitmaps = [r.oopmapSizeBits > 0n ? `oop ${r.oopmapSizeBits} bit` : "", r.ptrmapSizeBits > 0n ? `ptr ${r.ptrmapSizeBits} bit` : ""].filter(Boolean).join(" · ");
      return `<tr data-region="${r.index}"><td><span class="region-name"><i class="region-dot ${colors[r.name]}-color"></i>${r.name}</span><br><small>${r.description}</small></td><td class="mono">${hex(r.fileOffset, 8)}</td><td class="mono">${hex(r.mappingOffset, 8)}</td><td>${formatBytes(r.used)}</td><td>${attrs || "—"}${bitmaps ? `<br><small>${bitmaps}</small>` : ""}</td><td>${status}</td></tr>`;
    }).join("");
    $("regionRows").querySelectorAll("[data-region]").forEach(row => row.addEventListener("click", () => {
      const r = state.report.regions[Number(row.dataset.region)];
      selectSegment({ name: r.name, className: colors[r.name], offset: Number(r.fileOffset), size: Number(r.used) });
      $("hexView").scrollIntoView({ behavior: "smooth", block: "center" });
    }));
  }

  function renderDiagnostics() {
    const icons = { ok: "✓", warn: "!", error: "×" };
    $("diagnostics").innerHTML = state.report.diagnostics.map(d => `<li><span class="${d.level}">${icons[d.level]}</span><span>${escapeHtml(d.message)}</span></li>`).join("");
  }

  function percent(value) {
    return `${(value * 100).toFixed(value < .001 ? 4 : 2)}%`;
  }
  function bitmapChart(map) {
    const max = Math.max(1, ...map.bins);
    return `<div class="bitmap-chart" role="img" aria-label="${escapeHtml(map.name)} 置位密度">${map.bins.map((value, index) => `<i style="height:${Math.max(2, value / max * 100)}%" title="分段 ${index + 1}: ${value} 个置位"></i>`).join("")}</div>`;
  }
  function slotSummary(map) {
    if (!map) return '<p class="empty-state">该位图不存在。</p>';
    return `<article class="bitmap-card"><div class="bitmap-title"><strong>${escapeHtml(map.name)}</strong><span>${map.setCount.toLocaleString()} / ${map.sizeBits.toLocaleString()} bit · ${percent(map.density)}</span></div>${bitmapChart(map)}<dl class="mini-facts"><div><dt>BM 相对偏移</dt><dd class="mono">${hex(map.bmOffset, 8)}</dd></div><div><dt>存储大小</dt><dd>${formatBytes(map.storageBytes)}</dd></div><div><dt>含义</dt><dd>${escapeHtml(map.description)}</dd></div></dl></article>`;
  }
  function jumpToFile(offset, name) {
    const n = typeof offset === "bigint" ? Number(offset) : offset;
    if (!Number.isSafeInteger(n)) return;
    selectSegment({ name: name || "Slot", className: "header", offset: n, size: 128 });
    $("hexView").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function slotTable(slots, columns, emptyMessage) {
    const limit = Number($("contentLimit").value);
    if (!slots.length) return `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
    return `<div class="table-scroll"><table class="slot-table"><thead><tr>${columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join("")}<th>操作</th></tr></thead><tbody>${slots.slice(0, limit).map(slot => `<tr>${columns.map(c => `<td class="${c.mono ? "mono" : ""}">${escapeHtml(c.value(slot))}</td>`).join("")}<td>${slot.fileOffset !== null && slot.fileOffset !== undefined ? `<button type="button" class="slot-jump" data-slot-offset="${String(slot.fileOffset)}">Hex</button>` : "—"}</td></tr>`).join("")}</tbody></table></div><p class="hint">共 ${slots.length.toLocaleString()} 个已采样槽${slots.length > limit ? `，当前显示前 ${limit.toLocaleString()} 个` : ""}。解析器最多保留每个位图前 ${state.report.contents.sampleLimit.toLocaleString()} 个置位槽，同时统计全部置位数。</p>`;
  }
  function bindSlotJumps() {
    $("contentView").querySelectorAll("[data-slot-offset]").forEach(button => button.addEventListener("click", () => jumpToFile(BigInt(button.dataset.slotOffset), "Slot")));
  }
  function renderCoreContent(regionName) {
    const contents = state.report.contents;
    const map = contents.bitmaps.find(item => item.key === "metaspace");
    const slots = contents.corePointerSlots.filter(slot => slot.sourceRegion === regionName);
    const region = state.report.regions.find(item => item.name === regionName);
    $("contentView").innerHTML = `<div class="region-intro"><div><strong>${regionName} · ${escapeHtml(region.description)}</strong><p>${regionName === "RW" ? "运行时可能更新的 HotSpot Metaspace 对象与表结构。" : "只读的 Metadata、Symbol、方法元数据及序列化 CDS 数据。"}</p></div><span>${formatBytes(region.used)}</span></div><div class="content-callout"><strong>可以精确得到什么？</strong> ptrmap 精确标识本区内每个原生指针槽，并能把指针值映射到 RW/RO 目标偏移；但 JSA 没有 Klass、Symbol 等对象的统一边界/类型目录。</div>${slotTable(slots, [
      { label: "bit", mono: true, value: s => String(s.bit) },
      { label: `${regionName} 内偏移`, mono: true, value: s => hex(s.sourceOffset, 8) },
      { label: "文件偏移", mono: true, value: s => hex(s.fileOffset, 8) },
      { label: "原始指针", mono: true, value: s => s.raw === null ? "—" : hex(s.raw, state.report.pointerSize * 2) },
      { label: "目标", mono: true, value: s => s.target.label }
    ], `${regionName} 内没有置位的重定位槽。`)}${map && map.truncated ? `<p class="content-warning">该位图共有 ${map.setCount.toLocaleString()} 个置位，槽明细为前 ${map.sampled.toLocaleString()} 个样本。</p>` : ""}`;
    bindSlotJumps();
  }
  function renderBitmapContent() {
    const maps = state.report.contents.bitmaps;
    $("contentView").innerHTML = `<div class="bitmap-grid">${maps.map(slotSummary).join("")}</div><div class="content-callout"><strong>BM 文件布局</strong><div class="bm-strip">${maps.map(map => `<span class="${map.key}" style="flex:${Math.max(1, map.storageBytes)}"><b>${escapeHtml(map.name)}</b><small>${formatBytes(map.storageBytes)}</small></span>`).join("")}</div><p>三段按机器字对齐后的实际存储大小连续排列；图中的柱表示各段内部置位槽的相对密度。</p></div>`;
  }
  function renderHeapContent() {
    const contents = state.report.contents;
    const oopMap = contents.bitmaps.find(item => item.key === "heap-oop");
    const nativeMap = contents.bitmaps.find(item => item.key === "heap-native");
    const oopTable = slotTable(contents.heapOopSlots, [
      { label: "bit", mono: true, value: s => String(s.bit) },
      { label: "HP 内偏移", mono: true, value: s => hex(s.sourceOffset, 8) },
      { label: "原始 oop", mono: true, value: s => hex(s.raw, contents.oopSlotSize * 2) },
      { label: "解码地址", mono: true, value: s => hex(s.decoded, state.report.pointerSize * 2) },
      { label: "目标", mono: true, value: s => s.target }
    ], "HP oopmap 为空，没有可列出的非空 oop 槽。");
    const nativeTable = slotTable(contents.heapPointerSlots, [
      { label: "bit", mono: true, value: s => String(s.bit) },
      { label: "HP 内偏移", mono: true, value: s => hex(s.sourceOffset, 8) },
      { label: "原始 Klass*", mono: true, value: s => hex(s.raw, state.report.pointerSize * 2) },
      { label: "目标", mono: true, value: s => s.target.label }
    ], "HP ptrmap 为空，没有可列出的 native Klass 指针槽。");
    $("contentView").innerHTML = `<div class="region-intro"><div><strong>HP · 归档 Java Heap 对象</strong><p>oopmap 标识 Java 引用；ptrmap 标识对象头或字段中的原生 Klass 指针。</p></div><span>${formatBytes(state.report.regions[3].used)}</span></div><div class="bitmap-grid compact-grid">${slotSummary(oopMap)}${slotSummary(nativeMap)}</div><div class="subsection"><h3>Java oop 引用槽</h3><p class="hint">槽宽 ${contents.oopSlotSize} B；压缩 oop 按 Header 中 narrow_oop_base / shift 解码。</p>${oopTable}</div><div class="subsection"><h3>Native Klass 指针槽</h3>${nativeTable}</div><div class="content-callout"><strong>对象边界说明</strong> oopmap 描述“哪里有引用”，并不描述“对象从哪里开始”。对象遍历还需要 Klass 布局、压缩 Klass 编码和同版本 VM 类型信息。</div>`;
    bindSlotJumps();
  }
  function renderJvmContent() {
    const report = state.jvmReport;
    if (!report) {
      $("contentView").innerHTML = '<div class="jvm-empty"><strong>Klass / Symbol 需要 JVM 辅助</strong><p>下方导入同版本 JVM 的 PrintSharedArchiveAndExit 输出后，这里会显示共享类清单、ClassLoader 分类、Symbol 与共享 String 数量。JSA 文件本身没有足够的跨构建类型布局信息来安全遍历 Klass/Symbol。</p></div><div class="layout-cards"><article><h3>Symbol（源码布局）</h3><p><code>_hash_and_refcount</code>：4 B；<code>_length</code>：2 B；<code>_body[]</code>：从偏移 6 B 起的 modified UTF-8 字节。对象大小按 <code>Symbol::byte_size(length)</code> 再按 HeapWord 对齐。</p></article><article><h3>Klass（源码布局）</h3><p>包含 Metadata 基类、<code>_name</code> Symbol*、<code>_super</code>、secondary supers、mirror、vtable/access flags 等指针和标量；具体偏移会随 ABI、压缩 Klass、JDK 补丁和编译宏变化。</p></article><article><h3>oop（归档堆）</h3><p>HP 的 oopmap 只标记引用槽，ptrmap 标记 native Klass* 槽；对象起始、数组长度、实际 Klass 仍需 Klass 布局与压缩 oop/klass 编码。</p></article></div>';
      return;
    }
    const limit = Number($("contentLimit").value);
    const query = escapeHtml(report.fileName || "JVM 报告");
    $("contentView").innerHTML = `<div class="jvm-stats"><article><span>共享 Klass</span><strong>${report.classes.length.toLocaleString()}</strong></article><article><span>共享 Symbol</span><strong>${report.symbolCount === null ? "—" : report.symbolCount.toLocaleString()}</strong></article><article><span>共享 String</span><strong>${report.stringCount === null ? "—" : report.stringCount.toLocaleString()}</strong></article><article><span>Archive 状态</span><strong>${report.valid ? "valid" : "未确认"}</strong></article></div><p class="hint">来源：${query}${report.vmVersion ? ` · ${escapeHtml(report.vmVersion)}` : ""}</p>${slotTable(report.classes.map(c => ({ ...c, fileOffset: null })), [
      { label: "序号", mono: true, value: c => String(c.index) },
      { label: "Klass 名称", mono: true, value: c => c.name },
      { label: "ClassLoader", value: c => c.loader },
      { label: "字典", value: c => c.dictionary }
    ], "报告中未识别出共享 Klass 清单。")}<p class="hint">当前上限 ${limit} 项；JVM 输出提供逻辑清单和总量，不提供 Klass/Symbol 在 JSA 中的对象地址。</p>`;
  }
  function renderContent() {
    const contents = state.report.contents;
    $("contentTabs").querySelectorAll("[data-content-tab]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.contentTab === state.contentTab)));
    if (!contents.available && state.contentTab !== "JVM") {
      $("contentView").innerHTML = `<p class="empty-state">区域内容不可用：${escapeHtml(contents.reason || "未知原因")}</p>`;
      return;
    }
    if (state.contentTab === "RW" || state.contentTab === "RO") renderCoreContent(state.contentTab);
    else if (state.contentTab === "BM") renderBitmapContent();
    else if (state.contentTab === "HP") renderHeapContent();
    else renderJvmContent();
  }

  function parseJvmReport(text, fileName) {
    const classes = [];
    let dictionary = "Shared Dictionary";
    for (const line of text.split(/\r?\n/)) {
      const heading = line.trim();
      if (/^Shared (?:Builtin |Unregistered |Lambda )?Dictionary$/.test(heading)) { dictionary = heading; continue; }
      const match = line.match(/^\s*(\d+):\s+(.+?)\s+(boot_loader|platform_loader|app_loader|unregistered_loader(?:\s+.+)?)\s*$/);
      if (match) classes.push({ index: Number(match[1]), name: match[2], loader: match[3], dictionary });
    }
    const number = label => { const match = text.match(new RegExp(`Number of shared ${label}:\\s*(\\d+)`, "i")); return match ? Number(match[1]) : null; };
    const vmMatch = text.match(/^VM version:\s*(.+)$/m);
    return { fileName, classes, symbolCount: number("symbols"), stringCount: number("strings"), vmVersion: vmMatch ? vmMatch[1] : "", valid: /archive is valid/i.test(text) };
  }

  function renderHeader() {
    $("headerRows").innerHTML = state.report.headerFields.map(field => `<tr><td class="mono">${hex(field.offset, 4)}</td><td class="mono">${escapeHtml(field.name)}</td><td class="mono">${escapeHtml(displayValue(field))}</td><td>${escapeHtml(field.description)}</td></tr>`).join("");
    $("abiBadge").textContent = `${state.report.pointerSize * 8}-bit · ${state.report.endian === "little" ? "Little Endian" : "Big Endian"}`;
    $("magicBadge").textContent = `magic ${hex(state.report.generic.magic, 8)}`;
    $("jvmIdent").textContent = state.report.jvmIdent || "未包含 JVM 标识";
  }

  function renderHex() {
    const bytes = state.report.bytes;
    const max = Number($("hexLength").value);
    const start = Math.max(0, state.selection.offset);
    const length = Math.min(max, state.selection.size || max, bytes.length - start);
    const lines = [];
    for (let p = 0; p < length; p += 16) {
      const slice = bytes.subarray(start + p, start + Math.min(length, p + 16));
      const groups = [];
      for (let i = 0; i < 16; i++) groups.push(i < slice.length ? slice[i].toString(16).padStart(2, "0") : "  ");
      const ascii = Array.from(slice, b => b >= 32 && b <= 126 ? String.fromCharCode(b) : ".").join("");
      lines.push(`${(start + p).toString(16).padStart(8, "0")}  ${groups.slice(0, 8).join(" ")}  ${groups.slice(8).join(" ")}  |${ascii.padEnd(16)}|`);
    }
    $("hexView").textContent = lines.join("\n") || "该区域为空";
  }

  function render() {
    const report = state.report;
    $("archiveType").textContent = typeNames[report.generic.archiveType] || report.generic.archiveType;
    $("archiveVersion").textContent = `v${report.generic.version}`;
    $("archiveSize").textContent = formatBytes(report.fileSize);
    $("headerCrc").innerHTML = report.headerCrcValid ? '<span class="status ok">校验通过</span>' : '<span class="status bad">校验失败</span>';
    renderFileMap(); renderRegions(); renderDiagnostics(); renderHeader(); renderContent();
    selectSegment({ name: "Header", className: "header", offset: 0, size: report.generic.headerSize });
    $("dropZone").hidden = true; $("errorPanel").hidden = true; $("report").hidden = false; $("resetButton").hidden = false;
  }

  async function loadFile(file) {
    if (!file) return;
    try {
      state.fileName = file.name;
      state.report = JsaParser.parse(await file.arrayBuffer());
      render();
    } catch (error) {
      $("errorMessage").textContent = error instanceof Error ? error.message : String(error);
      $("errorPanel").hidden = false; $("report").hidden = true; $("resetButton").hidden = false;
    }
  }

  function reset() {
    state.report = null; state.jvmReport = null; state.contentTab = "RW"; $("fileInput").value = ""; $("jvmReportInput").value = ""; $("dropZone").hidden = false; $("errorPanel").hidden = true; $("report").hidden = true; $("resetButton").hidden = true;
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify(JsaParser.jsonSafe(state.report), null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${state.fileName || "archive.jsa"}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 0);
  }

  $("chooseButton").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", e => loadFile(e.target.files[0]));
  $("resetButton").addEventListener("click", reset);
  $("exportButton").addEventListener("click", exportJson);
  $("hexLength").addEventListener("change", renderHex);
  $("contentLimit").addEventListener("change", renderContent);
  $("contentTabs").querySelectorAll("[data-content-tab]").forEach(button => button.addEventListener("click", () => { state.contentTab = button.dataset.contentTab; renderContent(); }));
  $("jvmReportButton").addEventListener("click", () => $("jvmReportInput").click());
  $("jvmReportInput").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    state.jvmReport = parseJvmReport(await file.text(), file.name);
    state.contentTab = "JVM";
    renderContent();
    $("contentView").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  ["dragenter", "dragover"].forEach(type => $("dropZone").addEventListener(type, e => { e.preventDefault(); $("dropZone").classList.add("dragging"); }));
  ["dragleave", "drop"].forEach(type => $("dropZone").addEventListener(type, e => { e.preventDefault(); $("dropZone").classList.remove("dragging"); }));
  $("dropZone").addEventListener("drop", e => loadFile(e.dataTransfer.files[0]));
})();
