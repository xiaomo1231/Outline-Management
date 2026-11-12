// 生成 Word 文档：标题、章名、首行缩进两字的正文段落。
import { zip } from "./zip";

export interface DocBlock {
  kind: "title" | "h1" | "h2" | "p";
  text: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function para(b: DocBlock): string {
  const t = `<w:t xml:space="preserve">${esc(b.text)}</w:t>`;
  if (b.kind === "p") return `<w:p><w:pPr><w:ind w:firstLineChars="200" w:firstLine="420"/><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:r>${t}</w:r></w:p>`;
  const size = b.kind === "title" ? 44 : b.kind === "h1" ? 36 : 30;
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr>${t}</w:r></w:p>`;
}

export function buildDocx(blocks: DocBlock[]): Uint8Array {
  const body = blocks.map(para).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体" w:hAnsi="宋体"/><w:sz w:val="24"/><w:lang w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
  return zip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: styles },
  ]);
}
