from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
from pathlib import Path

OUT = Path('jdk8-to-jdk21-brief.pptx')

def esc(s):
    return escape(s, {'"': '&quot;'})

def text_box(x, y, w, h, text, size=16, color='1F2937', bold=False,
             font='Microsoft YaHei', align='left', valign='mid', margin=0.06):
    text_box.nid += 1
    runs = []
    for i, line in enumerate(text.split('\n')):
        if i:
            runs.append('<a:br/>')
        runs.append(f'<a:r><a:rPr lang="zh-CN" sz="{size*100}" b="{"1" if bold else "0"}"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:latin typeface="{font}"/><a:ea typeface="{font}"/></a:rPr><a:t>{esc(line)}</a:t></a:r>')
    body = ''.join(runs)
    return f'''<p:sp><p:nvSpPr><p:cNvPr id="{text_box.nid}" name="Text {text_box.nid}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr lIns="{int(margin*914400)}" rIns="{int(margin*914400)}" tIns="{int(margin*914400)}" bIns="{int(margin*914400)}" anchor="{valign}"/><a:lstStyle/><a:p><a:pPr algn="{align}"/><a:endParaRPr lang="zh-CN" sz="{size*100}"/><a:rPr lang="zh-CN" sz="{size*100}"/>{body}</a:p></p:txBody></p:sp>'''
text_box.nid = 10

def rect(x, y, w, h, fill, line=None, radius=False):
    rect.nid += 1
    geom = 'roundRect' if radius else 'rect'
    ln = '<a:ln><a:noFill/></a:ln>' if not line else f'<a:ln w="12700"><a:solidFill><a:srgbClr val="{line}"/></a:solidFill></a:ln>'
    return f'<p:sp><p:nvSpPr><p:cNvPr id="{rect.nid}" name="Shape {rect.nid}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="{geom}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>{ln}</p:spPr></p:sp>'
rect.nid = 100

def slide_xml():
    # 16:9 canvas: 13.333 x 7.5 in, EMU coordinates
    W, H = 12192000, 6858000
    s=[]
    s.append(rect(0,0,W,H,'F7F9FC'))
    s.append(rect(0,0,W,980000,'123B5D'))
    s.append(text_box(420000,180000,11200000,400000,'从 JDK 8 迁移到 JDK 21',2800,'FFFFFF',True))
    s.append(text_box(430000,610000,11200000,220000,'以 JDK 21 作为公司统一生产基线，保障未来 3–5 年的生态、安全与交付能力',1250,'D7E8F5'))
    s.append(rect(430000,1150000,11260000,720000,'E7F2F8',line='B8D6E5',radius=True))
    s.append(text_box(650000,1280000,10800000,460000,'核心判断：JDK 8 仍然“能运行”，但已不再是主流 Java 生态的默认入口。继续停留，将从“主动升级”演变为“被动应急”。',1700,'123B5D',True))
    # Four evidence cards
    cards=[
      ('01  Java 生态','Spring 6 / Boot 3 已要求 Java 17；Jakarta EE、云 SDK 和中间件持续提高最低版本。','JDK 8 被锁定在旧框架，升级和安全修复受限。','E9F5EF','2E7D5A'),
      ('02  OpenJDK 社区','语言特性、GC、JVM 优化和 JEP 创新集中在 17/21 等新 LTS。','社区资源、人才与工具链逐步远离 JDK 8。','EDF3FB','2F6690'),
      ('03  生命周期与安全','JDK 8 发布于 2014 年；JDK 21 是新一代 LTS，维护窗口更清晰。','降低漏洞、合规、供应商绑定和紧急迁移风险。','FFF4E5','B56B00'),
      ('04  业界与云原生','企业新项目、容器镜像和云平台普遍以 Java 17/21 为主。','虚拟线程、现代 GC 和容器适配提升资源效率。','F2ECFA','6A4C93')]
    x0,y0=430000,2050000; cw,ch,gap=2670000,1460000,220000
    for i,(head,fact,impact,fill,accent) in enumerate(cards):
        x=x0+i*(cw+gap)
        s.append(rect(x,y0,cw,ch,fill,line='D6DEE8',radius=True))
        s.append(rect(x,y0,90000,ch,accent))
        s.append(text_box(x+170000,y0+150000,cw-260000,260000,head,1450,accent,True))
        s.append(text_box(x+170000,y0+490000,cw-300000,470000,fact,1150,'263746'))
        s.append(text_box(x+170000,y0+1020000,cw-300000,280000,impact,1050,'5B6875'))
    # Bottom decision strip
    s.append(rect(430000,3880000,11260000,2070000,'FFFFFF',line='D6DEE8',radius=True))
    s.append(text_box(650000,4070000,5300000,300000,'不升级的代价',1550,'A33A3A',True))
    s.append(text_box(650000,4430000,5000000,1070000,'• 产品无法及时跟进主流框架\n• 安全、合规与供应商风险累积\n• 技术债务最终集中爆发\n• 招聘、培训和运维复杂度上升',1250,'3D4650'))
    s.append(text_box(6180000,4070000,5000000,300000,'升级后的收益',1550,'167A55',True))
    s.append(text_box(6180000,4430000,5000000,1070000,'• 获得主流框架和云平台持续支持\n• 建立统一、可持续的 LTS 基线\n• 提升高并发与资源利用效率\n• 降低长期安全和迁移成本',1250,'3D4650'))
    s.append(rect(430000,6150000,11260000,430000,'123B5D',radius=True))
    s.append(text_box(650000,6220000,10800000,270000,'建议决策：批准 JDK 21 为统一生产基线；新项目禁止新增 JDK 8 依赖，存量系统按“扫描 → 试点 → 核心迁移 → 长尾收敛”分批推进。',1450,'FFFFFF',True))
    body=''.join(s)
    return f'''<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'''

def write_pptx():
    slide=slide_xml()
    files={
      '[Content_Types].xml':'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>''',
      '_rels/.rels':'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>''',
      'ppt/presentation.xml':'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>''',
      'ppt/_rels/presentation.xml.rels':'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>''',
      'ppt/slides/slide1.xml':slide,
      'ppt/slides/_rels/slide1.xml.rels':'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>''',
      'ppt/slideLayouts/slideLayout1.xml':'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>''',
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels':'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>''',
      'ppt/slideMasters/slideMaster1.xml':'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Master"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>''',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels':'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>''',
      'ppt/theme/theme1.xml':'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F7F9FC"/></a:lt2><a:accent1><a:srgbClr val="123B5D"/></a:accent1><a:accent2><a:srgbClr val="2E7D5A"/></a:accent2><a:accent3><a:srgbClr val="B56B00"/></a:accent3><a:accent4><a:srgbClr val="6A4C93"/></a:accent4><a:accent5><a:srgbClr val="2F6690"/></a:accent5><a:accent6><a:srgbClr val="A33A3A"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="Microsoft YaHei"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>'''
    }
    with ZipFile(OUT,'w',ZIP_DEFLATED) as z:
        for name,data in files.items(): z.writestr(name,data)
    print(OUT, OUT.stat().st_size)

if __name__=='__main__': write_pptx()
