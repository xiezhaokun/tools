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
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JsaParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAGIC = {
    0xf00baba2: "static",
    0xf00baba4: "aggressive-dynamic",
    0xf00baba8: "dynamic"
  };
  const REGION_NAMES = ["RW", "RO", "BM", "HP"];
  const REGION_DESCRIPTIONS = [
    "可读写共享 Metaspace",
    "只读共享 Metaspace",
    "指针重定位位图",
    "归档 Java Heap 对象"
  ];

  function crcTable() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  }
  const CRC_TABLE = crcTable();

  function crc32(bytes, start, length) {
    let crc = 0xffffffff;
    const end = Math.min(bytes.length, start + length);
    for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  class Reader {
    constructor(bytes, littleEndian, pointerSize) {
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.le = littleEndian;
      this.pointerSize = pointerSize;
    }
    check(offset, size) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > this.bytes.length) {
        throw new Error(`读取越界：offset=0x${offset.toString(16)}, size=${size}`);
      }
    }
    u8(offset) { this.check(offset, 1); return this.view.getUint8(offset); }
    i16(offset) { this.check(offset, 2); return this.view.getInt16(offset, this.le); }
    u32(offset) { this.check(offset, 4); return this.view.getUint32(offset, this.le); }
    i32(offset) { this.check(offset, 4); return this.view.getInt32(offset, this.le); }
    ptr(offset) {
      if (this.pointerSize === 4) return BigInt(this.u32(offset));
      this.check(offset, 8);
      return this.view.getBigUint64(offset, this.le);
    }
    cstring(offset, maxLength) {
      this.check(offset, 1);
      const endLimit = Math.min(this.bytes.length, offset + maxLength);
      let end = offset;
      while (end < endLimit && this.bytes[end] !== 0) end++;
      return new TextDecoder("utf-8", { fatal: false }).decode(this.bytes.subarray(offset, end));
    }
  }

  function align(offset, alignment) {
    return Math.ceil(offset / alignment) * alignment;
  }

  function detectFormat(bytes) {
    if (bytes.length < 24) throw new Error("文件小于 GenericCDSFileMapHeader（24 字节）");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let littleEndian;
    const leMagic = view.getUint32(0, true);
    const beMagic = view.getUint32(0, false);
    if (MAGIC[leMagic]) littleEndian = true;
    else if (MAGIC[beMagic]) littleEndian = false;
    else throw new Error(`不是可识别的 CDS archive：magic=0x${leMagic.toString(16).padStart(8, "0")}`);

    const getU32 = (o) => view.getUint32(o, littleEndian);
    const headerSize = getU32(12);
    if (headerSize < 24 || headerSize >= bytes.length) throw new Error(`非法 header_size：${headerSize}`);

    // Score both C ABIs. Header size alone is insufficient because a dynamic
    // archive may append an arbitrarily long base-archive path to its header.
    const scoreAbi = (pointerSize) => {
      const regionSize = 24 + 8 * pointerSize;
      if (24 + 4 * regionSize > headerSize) return -1;
      let score = 0;
      for (let index = 0; index < 4; index++) {
        const base = 24 + index * regionSize;
        for (let flag = 0; flag < 5; flag++) {
          const value = view.getInt32(base + 4 + flag * 4, littleEndian);
          score += value === 0 || value === 1 ? 1 : -4;
        }
        const fileOffsetPosition = base + 24;
        const usedPosition = fileOffsetPosition + 2 * pointerSize;
        const read = (offset) => pointerSize === 8
          ? view.getBigUint64(offset, littleEndian)
          : BigInt(view.getUint32(offset, littleEndian));
        const fileOffset = read(fileOffsetPosition);
        const used = read(usedPosition);
        const fileSize = BigInt(bytes.length);
        score += fileOffset <= fileSize ? 3 : -8;
        score += used <= fileSize ? 3 : -8;
        score += used === 0n || fileOffset >= BigInt(headerSize) ? 2 : -4;
      }
      return score;
    };
    const score32 = scoreAbi(4);
    const score64 = scoreAbi(8);
    const pointerSize = score64 > score32 ? 8 : 4;
    if (Math.max(score32, score64) < 0) throw new Error("无法识别 CDS Header 的 32/64 位 ABI");
    return { littleEndian, pointerSize };
  }

  function parseRegions(reader) {
    const regions = [];
    const size = reader.pointerSize;
    const regionSize = 24 + 8 * size;
    for (let index = 0; index < 4; index++) {
      const base = 24 + index * regionSize;
      const rawReadOnly = reader.i32(base + 4);
      const rawAllowExec = reader.i32(base + 8);
      const rawIsHeap = reader.i32(base + 12);
      const rawIsBitmap = reader.i32(base + 16);
      const rawMappedFromFile = reader.i32(base + 20);
      const region = {
        index,
        name: REGION_NAMES[index],
        description: REGION_DESCRIPTIONS[index],
        headerOffset: base,
        structSize: regionSize,
        crc: reader.u32(base),
        readOnly: rawReadOnly !== 0,
        allowExec: rawAllowExec !== 0,
        isHeap: rawIsHeap !== 0,
        isBitmap: rawIsBitmap !== 0,
        mappedFromFile: rawMappedFromFile !== 0
      };
      let p = base + 24;
      region.fileOffset = reader.ptr(p); p += size;
      region.mappingOffset = reader.ptr(p); p += size;
      region.used = reader.ptr(p); p += size;
      region.oopmapOffset = reader.ptr(p); p += size;
      region.oopmapSizeBits = reader.ptr(p); p += size;
      region.ptrmapOffset = reader.ptr(p); p += size;
      region.ptrmapSizeBits = reader.ptr(p); p += size;
      region.mappedBase = reader.ptr(p);
      const field = (name, relativeOffset, byteSize, cType, value, description, kind) => ({
        name, relativeOffset, offset: base + relativeOffset, size: byteSize,
        cType, value, description, kind: kind || "number"
      });
      region.fields = [
        field("_crc", 0, 4, "int", region.crc, "区域数据的 CRC32 校验值", "crc"),
        field("_read_only", 4, 4, "int", rawReadOnly, "区域是否以只读权限使用", "flag"),
        field("_allow_exec", 8, 4, "int", rawAllowExec, "区域是否允许执行代码", "flag"),
        field("_is_heap_region", 12, 4, "int", rawIsHeap, "是否为归档 Java Heap 区域", "flag"),
        field("_is_bitmap_region", 16, 4, "int", rawIsBitmap, "是否为重定位 bitmap 区域", "flag"),
        field("_mapped_from_file", 20, 4, "int", rawMappedFromFile, "运行时是否直接从文件 mmap；归档文件中通常为 0", "flag"),
        field("_file_offset", 24, size, "size_t", region.fileOffset, "区域有效数据在 JSA 文件中的起始偏移", "pointer"),
        field("_mapping_offset", 24 + size, size, "size_t", region.mappingOffset, "相对 requested base 的请求映射偏移；BM 固定为 0", "pointer"),
        field("_used", 24 + 2 * size, size, "size_t", region.used, "区域实际有效字节数，不包含文件对齐 padding", "size"),
        field("_oopmap_offset", 24 + 3 * size, size, "size_t", region.oopmapOffset, "HP oopmap 相对 BM 区起点的字节偏移", "pointer"),
        field("_oopmap_size_in_bits", 24 + 4 * size, size, "size_t", region.oopmapSizeBits, "HP oopmap 的有效 bit 数", "size"),
        field("_ptrmap_offset", 24 + 5 * size, size, "size_t", region.ptrmapOffset, "HP native ptrmap 相对 BM 区起点的字节偏移", "pointer"),
        field("_ptrmap_size_in_bits", 24 + 6 * size, size, "size_t", region.ptrmapSizeBits, "HP native ptrmap 的有效 bit 数", "size"),
        field("_mapped_base", 24 + 7 * size, size, "char*", region.mappedBase, "运行时实际映射地址；归档文件中通常为 NULL", "pointer")
      ];
      regions.push(region);
    }
    return regions;
  }

  function parseDetailedHeader(reader, generic, regions) {
    const size = reader.pointerSize;
    let p = 24 + 4 * (24 + 8 * size);
    const fields = [];
    const add = (name, offset, byteSize, value, description) => {
      fields.push({ name, offset, size: byteSize, value, description });
      return value;
    };
    const ptr = (name, description) => { p = align(p, size); const o = p; p += size; return add(name, o, size, reader.ptr(o), description); };
    const i32 = (name, description) => { p = align(p, 4); const o = p; p += 4; return add(name, o, 4, reader.i32(o), description); };
    const u32 = (name, description) => { p = align(p, 4); const o = p; p += 4; return add(name, o, 4, reader.u32(o), description); };
    const bool = (name, description) => { const o = p++; return add(name, o, 1, reader.u8(o) !== 0, description); };
    const i16 = (name, description) => { p = align(p, 2); const o = p; p += 2; return add(name, o, 2, reader.i16(o), description); };

    const coreAlignment = ptr("core_region_alignment", "RW/RO 区域对齐粒度");
    i32("obj_alignment", "ObjectAlignmentInBytes");
    ptr("narrow_oop_base", "压缩 Oop 编码基址");
    i32("narrow_oop_shift", "压缩 Oop 位移");
    bool("compact_strings", "CompactStrings");
    bool("compact_headers", "UseCompactObjectHeaders");
    ptr("max_heap_size", "Dump 时最大堆");
    i32("narrow_oop_mode", "CompressedOops::Mode");
    i32("narrow_klass_shift", "压缩 Klass 位移");
    bool("compressed_oops", "UseCompressedOops");
    bool("compressed_class_ptrs", "UseCompressedClassPointers");
    bool("use_secondary_supers_table", "UseSecondarySupersTable");
    ptr("cloned_vtables_offset", "克隆 vtable 的映射偏移");
    ptr("serialized_data_offset", "序列化 VM 数据的映射偏移");
    ptr("heap_begin", "Dump 时 Java Heap 起始地址");
    ptr("heap_end", "Dump 时 Java Heap 结束地址");
    bool("has_non_jar_in_classpath", "classpath 包含非 JAR 项");
    u32("common_app_classpath_prefix_size", "应用 classpath 公共前缀长度");

    const jvmIdentOffset = p;
    const jvmIdent = reader.cstring(p, 256);
    add("jvm_ident", p, 256, jvmIdent, "创建该归档的 JVM 标识");
    p += 256;
    ptr("shared_path_table_offset", "SharedPathTable 映射偏移");
    i16("app_class_paths_start_index", "首个应用 classpath 条目");
    i16("app_module_paths_start_index", "首个应用 module path 条目");
    i16("num_module_paths", "module path 条目数");
    i16("max_used_path_index", "归档引用的最大 path 索引");
    bool("verify_local", "BytecodeVerificationLocal");
    bool("verify_remote", "BytecodeVerificationRemote");
    bool("has_platform_or_app_classes", "包含平台/应用类");
    ptr("requested_base_address", "请求映射基址");
    ptr("mapped_base_address", "运行期实际映射基址；文件中通常为 0");
    bool("allow_archiving_with_java_agent", "允许 Java Agent 参与归档");
    bool("use_optimized_module_handling", "使用优化 module 处理");
    bool("use_full_module_graph", "包含完整 module graph");
    ptr("ptrmap_size_in_bits", "RW/RO 原生指针重定位位图大小");

    p = align(p, 4);
    const dynamicFixedEnd = generic.baseArchiveNameOffset || generic.headerSize;
    const hasProgramCrc = generic.archiveType === "aggressive-dynamic" || dynamicFixedEnd >= p + 24;
    if (generic.archiveType === "dynamic" && p + 20 <= dynamicFixedEnd) {
      i32("base_header_crc", "基础静态归档的 Header CRC32");
      if (hasProgramCrc) i32("program_crc", "BiSheng Aggressive CDS 程序指纹 CRC32（普通动态归档中通常为 0）");
      for (let i = 0; i < 4; i++) i32(`base_region_crc[${i}]`, `基础归档 ${REGION_NAMES[i]} 区域 CRC32`);
    } else if (generic.archiveType === "aggressive-dynamic" && p + 24 <= dynamicFixedEnd) {
      i32("base_header_crc", "基础静态归档的 Header CRC32");
      i32("program_crc", "Aggressive CDS 程序指纹 CRC32");
      for (let i = 0; i < 4; i++) i32(`base_region_crc[${i}]`, `基础归档 ${REGION_NAMES[i]} 区域 CRC32`);
    }

    return { fields, parsedSize: align(p, size), coreAlignment, jvmIdentOffset, jvmIdent };
  }

  function safeNumber(value) {
    if (typeof value === "number") return value;
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }

  function bitmapStorageBytes(sizeInBits, wordSize) {
    const bits = safeNumber(sizeInBits);
    if (bits === null) return null;
    const bitsPerWord = wordSize * 8;
    return Math.ceil(bits / bitsPerWord) * wordSize;
  }

  function bitmapBit(bytes, byteOffset, bitIndex, wordSize, littleEndian) {
    const bitsPerWord = wordSize * 8;
    const word = Math.floor(bitIndex / bitsPerWord);
    const inWord = bitIndex % bitsPerWord;
    const byteInWord = Math.floor(inWord / 8);
    const physicalByte = littleEndian ? byteInWord : wordSize - 1 - byteInWord;
    return (bytes[byteOffset + word * wordSize + physicalByte] & (1 << (inWord & 7))) !== 0;
  }

  function parseBitmap(bytes, options) {
    const sizeBits = safeNumber(options.sizeBits);
    const storageBytes = bitmapStorageBytes(options.sizeBits, options.wordSize);
    if (sizeBits === null || storageBytes === null) throw new Error(`${options.name} 位图过大，无法安全解析`);
    if (options.fileOffset < 0 || options.fileOffset + storageBytes > bytes.length) {
      throw new Error(`${options.name} 位图越过文件边界`);
    }
    const binCount = Math.min(128, Math.max(1, Math.ceil(sizeBits / 4096)));
    const bins = new Array(binCount).fill(0);
    const setBits = [];
    const bucketBits = {};
    const bucketSetCounts = {};
    let setCount = 0;
    for (let bit = 0; bit < sizeBits; bit++) {
      if (bitmapBit(bytes, options.fileOffset, bit, options.wordSize, options.littleEndian)) {
        setCount++;
        bins[Math.min(binCount - 1, Math.floor(bit * binCount / Math.max(1, sizeBits)))]++;
        if (options.bucketForBit) {
          const bucket = options.bucketForBit(bit);
          if (bucket) {
            bucketSetCounts[bucket] = (bucketSetCounts[bucket] || 0) + 1;
            if (!bucketBits[bucket]) bucketBits[bucket] = [];
            if (bucketBits[bucket].length < options.sampleLimit) bucketBits[bucket].push(bit);
          }
        } else if (setBits.length < options.sampleLimit) {
          setBits.push(bit);
        }
      }
    }
    if (options.bucketForBit) Object.values(bucketBits).forEach(bits => setBits.push(...bits));
    return {
      name: options.name,
      description: options.description,
      bmOffset: options.bmOffset,
      fileOffset: options.fileOffset,
      sizeBits,
      storageBytes,
      setCount,
      density: sizeBits ? setCount / sizeBits : 0,
      sampled: setBits.length,
      truncated: setCount > setBits.length,
      bins,
      setBits
      , bucketSetCounts
    };
  }

  function rangeContains(region, offset, width) {
    const start = region.mappingOffset;
    return offset >= start && offset + BigInt(width) <= start + region.used;
  }

  function classifyMetaspaceTarget(raw, requestedBase, coreRegions, archiveType) {
    if (raw === 0n) return { kind: "null", label: "null" };
    if (raw >= requestedBase) {
      const mappingOffset = raw - requestedBase;
      const target = coreRegions.find(region => rangeContains(region, mappingOffset, 1));
      if (target) {
        const regionOffset = mappingOffset - target.mappingOffset;
        return {
          kind: "local",
          label: `${target.name}+0x${regionOffset.toString(16)}`,
          region: target.name,
          regionOffset,
          fileOffset: target.fileOffset + regionOffset
        };
      }
    }
    if (archiveType !== "static" && raw < requestedBase) {
      return { kind: "base-archive", label: "基础静态归档 / 外部映射" };
    }
    return { kind: "unresolved", label: "归档映射范围外" };
  }

  function parseRegionContents(bytes, reader, generic, regions, headerValues) {
    const bm = regions[2];
    const hp = regions[3];
    const coreRegions = regions.slice(0, 2);
    const bmFileOffset = safeNumber(bm.fileOffset);
    if (bmFileOffset === null || bm.used === 0n) {
      return { available: false, reason: "BM 区域为空", bitmaps: [], corePointerSlots: [], heapOopSlots: [], heapPointerSlots: [] };
    }

    const sampleLimit = 2000;
    const ptrmapBits = headerValues.ptrmap_size_in_bits || 0n;
    const metaBytes = bitmapStorageBytes(ptrmapBits, reader.pointerSize);
    const specs = [{
      key: "metaspace",
      name: "RW/RO ptrmap",
      description: "RW/RO 中需要随 CDS 映射地址重定位的原生指针槽",
      bmOffset: 0,
      sizeBits: ptrmapBits,
      wordSize: reader.pointerSize,
      bucketForBit: bit => {
        const offset = BigInt(bit * reader.pointerSize);
        const region = coreRegions.find(item => rangeContains(item, offset, reader.pointerSize));
        return region ? region.name : "gap";
      }
    }];
    if (hp.oopmapSizeBits > 0n) specs.push({
      key: "heap-oop",
      name: "HP oopmap",
      description: "归档堆对象内部的非空 Java oop 引用槽",
      bmOffset: safeNumber(hp.oopmapOffset),
      sizeBits: hp.oopmapSizeBits,
      wordSize: reader.pointerSize
    });
    if (hp.ptrmapSizeBits > 0n) specs.push({
      key: "heap-native",
      name: "HP ptrmap",
      description: "归档堆对象内部指向 CDS Metaspace 的原生 Klass 指针槽",
      bmOffset: safeNumber(hp.ptrmapOffset),
      sizeBits: hp.ptrmapSizeBits,
      wordSize: reader.pointerSize
    });

    const bitmaps = specs.map(spec => {
      if (spec.bmOffset === null) throw new Error(`${spec.name} 偏移过大`);
      return Object.assign(parseBitmap(bytes, {
        name: spec.name,
        description: spec.description,
        bmOffset: spec.bmOffset,
        fileOffset: bmFileOffset + spec.bmOffset,
        sizeBits: spec.sizeBits,
        wordSize: spec.wordSize,
        littleEndian: reader.le,
        sampleLimit,
        bucketForBit: spec.bucketForBit
      }), { key: spec.key });
    });

    const requestedBase = headerValues.requested_base_address || 0n;
    const metaMap = bitmaps.find(map => map.key === "metaspace");
    const corePointerSlots = metaMap.setBits.map(bit => {
      const mappingOffset = BigInt(bit * reader.pointerSize);
      const source = coreRegions.find(region => rangeContains(region, mappingOffset, reader.pointerSize));
      if (!source) return { bit, mappingOffset, sourceRegion: "间隙", sourceOffset: null, fileOffset: null, raw: null, target: { kind: "unmapped", label: "未映射槽" } };
      const sourceOffset = mappingOffset - source.mappingOffset;
      const fileOffsetBig = source.fileOffset + sourceOffset;
      const fileOffset = safeNumber(fileOffsetBig);
      const raw = fileOffset === null ? null : reader.ptr(fileOffset);
      return {
        bit,
        mappingOffset,
        sourceRegion: source.name,
        sourceOffset,
        fileOffset: fileOffsetBig,
        raw,
        target: raw === null ? { kind: "unresolved", label: "偏移过大" } : classifyMetaspaceTarget(raw, requestedBase, coreRegions, generic.archiveType)
      };
    });

    const hpFileOffset = safeNumber(hp.fileOffset);
    const hpRequestedBase = headerValues.compressed_oops
      ? (headerValues.narrow_oop_base || 0n) + hp.mappingOffset
      : (headerValues.heap_begin || 0n) + hp.mappingOffset;
    const oopMap = bitmaps.find(map => map.key === "heap-oop");
    const oopSlotSize = headerValues.compressed_oops ? 4 : reader.pointerSize;
    const heapOopSlots = !oopMap || hpFileOffset === null ? [] : oopMap.setBits.map(bit => {
      const sourceOffset = bit * oopSlotSize;
      const fileOffset = hpFileOffset + sourceOffset;
      const raw = headerValues.compressed_oops ? BigInt(reader.u32(fileOffset)) : reader.ptr(fileOffset);
      const decoded = raw === 0n ? 0n : headerValues.compressed_oops
        ? (headerValues.narrow_oop_base || 0n) + (raw << BigInt(headerValues.narrow_oop_shift || 0))
        : raw;
      const inHeap = decoded >= hpRequestedBase && decoded < hpRequestedBase + hp.used;
      return {
        bit,
        sourceOffset: BigInt(sourceOffset),
        fileOffset: BigInt(fileOffset),
        raw,
        decoded,
        target: inHeap ? `HP+0x${(decoded - hpRequestedBase).toString(16)}` : "归档 HP 范围外"
      };
    });

    const heapNativeMap = bitmaps.find(map => map.key === "heap-native");
    const heapPointerSlots = !heapNativeMap || hpFileOffset === null ? [] : heapNativeMap.setBits.map(bit => {
      const sourceOffset = bit * reader.pointerSize;
      const fileOffset = hpFileOffset + sourceOffset;
      const raw = reader.ptr(fileOffset);
      return {
        bit,
        sourceOffset: BigInt(sourceOffset),
        fileOffset: BigInt(fileOffset),
        raw,
        target: classifyMetaspaceTarget(raw, requestedBase, coreRegions, generic.archiveType)
      };
    });

    return {
      available: true,
      bitmapStorageBytes: metaBytes,
      bitmaps,
      corePointerSlots,
      coreSlotCounts: metaMap.bucketSetCounts,
      heapOopSlots,
      heapPointerSlots,
      sampleLimit,
      hpRequestedBase,
      oopSlotSize
    };
  }

  function parse(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const format = detectFormat(bytes);
    const reader = new Reader(bytes, format.littleEndian, format.pointerSize);
    const generic = {
      magic: reader.u32(0),
      storedHeaderCrc: reader.u32(4),
      version: reader.i32(8),
      headerSize: reader.u32(12),
      baseArchiveNameOffset: reader.u32(16),
      baseArchiveNameSize: reader.u32(20)
    };
    generic.archiveType = MAGIC[generic.magic];
    if (generic.version < 13) throw new Error(`CDS 版本 ${generic.version} 早于可解析的通用头版本 13`);

    const regions = parseRegions(reader);
    const detailed = parseDetailedHeader(reader, generic, regions);
    const headerValues = Object.fromEntries(detailed.fields.map(field => [field.name, field.value]));
    const computedHeaderCrc = crc32(bytes, 16, generic.headerSize - 16);
    let baseArchiveName = "";
    if (generic.baseArchiveNameOffset && generic.baseArchiveNameSize) {
      if (generic.baseArchiveNameOffset + generic.baseArchiveNameSize <= generic.headerSize) {
        baseArchiveName = reader.cstring(generic.baseArchiveNameOffset, generic.baseArchiveNameSize);
      }
    }

    const diagnostics = [];
    const diagnostic = (level, message) => diagnostics.push({ level, message });
    diagnostic(computedHeaderCrc === generic.storedHeaderCrc ? "ok" : "error",
      computedHeaderCrc === generic.storedHeaderCrc ? "Header CRC32 校验通过" : "Header CRC32 不匹配，文件可能损坏或格式 ABI 不兼容");
    diagnostic(generic.version === 18 ? "ok" : "warn", generic.version === 18 ? "CDS 版本与本仓库 v18 一致" : `CDS 版本为 ${generic.version}；仅通用头保证兼容`);
    diagnostic(detailed.parsedSize <= generic.headerSize ? "ok" : "error", `结构化头字段占用 ${detailed.parsedSize} B，声明头大小 ${generic.headerSize} B`);

    for (const region of regions) {
      const offset = safeNumber(region.fileOffset);
      const used = safeNumber(region.used);
      if (offset === null || used === null || offset + used > bytes.length) {
        region.computedCrc = null;
        region.crcValid = used === 0;
        diagnostic(used === 0 ? "ok" : "error", `${region.name} 区域越过文件边界`);
      } else if (used === 0) {
        region.computedCrc = 0;
        region.crcValid = true;
        diagnostic("ok", `${region.name} 区域为空`);
      } else {
        region.computedCrc = crc32(bytes, offset, used);
        region.crcValid = region.computedCrc === region.crc;
        diagnostic(region.crcValid ? "ok" : "error", `${region.name} CRC32 ${region.crcValid ? "校验通过" : "不匹配"}`);
      }
    }

    const firstRegionOffset = Math.min(...regions.map(r => safeNumber(r.fileOffset)).filter(v => v !== null && v > 0));
    if (Number.isFinite(firstRegionOffset) && firstRegionOffset < generic.headerSize) diagnostic("error", "首个数据区域与 Header 重叠");
    else diagnostic("ok", "Header 与数据区域边界有效");

    let contents;
    try {
      contents = parseRegionContents(bytes, reader, generic, regions, headerValues);
      if (contents.available) diagnostic("ok", "BM 子位图及引用槽解析完成");
    } catch (error) {
      contents = { available: false, reason: error instanceof Error ? error.message : String(error), bitmaps: [], corePointerSlots: [], heapOopSlots: [], heapPointerSlots: [] };
      diagnostic("error", `区域内容解析失败：${contents.reason}`);
    }

    return {
      fileSize: bytes.length,
      bytes,
      endian: format.littleEndian ? "little" : "big",
      pointerSize: format.pointerSize,
      generic,
      headerFields: [
        { name: "magic", offset: 0, size: 4, value: generic.magic, description: "CDS archive 类型标识" },
        { name: "crc", offset: 4, size: 4, value: generic.storedHeaderCrc, description: "Header CRC32（从偏移 0x10 到 Header 末尾）" },
        { name: "version", offset: 8, size: 4, value: generic.version, description: "CDS 文件格式版本" },
        { name: "header_size", offset: 12, size: 4, value: generic.headerSize, description: "Header 总字节数" },
        { name: "base_archive_name_offset", offset: 16, size: 4, value: generic.baseArchiveNameOffset, description: "动态归档的基础归档名称偏移" },
        { name: "base_archive_name_size", offset: 20, size: 4, value: generic.baseArchiveNameSize, description: "基础归档名称长度（含 NUL）" },
        ...detailed.fields,
        ...(baseArchiveName ? [{
          name: "base_archive_name",
          offset: generic.baseArchiveNameOffset,
          size: generic.baseArchiveNameSize,
          value: baseArchiveName,
          description: "动态归档引用的非默认基础归档路径"
        }] : [])
      ],
      computedHeaderCrc,
      headerCrcValid: computedHeaderCrc === generic.storedHeaderCrc,
      baseArchiveName,
      jvmIdent: detailed.jvmIdent,
      coreAlignment: detailed.coreAlignment,
      headerValues,
      regions,
      contents,
      diagnostics
    };
  }

  function jsonSafe(report) {
    return JSON.parse(JSON.stringify(report, (key, value) => {
      if (key === "bytes") return undefined;
      if (typeof value === "bigint") return `0x${value.toString(16)}`;
      return value;
    }));
  }

  return { parse, crc32, jsonSafe, MAGIC, REGION_NAMES };
});
