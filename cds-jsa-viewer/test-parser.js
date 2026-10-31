/*
 * Copyright (c) 2026, Huawei Technologies Co., Ltd. All rights reserved.
 * This code is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2 only, as
 * published by the Free Software Foundation. Oracle designates this file
 * as subject to the "Classpath" exception in the accompanying LICENSE.
 *
 * Simple smoke test: node test-parser.js /path/to/classes.jsa
 */
const fs = require("fs");
const path = require("path");
const parser = require("./jsa-parser.js");

const file = process.argv[2];
if (!file) {
  console.error("usage: node test-parser.js /path/to/classes.jsa");
  process.exit(2);
}

const report = parser.parse(fs.readFileSync(path.resolve(file)));
if (!report.headerCrcValid) throw new Error("header CRC failed");
for (const region of report.regions) {
  if (!region.crcValid) throw new Error(`${region.name} CRC failed`);
  if (!region.fields || region.fields.length !== 14) throw new Error(`${region.name} CDSFileMapRegion fields missing`);
  for (const required of ["_crc", "_read_only", "_allow_exec", "_is_heap_region", "_is_bitmap_region", "_mapped_from_file", "_file_offset", "_mapping_offset", "_used", "_oopmap_offset", "_oopmap_size_in_bits", "_ptrmap_offset", "_ptrmap_size_in_bits", "_mapped_base"]) {
    if (!region.fields.some(field => field.name === required)) throw new Error(`${region.name}.${required} missing`);
  }
}
if (!report.contents.available) throw new Error(`region contents unavailable: ${report.contents.reason}`);
const metaMap = report.contents.bitmaps.find(map => map.key === "metaspace");
if (!metaMap || metaMap.sizeBits <= 0 || metaMap.setCount <= 0) throw new Error("metaspace ptrmap not parsed");
for (const slot of report.contents.corePointerSlots) {
  if (slot.raw === 0n) throw new Error("ptrmap unexpectedly contains a null pointer");
}
console.log(JSON.stringify({
  type: report.generic.archiveType,
  version: report.generic.version,
  pointerSize: report.pointerSize,
  headerSize: report.generic.headerSize,
  jvmIdent: report.jvmIdent,
  regions: report.regions.map(r => ({ name: r.name, offset: String(r.fileOffset), used: String(r.used), crc: r.crcValid })),
  bitmaps: report.contents.bitmaps.map(map => ({ name: map.name, bits: map.sizeBits, set: map.setCount, sampled: map.sampled })),
  pointerSlots: report.contents.corePointerSlots.length,
  heapOopSlots: report.contents.heapOopSlots.length,
  heapPointerSlots: report.contents.heapPointerSlots.length
}, null, 2));
