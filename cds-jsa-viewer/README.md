<!--
Copyright (c) 2026, Huawei Technologies Co., Ltd. All rights reserved.
This code is free software; you can redistribute it and/or modify it under
the terms of the GNU General Public License version 2 only, as published by
the Free Software Foundation. Oracle designates this file as subject to the
"Classpath" exception in the accompanying LICENSE.
-->

# CDS JSA Viewer

纯浏览器的 HotSpot CDS `.jsa` 文件可视化解析工具。文件只在本地浏览器中读取，不会上传。

## 使用

直接打开 `index.html`，或者在本目录启动任意静态 HTTP 服务：

```sh
python3 -m http.server 8000
```

然后访问 `http://localhost:8000`，拖入或选择 `.jsa` 文件。

## 当前解析范围

- `GenericCDSFileMapHeader`；
- JDK 21 CDS v18 的完整 `FileMapHeader`；
- 静态、动态及 BiSheng Aggressive Dynamic Archive magic；
- 32/64 位和大小端自动识别；
- RW、RO、BM、HP 四个 `CDSFileMapRegion`；
- BM 内部三段 HotSpot bitmap（RW/RO ptrmap、HP oopmap、HP ptrmap）；
- RW/RO 重定位指针槽、原始值及 RW/RO 目标区域映射；
- HP 压缩/非压缩 oop 槽解码与 native Klass 指针槽；
- bitmap 密度图、引用槽分页表及槽位 Hex 跳转；
- 导入 `PrintSharedArchiveAndExit` 文本，展示共享 Klass 清单以及 Symbol/String 统计；
- Header 和各非空 Region 的 zlib CRC32；
- 文件布局图、字段表、诊断、Hex View 和 JSON 导出。

RW/RO 区域内部是包含进程地址和重定位信息的 HotSpot Metaspace 对象图。JSA 中没有通用的对象边界和类型目录，因此本工具精确解析 bitmap 标记的引用槽，但不会用字符串扫描猜测 Klass、Symbol 或 oop 对象。

查看归档类清单请使用生成该归档的同版本 JVM，并把输出文本导入页面：

```sh
java -XX:+PrintSharedArchiveAndExit \
  -XX:SharedArchiveFile=/path/to/classes.jsa \
  > archive-report.txt 2>&1
```

`PrintSharedArchiveAndExit` 可以提供共享 Klass 的逻辑清单以及 Symbol/String 总数，但不包含对象地址。若要把每个 Klass/Symbol 精确映射到 RW/RO 文件偏移，需要由完全相同的 HotSpot 构建导出 VM 类型布局和对象地址元数据。
