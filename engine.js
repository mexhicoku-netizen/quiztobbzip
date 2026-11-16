/*  QuizToBBZip engine  -  runs entirely in the browser (and in Node for tests).
 *  A 1:1 port of quiz2bb.py v1.1 (Mexhisan Coku, MCO Teaching) to plain JavaScript.
 *  No server, no uploads, no AI, no external libraries.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.QTZ = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = "1.1";
  const LET = "ABCDEFGH";

  // ===================================================================================
  // 0. Small helpers
  // ===================================================================================
  const enc = new TextEncoder();
  const dec = new TextDecoder("utf-8");
  const toBytes = (s) => (typeof s === "string" ? enc.encode(s) : s);
  const setUnion = (sets) => { const r = new Set(); for (const s of sets) for (const x of s) r.add(x); return r; };
  const setDiff = (a, b) => { const r = new Set(); for (const x of a) if (!b.has(x)) r.add(x); return r; };

  function pyEscape(s) {      // html.escape(s, quote=True)
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  }

  // ===================================================================================
  // 1. Zip reader / writer (store + CRC32, inflate through DecompressionStream)
  // ===================================================================================
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot unzip Word files (no DecompressionStream). Please use a current Chrome, Edge, Firefox or Safari.");
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Read every file of a .zip/.docx: returns Map(name -> Uint8Array). */
  async function unzip(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("This file is not a valid .docx (zip) file.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = new Map();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Damaged zip directory.");
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith("/")) continue;
      const lnl = dv.getUint16(lho + 26, true), lxl = dv.getUint16(lho + 28, true);
      const data = u8.subarray(lho + 30 + lnl + lxl, lho + 30 + lnl + lxl + csize);
      if (method === 0) out.set(name, data.slice());
      else if (method === 8) out.set(name, await inflateRaw(data));
      else throw new Error("Unsupported zip compression in " + name);
    }
    return out;
  }

  /** Write a .zip with the "store" method. files: [{name, data: string|Uint8Array}] */
  function makeZip(files) {
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = (Math.max(now.getFullYear() - 1980, 0) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = toBytes(f.data), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const csize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let o = 0; for (const a of all) { out.set(a, o); o += a.length; }
    return out;
  }

  // ===================================================================================
  // 2. Small namespace-aware XML parser (so the engine needs no DOMParser)
  // ===================================================================================
  const NS_CANON = {
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main": "w",
    "http://schemas.openxmlformats.org/officeDocument/2006/math": "m",
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships": "r",
    "http://schemas.openxmlformats.org/drawingml/2006/main": "a",
    "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing": "wp",
    "urn:schemas-microsoft-com:vml": "v",
  };
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const unent = (s) => s.indexOf("&") < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === "#") { const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch (_) { return ""; } }
    return e in ENT ? ENT[e] : m;
  });

  function parseXML(s) {
    let i = 0;
    const n = s.length, stack = [], scopes = [{ "": null, xml: "xml" }];
    let root = null;
    const resolve = (qn, isAttr, scope) => {
      const c = qn.indexOf(":");
      if (c < 0) { if (isAttr) return qn; const uri = scope[""]; return uri && NS_CANON[uri] ? NS_CANON[uri] + ":" + qn : qn; }
      const uri = scope[qn.slice(0, c)];
      return uri && NS_CANON[uri] ? NS_CANON[uri] + ":" + qn.slice(c + 1) : qn;
    };
    while (i < n) {
      const lt = s.indexOf("<", i);
      const txtEnd = lt < 0 ? n : lt;
      if (txtEnd > i && stack.length) stack[stack.length - 1].text += unent(s.slice(i, txtEnd));
      if (lt < 0) break;
      i = lt;
      if (s.startsWith("<!--", i)) { const e = s.indexOf("-->", i + 4); i = e < 0 ? n : e + 3; continue; }
      if (s.startsWith("<![CDATA[", i)) { const e = s.indexOf("]]>", i); if (stack.length) stack[stack.length - 1].text += s.slice(i + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
      if (s.startsWith("<?", i)) { const e = s.indexOf("?>", i); i = e < 0 ? n : e + 2; continue; }
      if (s.startsWith("<!", i)) { const e = s.indexOf(">", i); i = e < 0 ? n : e + 1; continue; }
      if (s[i + 1] === "/") {
        const e = s.indexOf(">", i); const nm = s.slice(i + 2, e).trim();
        if (!stack.length) throw new Error("XML: unexpected </" + nm + ">");
        const top = stack.pop(); scopes.pop();
        if (top.raw !== nm) throw new Error("XML: mismatched </" + nm + ">");
        i = e + 1; continue;
      }
      // start tag
      let j = i + 1;
      while (j < n && !/[\s/>]/.test(s[j])) j++;
      const raw = s.slice(i + 1, j);
      const attrsRaw = [];
      let selfClose = false;
      for (;;) {
        while (j < n && /\s/.test(s[j])) j++;
        if (s[j] === "/") { selfClose = true; j++; continue; }
        if (s[j] === ">") { j++; break; }
        if (j >= n) throw new Error("XML: unterminated tag");
        let k = j; while (k < n && !/[\s=/>]/.test(s[k])) k++;
        const an = s.slice(j, k); j = k;
        while (j < n && /\s/.test(s[j])) j++;
        let av = "";
        if (s[j] === "=") {
          j++; while (j < n && /\s/.test(s[j])) j++;
          const q = s[j];
          if (q === '"' || q === "'") { const e = s.indexOf(q, j + 1); av = unent(s.slice(j + 1, e)); j = e + 1; }
        }
        attrsRaw.push([an, av]);
      }
      i = j;
      const scope = Object.assign({}, scopes[scopes.length - 1]);
      for (const [an, av] of attrsRaw) { if (an === "xmlns") scope[""] = av; else if (an.startsWith("xmlns:")) scope[an.slice(6)] = av; }
      const attrs = {};
      for (const [an, av] of attrsRaw) { if (an === "xmlns" || an.startsWith("xmlns:")) continue; attrs[resolve(an, true, scope)] = av; }
      const el = { tag: resolve(raw, false, scope), raw, attrs, kids: [], text: "" };
      if (stack.length) stack[stack.length - 1].kids.push(el); else if (!root) root = el;
      if (!selfClose) { stack.push(el); scopes.push(scope); }
    }
    if (stack.length) throw new Error("XML: unclosed <" + stack[stack.length - 1].raw + ">");
    if (!root) throw new Error("XML: empty");
    return root;
  }
  const child = (e, tag) => e.kids.find((k) => k.tag === tag) || null;
  const children = (e, tag) => e.kids.filter((k) => k.tag === tag);
  function* iter(e, tag) { if (e.tag === tag) yield e; for (const k of e.kids) yield* iter(k, tag); }
  function* descendants(e, tag) { for (const k of e.kids) yield* iter(k, tag); }
  const attr = (e, name, def) => (e && name in e.attrs ? e.attrs[name] : def);

  // ===================================================================================
  // 3. Reading the file into "lines": {text, segs:[[text, Set(flags)]], images:[Img], table}
  // ===================================================================================
  class Img { constructor(data, ext, alt, inline) { this.data = data; this.ext = ext; this.alt = alt; this.inline = inline; } }
  const MARK = (k) => "\u0000IMG" + k + "\u0000";
  const MARK_RE_G = /\u0000IMG\d+\u0000/g;

  function flagsOf(rpr) {
    const f = new Set();
    if (!rpr) return f;
    const on = (tag) => { const e = child(rpr, "w:" + tag); return !!e && !["0", "false", "none"].includes(attr(e, "w:val", "true").toLowerCase()); };
    if (on("b")) f.add("bold");
    if (on("i")) f.add("italic");
    if (on("strike")) f.add("strike");
    const u = child(rpr, "w:u");
    if (u && attr(u, "w:val", "single") !== "none") f.add("underline");
    const h = child(rpr, "w:highlight");
    if (h && attr(h, "w:val", "none") !== "none") f.add("highlight");
    const s = child(rpr, "w:shd");
    if (s && !["AUTO", "FFFFFF", "", "NONE"].includes((attr(s, "w:fill") || "auto").toUpperCase())) f.add("highlight");
    const c = child(rpr, "w:color");
    if (c && !["AUTO", "000000", "262626", "1F1F1F", "222222"].includes((attr(c, "w:val") || "auto").toUpperCase())) f.add("colour:" + c.attrs["w:val"].toUpperCase());
    return f;
  }

  function normPath(p) {
    const out = [];
    for (const part of p.split("/")) { if (part === "" || part === ".") continue; if (part === "..") out.pop(); else out.push(part); }
    return out.join("/");
  }

  class Docx {
    constructor(files) {
      this.files = files;
      const rels = this._text("word/_rels/document.xml.rels");
      this.rels = new Map();
      for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
        const a = {}; for (const x of m[1].matchAll(/(\w+)="([^"]*)"/g)) a[x[1]] = x[2];
        this.rels.set(a.Id, a.Target || "");
      }
      this.num = this._numbering();
      this.styleNum = this._styleNumbering();
      this.counters = new Map();
    }
    static async load(buf) {
      const files = await unzip(buf);
      if (!files.has("word/document.xml")) throw new Error("This zip file is not a Word document (word/document.xml is missing).");
      return new Docx(files);
    }
    _text(name) { const f = this.files.get(name); if (!f) throw new Error("Missing " + name); return dec.decode(f); }

    _styleNumbering() {
      if (!this.files.has("word/styles.xml")) return new Map();
      const root = parseXML(this._text("word/styles.xml"));
      const direct = new Map(), based = new Map();
      for (const st of children(root, "w:style")) {
        const sid = attr(st, "w:styleId");
        const b = child(st, "w:basedOn"); if (b) based.set(sid, attr(b, "w:val"));
        const ppr = child(st, "w:pPr"); const np = ppr && child(ppr, "w:numPr");
        if (np) { const nid = child(np, "w:numId"), il = child(np, "w:ilvl"); direct.set(sid, [nid ? attr(nid, "w:val", null) : null, il ? parseInt(attr(il, "w:val", "0"), 10) : 0]); }
      }
      const out = new Map();
      for (const sid of new Set([...direct.keys(), ...based.keys()])) {
        let cur = sid, hops = 0;
        while (cur && !direct.has(cur) && hops < 10) { cur = based.get(cur); hops++; }
        if (direct.has(cur)) out.set(sid, direct.get(cur));
      }
      return out;
    }

    _numbering() {
      if (!this.files.has("word/numbering.xml")) return new Map();
      const root = parseXML(this._text("word/numbering.xml"));
      const absfmt = new Map();
      for (const an of children(root, "w:abstractNum")) {
        const lv = new Map();
        for (const l of children(an, "w:lvl")) {
          const fmt = child(l, "w:numFmt"), txt = child(l, "w:lvlText"), st = child(l, "w:start");
          lv.set(parseInt(attr(l, "w:ilvl"), 10), [fmt ? attr(fmt, "w:val") : "decimal", txt ? attr(txt, "w:val") : "%1.", st ? parseInt(attr(st, "w:val"), 10) : 1]);
        }
        absfmt.set(attr(an, "w:abstractNumId"), lv);
      }
      const out = new Map();
      for (const n of children(root, "w:num")) {
        const a = child(n, "w:abstractNumId");
        if (a) out.set(attr(n, "w:numId"), absfmt.get(attr(a, "w:val")) || new Map());
      }
      return out;
    }

    _autoNumber(p) {
      const ppr = child(p, "w:pPr"); if (!ppr) return "";
      const np = child(ppr, "w:numPr");
      let nid = null, il = 0;
      if (np) {
        const n_ = child(np, "w:numId"), l_ = child(np, "w:ilvl");
        nid = n_ ? attr(n_, "w:val", null) : null;
        il = l_ ? parseInt(attr(l_, "w:val", "0"), 10) : 0;
      }
      if (nid === null) {
        const ps = child(ppr, "w:pStyle");
        if (!ps || !this.styleNum.has(attr(ps, "w:val"))) return "";
        const [nid2, il2] = this.styleNum.get(attr(ps, "w:val"));
        nid = nid2; if (!np) il = il2;
      }
      if (!nid || nid === "0" || !this.num.has(nid)) return "";
      const [fmt, , start] = this.num.get(nid).get(il) || ["decimal", "%1.", 1];
      if (!this.counters.has(nid)) this.counters.set(nid, new Map());
      const c = this.counters.get(nid);
      c.set(il, (c.has(il) ? c.get(il) : start - 1) + 1);
      for (const k of [...c.keys()]) if (k > il) c.delete(k);
      const n = c.get(il);
      let s;
      if (fmt === "decimal") s = String(n);
      else if (fmt === "lowerLetter") s = "abcdefghij"[(n - 1) % 10];
      else if (fmt === "upperLetter") s = "ABCDEFGHIJ"[(n - 1) % 10];
      else if (fmt === "lowerRoman" || fmt === "upperRoman") s = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii"][(n - 1) % 8];
      else return "";                                   // bullets
      return fmt === "decimal" ? s + ". " : s + ") ";
    }

    _image(el, inlineCtx) {
      const blip = descendants(el, "a:blip").next().value;
      let rid = blip ? attr(blip, "r:embed", null) : null;
      if (rid === null) { const im = descendants(el, "v:imagedata").next().value; rid = im ? attr(im, "r:id", null) : null; }
      if (rid === null || !this.rels.has(rid)) return null;
      const tgt = this.rels.get(rid);
      const path = tgt.startsWith("/") ? tgt.replace(/^\/+/, "") : normPath("word/" + tgt);
      const data = this.files.get(path);
      if (!data) return null;
      const pr = descendants(el, "wp:docPr").next().value;
      let alt = "";
      if (pr) {
        alt = pr.attrs.descr || pr.attrs.title || "";
        const title = (pr.attrs.title || "").toLowerCase();
        if (title === "equation" || (pr.attrs.name || "").toLowerCase() === "equation") inlineCtx = true;
      }
      const dot = path.lastIndexOf(".");
      return new Img(data, dot >= 0 ? path.slice(dot).toLowerCase() : ".png", alt, inlineCtx);
    }

    _para(p) {
      const segs = [], imgs = [];
      const prefix = this._autoNumber(p);
      if (prefix) segs.push([prefix, new Set()]);
      const walk = (e) => {
        for (const ch of e.kids) {
          const t = ch.tag;
          if (t === "w:r") {
            const f = flagsOf(child(ch, "w:rPr"));
            for (const x of ch.kids) {
              if (x.tag === "w:t") segs.push([x.text || "", f]);
              else if (x.tag === "w:tab") segs.push(["\t", f]);
              else if (x.tag === "w:br" || x.tag === "w:cr") segs.push(["\n", new Set()]);
              else if (x.tag === "w:drawing" || x.tag === "w:pict" || x.tag === "w:object") {
                const im = this._image(x, false);
                if (im) { segs.push([MARK(imgs.length), f]); imgs.push(im); }
              }
            }
          } else if (t === "m:oMath" || t === "m:oMathPara") {
            segs.push([[...iter(ch, "m:t")].map((x) => x.text || "").join(""), new Set()]);
          } else if (["w:hyperlink", "w:smartTag", "w:ins", "w:sdt", "w:sdtContent", "w:fldSimple"].includes(t)) walk(ch);
        }
      };
      walk(p);
      return [segs, imgs];
    }

    blocks() {
      const root = parseXML(this._text("word/document.xml"));
      const body = child(root, "w:body");
      const out = [];
      const visit = (parent) => {
        for (const el of parent.kids) {
          if (el.tag === "w:p") {
            const [segs, imgs] = this._para(el);
            out.push(...splitLines(segs, imgs));
          } else if (el.tag === "w:tbl") {
            const rows = [], cellImgs = [];
            for (const tr of children(el, "w:tr")) {
              const row = [];
              for (const tc of children(tr, "w:tc")) {
                const parts = [];
                for (const p of iter(tc, "w:p")) {
                  const [segs, imgs] = this._para(p);
                  parts.push(segs.map((s) => s[0]).join("").replace(MARK_RE_G, "").trim());
                  for (const i of imgs) if (!i.inline) cellImgs.push(i);
                }
                row.push(parts.filter((x) => x).join(" "));
              }
              rows.push(row);
            }
            out.push({ table: rows, images: cellImgs, text: "", segs: [] });
          } else if (["w:sdt", "w:sdtContent", "w:customXml"].includes(el.tag)) visit(el);
        }
      };
      visit(body);
      return out;
    }
  }

  function splitLines(segs, imgs) {
    const lines = []; let cur = [];
    for (const [s, f] of segs) {
      const parts = s.split("\n");
      parts.forEach((part, k) => { if (k) { lines.push(cur); cur = []; } if (part) cur.push([part, f]); });
    }
    lines.push(cur);
    const out = [];
    for (const segl of lines) {
      const text = segl.map((s) => s[0]).join("");
      const ids = [...text.matchAll(/\u0000IMG(\d+)\u0000/g)].map((m) => parseInt(m[1], 10));
      out.push({ text, segs: segl, images: ids.map((i) => imgs[i]), table: null });
    }
    return out.filter((o) => o.text.trim() || o.images.length);
  }

  function textBlocks(raw) {
    raw = raw.replace(/^﻿/, "");
    const out = [];
    for (const line of raw.split(/\r\n|\r|\n/)) {
      if (!line.trim()) continue;
      const segs = [];
      for (const part of line.split(/(\*\*[^*]+\*\*|==[^=]+==)/)) {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) segs.push([part.slice(2, -2), new Set(["bold"])]);
        else if (part.startsWith("==") && part.endsWith("==") && part.length > 4) segs.push([part.slice(2, -2), new Set(["highlight"])]);
        else if (part) segs.push([part, new Set()]);
      }
      if (line.trimStart().startsWith("|") && line.trimEnd().endsWith("|")) {          // markdown table row
        const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        if (cells.filter((c) => c).every((c) => /^:?-{2,}:?$/.test(c))) continue;
        const last = out[out.length - 1];
        if (last && last.table && last.md) last.table.push(cells);
        else out.push({ table: [cells], images: [], text: "", segs: [], md: true });
        continue;
      }
      out.push({ text: segs.map((s) => s[0]).join(""), segs, images: [], table: null });
    }
    return out;
  }

  // ===================================================================================
  // 4. Patterns
  // ===================================================================================
  const Q_RE = /^\s*(?:Q(?:uestion)?\s*\.?\s*)?(\d{1,3})\s*(?:[.):\]]|\s-\s)\s*(.*)$/is;
  const OPT_RE = /^\s*(\[[xX ✓✔]?\]\s*)?(\*\s*)?\(?([A-Ha-h])\s*[).:\]]\s*(.*)$/s;
  const OPT_NUM_RE = /^\s*(\*\s*)?\(?([1-6])\s*\)\s*(.*)$/s;
  const INLINE_OPTS = /(?:(?<=\s)|^)\(?([A-Da-d])\s*[).]\s+/g;
  const ANS_RE = /^\s*(?:correct\s+answer|answer|ans|key|solution|correct)\s*[:=\-]\s*\(?\s*([A-Ha-h]|true|false|t|f)\b\)?\s*\.?\s*(.*)$/is;
  const FB_RE = /^\s*(?:feedback|explanation|reason|why)\s*[:\-]\s*(.+)$/is;
  const KEY_HEAD = /^\s*(?:answer\s*key|answers?|mark\s*scheme|marking\s*scheme|key|solutions?|memo)\b[\s:.\-–]*(?:\(.*\))?\s*$/i;
  const PTS_RE = /[(\[]\s*(\d+(?:\.\d+)?)\s*(?:pt|pts|point|points|mark|marks|m)\.?\s*[)\]]\s*\.?/i;
  const PTS_RE_G = new RegExp(PTS_RE.source, "gi");
  const RANGE_RE = /questions?\s+(\d{1,3})(?:\s*(?:-|–|—|to|and|&)\s*(\d{1,3}))?/i;
  const HEADING_RE = /^\s*(?:section|part|unit|chapter)\s+[A-Z0-9]+\b|^\s*(?:choose|circle|select|answer|write|read|instructions?|multiple\s+choice|long\s+response|short\s+answer|good\s+luck|name\s*:|date\s*:|class\s*:|grade\s*:|mark\s*:|score\s*:|time\s*:|duration\s*:|total\s*:|page\s+\d)/i;
  const TRUE_SET = new Set(["true", "t"]), FALSE_SET = new Set(["false", "f"]);
  const MARK_SUFFIX = /\s*(?:\*|✓|✔|\(correct\)|\[correct\]|<-+\s*correct|correct\s*$)\s*$/i;

  const clean = (t) => t.replace(MARK_RE_G, "").replace(/[ \t ]+/g, " ").trim();

  function segSlice(segs, start, end) {
    const out = []; let pos = 0;
    for (const [s, f] of segs) {
      const a = pos, b = pos + s.length, lo = Math.max(a, start), hi = Math.min(b, end);
      if (lo < hi) out.push([s.slice(lo - a, hi - a), f]);
      pos = b;
    }
    return out;
  }

  function dominantFlags(segs) {
    let tot = 0; for (const [s] of segs) tot += s.trim().length; tot = tot || 1;
    const count = new Map();
    for (const [s, f] of segs) { const n = s.trim().length; for (const x of f) count.set(x, (count.get(x) || 0) + n); }
    const r = new Set();
    for (const [x, n] of count) if (n / tot >= 0.6 && x !== "italic") r.add(x);
    return r;
  }

  function texFromAlt(alt) {
    alt = alt.trim();
    if (!alt) return "";
    if (/\\[a-zA-Z]+|[_^{}]/.test(alt)) return "\\(" + alt + "\\)";
    return alt;
  }

  function lineText(line) {
    let t = line.text;
    line.images.forEach((im, k) => {
      let rep = "";
      if (im.inline || (im.alt && /\\[a-zA-Z]+|[_^]/.test(im.alt))) { rep = " " + texFromAlt(im.alt) + " "; im.inline = true; }
      t = t.replace(MARK(k), () => rep);
    });
    return t;
  }

  // ===================================================================================
  // 5. Key parsing (text pairs and answer-grid tables)
  // ===================================================================================
  const PAIR_RE = /(?<![\d.])(\d{1,3})\s*[.):\-–=]?\s*\(?\s*(true|false|[A-Ha-h]|[Tt])\s*\)?(?![A-Za-z])/gi;

  function pairsFromText(t) {
    t = t.replace(/\b[Qq](?=\d)/g, "");
    return [...t.matchAll(PAIR_RE)].map((m) => [parseInt(m[1], 10), m[2]]);
  }

  function pairsFromTable(rows) {
    const found = [];
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      const nums = a.map((c) => c.trim());
      if (nums.filter((c) => /^\d{1,3}$/.test(c)).length >= 2) {
        for (let k = 0; k < Math.min(nums.length, b.length); k++) {
          const n = nums[k], v = b[k].trim();
          if (/^\d{1,3}$/.test(n) && /^(?:[A-H]|true|false|T|F)$/i.test(v)) found.push([parseInt(n, 10), v]);
        }
      }
    }
    for (const r of rows) {
      if (r.length >= 2) {
        const n = r[0].trim().replace(/^q/i, ""), v = r[1].trim();
        const m = /^\(?([A-H]|true|false|T|F)\)?\b.*$/i.exec(v);
        if (/^\d{1,3}$/.test(n) && m && (v.length <= 6 || ["true", "false"].includes(v.toLowerCase()))) found.push([parseInt(n, 10), m[1]]);
      }
    }
    return found;
  }

  function modelFromText(lines) {
    const out = {};
    for (const ln of lines) {
      const m = /^\s*(?:Q\s*)?(\d{1,3})\s*(?:[.):]|(?=\())\s*(.{12,})$/s.exec(ln);
      if (m && !/^\(?[A-Ha-h]\)?\b.*$/s.test(m[2].trim().slice(0, 3))) out[parseInt(m[1], 10)] = m[2].trim();
    }
    return out;
  }

  function firstWins(pairs) { const key = {}; for (const [n, v] of pairs) if (!(n in key)) key[n] = v; return key; }

  /** The key given as a file (already read into blocks). */
  function readKeyBlocks(blocks) {
    const pairs = [], texts = [];
    for (const b of blocks) {
      if (b.table) { pairs.push(...pairsFromTable(b.table)); texts.push(...b.table.map((r) => r.join(" "))); }
      else texts.push(clean(b.text));
    }
    if (!pairs.length) for (const t of texts) pairs.push(...pairsFromText(t));
    return [firstWins(pairs), modelFromText(texts)];
  }

  /** The key typed in a box: "B C A D" or "1B 2C 3A". */
  function readKeyString(s) {
    s = (s || "").trim();
    if (!s) return [{}, {}];
    if (/\d/.test(s)) return [firstWinsLast(pairsFromText(s)), {}];
    const letters = s.replace(/,/g, " ").match(/true|false|[A-H]/gi) || [];
    const key = {}; letters.forEach((v, i) => { key[i + 1] = v; });
    return [key, {}];
  }
  function firstWinsLast(pairs) { const k = {}; for (const [n, v] of pairs) k[n] = v; return k; }   // dict comprehension: last wins

  // ===================================================================================
  // 6. Parse blocks into questions
  // ===================================================================================
  function curExpectsNumeric(q) { return !q.opts.length && q.stem.length > 0; }

  function splitInlineOptions(text, requireStart = true) {
    const ms = [...text.matchAll(INLINE_OPTS)];
    if (ms.length < 2) return [text, []];
    const seq = []; let exp = requireStart ? 0 : 1;
    for (const m of ms) {
      if (exp < 4 && m[1].toLowerCase() === "abcd"[exp]) { seq.push(m); exp++; }
    }
    if (seq.length < 2) return [text, []];
    const end = (m) => m.index + m[0].length;
    const parts = seq.map((m, i) => text.slice(end(m), i + 1 < seq.length ? seq[i + 1].index : text.length).trim());
    if (requireStart) return [text.slice(0, seq[0].index).trim(), parts];
    const first = text.slice(0, seq[0].index).trim();
    if (seq[0][1].toLowerCase() !== "b") return [text, []];
    return [first, parts];
  }

  function parse(blocks, notes) {
    const qs = new Map(); let order = [];
    let cur = null;
    const pending = { text: [], images: [], table: null, range: null };
    const shared = [];
    let keyMode = false;
    const keyPairs = [], keyTexts = [];
    let title = null;

    const newQ = (n, first) => ({ n, stem: first ? [first] : [], opts: [], optSegs: [], optMarked: [], answer: null, ansSrc: null, feedback: "", images: [], points: null, tables: [] });
    const finishPendingTo = (q) => {
      if (pending.text.length) q.stem = pending.text.concat(q.stem);
      q.images = pending.images.concat(q.images);
      if (pending.table) q.tables.unshift(pending.table);
      pending.text = []; pending.images = []; pending.table = null;
    };
    const addOption = (q, txt, segs, marked = false) => {
      if (MARK_SUFFIX.test(txt)) { marked = true; txt = txt.replace(MARK_SUFFIX, ""); }
      q.opts.push(clean(txt)); q.optSegs.push(segs); q.optMarked.push(marked);
    };

    for (const b of blocks) {
      // ---------- tables ----------
      if (b.table) {
        const rows = b.table;
        if (keyMode) { keyPairs.push(...pairsFromTable(rows)); keyTexts.push(...rows.map((r) => r.join(" "))); continue; }
        const flat = rows.flat().filter((c) => c.trim());
        if (!flat.length) continue;
        const numeric = flat.filter((c) => /^\d{1,3}$/.test(c.trim())).length;
        const tp = pairsFromTable(rows);
        if (tp.length && tp.length >= 3 && cur !== null) { keyPairs.push(...tp); continue; }
        if (numeric >= 0.6 * flat.length) continue;
        if (cur === null && !qs.size) {
          for (const c of flat) if (/quiz|test|homework|exam|assessment|worksheet/i.test(c) && !title) title = c.replace(/\s+/g, " ").trim();
          continue;
        }
        const ttxt = "Table: " + rows.map((r) => r.join(" | ")).join(" / ");
        if (pending.range) { shared.push([pending.range[0], pending.range[1], ttxt, b.images.length ? b.images : null]); continue; }
        if (b.images.length) pending.images.push(...b.images);
        if (cur !== null && !cur.opts.length && !pending.text.length) cur.tables.push(ttxt);
        else pending.table = ttxt;
        continue;
      }

      const raw = lineText(b);
      const t = clean(raw);
      const figs = b.images.filter((im) => !im.inline);
      if (!t && figs.length) {
        if (pending.range) shared.push([pending.range[0], pending.range[1], null, figs]);
        else if (cur !== null && !cur.opts.length && !pending.text.length) cur.images.push(...figs);
        else pending.images.push(...figs);
        continue;
      }
      if (!t) continue;

      // ---------- answer-key section ----------
      if (KEY_HEAD.test(t) && t.length < 40) { keyMode = true; continue; }
      if (keyMode) { keyPairs.push(...pairsFromText(t)); keyTexts.push(t); continue; }

      // ---------- answer / feedback line for the current question ----------
      let m = ANS_RE.exec(t);
      if (m && cur !== null) {
        cur.answer = m[1]; cur.ansSrc = "Answer: line";
        if (m[2].trim() && !cur.opts.length) cur.model = m[2].trim();
        continue;
      }
      m = FB_RE.exec(t);
      if (m && cur !== null) { cur.feedback = clean(m[1]); continue; }

      // ---------- new question ----------
      m = Q_RE.exec(t);
      if (m && !(cur !== null && cur.opts.length === 0 && OPT_NUM_RE.test(t) && curExpectsNumeric(cur))) {
        const n0 = parseInt(m[1], 10);
        if (n0 === 0 || n0 > 300) m = null;
      }
      if (m) {
        const n = parseInt(m[1], 10), rest = clean(m[2]);
        const [stem, inl] = splitInlineOptions(rest);
        const q = newQ(n, stem);
        q.images.push(...figs);
        for (const [lo, hi, txt, ims] of shared) {
          if (lo <= n && n <= hi) { if (txt) q.stem.unshift(txt); if (ims) q.images = ims.concat(q.images); }
        }
        if (pending.range && pending.range[0] <= n && n <= pending.range[1]) { /* applied through `shared` */ }
        else finishPendingTo(q);
        pending.range = null;
        pending.text = []; pending.images = []; pending.table = null;
        for (const o of inl) addOption(q, o, [[o, new Set()]]);
        if (qs.has(n)) {
          const old = qs.get(n);
          notes.push(`Q${n} appears twice; keeping the version with more detail.`);
          const weight = (x) => { const body = x.stem.join(" ").replace(/[_.…\s]/g, ""); return [x.opts.length, body.length >= 15 ? 1 : 0, body.length]; };
          const wo = weight(old), wq = weight(q);
          let oldBigger = false;
          for (let i = 0; i < 3; i++) { if (wo[i] !== wq[i]) { oldBigger = wo[i] > wq[i]; break; } }
          if (oldBigger) { cur = old; continue; }
          order = order.filter((x) => x !== n);
        }
        qs.set(n, q); order.push(n); cur = q;
        continue;
      }

      // ---------- option ----------
      if (cur !== null) {
        const mo = OPT_RE.exec(t);
        if (mo && (cur.opts.length > 0 || mo[3].toLowerCase() === "a" || cur.stem.length)) {
          const letterOk = LET.indexOf(mo[3].toUpperCase()) === cur.opts.length || cur.opts.length === 0;
          if (letterOk) {
            const [first, more] = splitInlineOptions(mo[4], false);
            let start = mo[4] ? raw.indexOf(mo[4].slice(0, 20)) : raw.length;
            start = Math.max(start, 0);
            const segs = more.length === 0 ? segSlice(b.segs, start, start + first.length + 1) : [[first, new Set()]];
            const marked = !!(mo[1] && mo[1].replace(/^[\[\] ]+|[\[\] ]+$/g, "")) || !!mo[2];
            addOption(cur, first, segs, marked);
            for (const o of more) addOption(cur, o, [[o, new Set()]]);
            continue;
          }
        }
        const mn = OPT_NUM_RE.exec(t);
        if (mn && curExpectsNumeric(cur) && parseInt(mn[2], 10) === cur.opts.length + 1) {
          let start = mn[3] ? raw.indexOf(mn[3].slice(0, 20)) : raw.length;
          start = Math.max(start, 0);
          addOption(cur, mn[3], segSlice(b.segs, start, start + mn[3].length + 1), !!mn[1]);
          continue;
        }
      }

      // ---------- headings, stimulus, stem continuation ----------
      const rg = RANGE_RE.exec(t);
      if (rg) {
        const lo = parseInt(rg[1], 10), hi = parseInt(rg[2] || rg[1], 10);
        const txt = /^\s*(use|look at|refer to|read)\b/i.test(t) ? null : t;
        pending.range = [lo, hi];
        shared.push([lo, hi, txt, pending.images.length ? pending.images.slice() : null]);
        if (pending.table) { shared.push([lo, hi, pending.table, null]); pending.table = null; }
        continue;
      }
      if (HEADING_RE.test(t) && t.length < 120) continue;
      if (pending.range) { shared.push([pending.range[0], pending.range[1], t, figs.length ? figs : null]); continue; }
      if (!qs.size && cur === null) {
        if (!title && /quiz|test|homework|exam|assessment/i.test(t) && t.length < 90) title = t;
        continue;
      }
      if (cur !== null && !cur.opts.length && !pending.text.length && !pending.images.length) {
        if (figs.length) cur.images.push(...figs);
        cur.stem.push(t); continue;
      }
      if (figs.length) pending.images.push(...figs);
      pending.text.push(t);
    }

    const key = firstWins(keyPairs);
    const models = modelFromText(keyTexts);
    return [order.slice().sort((a, b) => a - b).map((n) => qs.get(n)), key, models, title];
  }

  // ===================================================================================
  // 7. Decide type, answer, points
  // ===================================================================================
  function finalise(qs, key, keyModels, docKey, docModels, defaultPoints, notes) {
    const out = [];
    for (const q of qs) {
      const n = q.n;
      let stem = q.stem.filter((s) => s).join(" ");
      let pts = defaultPoints;
      const m = PTS_RE.exec(stem);
      if (m) { pts = parseFloat(m[1]); stem = stem.replace(PTS_RE_G, "").trim(); }
      stem = stem.replace(/\s+/g, " ").trim();
      if (q.tables.length) stem = stem + " (" + q.tables.join(" ; ") + ")";
      const opts = q.opts.slice();
      const item = { n, text: stem, points: pts, images: q.images, feedback: q.feedback };
      const tfOpts = opts.length === 2 && new Set(opts.map((o) => o.toLowerCase().replace(/\.+$/, ""))).size === 2 && opts.every((o) => ["true", "false"].includes(o.toLowerCase().replace(/\.+$/, "")));
      const tfStem = !opts.length && /\btrue\s+or\s+false\b|\(T\s*\/\s*F\)|\bT\s*\/\s*F\b/i.test(stem);
      let ans = null, src = null;
      for (const [source, val] of [["key box / key file", key[n]], ["answer key in the quiz", docKey[n]], ["Answer: line", q.answer]]) {
        if (val) { ans = val; src = source; break; }
      }
      if (ans === null && opts.length) {
        const marked = []; q.optMarked.forEach((mk, i) => { if (mk) marked.push(i); });
        if (marked.length === 1) { ans = LET[marked[0]]; src = "marked option (* / ✓ / correct)"; }
        else {
          const fl = q.optSegs.map(dominantFlags);
          const uniq = [];
          fl.forEach((f, i) => {
            const others = fl.length > 1 ? setUnion(fl.filter((_, j) => j !== i)) : new Set();
            if (setDiff(f, others).size) uniq.push(i);
          });
          if (uniq.length === 1) {
            const u = uniq[0];
            ans = LET[u];
            src = "formatting (" + [...setDiff(fl[u], setUnion(fl.filter((_, j) => j !== u)))].sort().join(", ") + ")";
          }
        }
      }
      if (opts.length && !tfOpts) {
        item.type = "mc"; item.options = opts;
        if (ans !== null) {
          const a = ans.trim().toLowerCase();
          let idx;
          if (TRUE_SET.has(a) || FALSE_SET.has(a)) {
            const want = TRUE_SET.has(a) ? "true" : "false";
            idx = opts.findIndex((o) => o.toLowerCase().replace(/\.+$/, "") === want);
            if (idx < 0) idx = null;
          } else idx = LET.includes(a.toUpperCase()) && a.length === 1 ? LET.indexOf(a.toUpperCase()) : null;
          if (idx === null || idx >= opts.length) { notes.push(`Q${n}: answer '${ans}' does not match its ${opts.length} options.`); idx = null; }
          item.correct = idx; item.ansSrc = src;
        } else { item.correct = null; item.ansSrc = null; }
        if (opts.length < 2) notes.push(`Q${n}: only ${opts.length} option found.`);
      } else if (tfOpts || tfStem) {
        item.type = "tf";
        let val = null;
        if (ans !== null) {
          const a = ans.trim().toLowerCase();
          if (TRUE_SET.has(a)) val = true;
          else if (FALSE_SET.has(a)) val = false;
          else if (tfOpts && LET.slice(0, 2).includes(a.toUpperCase()) && a.length === 1) val = opts[LET.indexOf(a.toUpperCase())].toLowerCase().startsWith("t");
        }
        if (val === null && tfOpts && q.optMarked.filter((x) => x).length === 1) { val = opts[q.optMarked.indexOf(true)].toLowerCase().startsWith("t"); src = "marked option"; }
        item.correct = val; item.ansSrc = val !== null ? src : null;
      } else {
        item.type = "essay";
        item.model = keyModels[n] || docModels[n] || q.model || "";
        item.ansSrc = "hand-marked" + (item.model ? " (model answer attached)" : "");
      }
      out.push(item);
    }
    return out;
  }

  // ===================================================================================
  // 8. LaTeX -> readable Unicode text (Schoology shows imported LaTeX as raw code)
  // ===================================================================================
  const zipMap = (keys, vals) => { const m = {}; const v = [...vals]; [...keys].forEach((k, i) => { m[k] = v[i]; }); return m; };
  const SUP = zipMap("0123456789+-=()nixyabk", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱˣʸᵃᵇᵏ");
  const SUB = zipMap("0123456789+-=()aeoxhklmnpstij", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜᵢⱼ");
  const SYM = {
    times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", propto: "∝", approx: "≈", neq: "≠", ne: "≠",
    leq: "≤", le: "≤", geq: "≥", ge: "≥", Rightarrow: "⇒", rightarrow: "→", to: "→", leftarrow: "←",
    infty: "∞", degree: "°", circ: "°", angle: "∠", triangle: "△", cong: "≅", parallel: "∥", perp: "⊥",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", theta: "θ", lambda: "λ",
    mu: "μ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ",
    Omega: "Ω", Phi: "Φ", Gamma: "Γ", Lambda: "Λ", Pi: "Π", Theta: "Θ", nabla: "∇", partial: "∂",
    quad: "  ", qquad: "    ", ",": " ", ";": " ", ":": " ", "!": "", " ": " ", "%": "%", "$": "$", ldots: "…", dots: "…",
    left: "", right: "", displaystyle: "", big: "", Big: "", bigl: "", bigr: "",
  };
  const hasSym = (k) => Object.prototype.hasOwnProperty.call(SYM, k);
  const SMALL = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱˣʸᵃᵇᵏ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜᵢⱼ";
  const SMALL_RE = new RegExp("[" + SMALL + "]", "g");
  const WRAP_RE = new RegExp("^[A-Za-zα-ωΑ-Ω0-9." + SMALL + " ]+$");

  function group(s, i) {
    while (i < s.length && s[i] === " ") i++;
    if (i >= s.length) return ["", i];
    if (s[i] === "{") {
      let depth = 0, j = i;
      while (j < s.length) {
        if (s[j] === "{") depth++;
        else if (s[j] === "}") { depth--; if (depth === 0) return [s.slice(i + 1, j), j + 1]; }
        j++;
      }
      return [s.slice(i + 1), s.length];
    }
    if (s[i] === "\\") {
      const m = /^\\([A-Za-z]+|.)/s.exec(s.slice(i));
      if (m) return [m[0], i + m[0].length];
    }
    return [s[i], i + 1];
  }

  function script(txt, table, mark) {
    const t = latexToText(txt);
    if (["°", "′", "″", "*"].includes(t)) return t;
    if ([...t].every((c) => Object.prototype.hasOwnProperty.call(table, c))) return [...t].map((c) => table[c]).join("");
    return mark + (t.length > 1 ? "(" + t + ")" : t);
  }

  function balanced(t) {
    if (!(t.startsWith("(") && t.endsWith(")"))) return false;
    let d = 0;
    for (let k = 0; k < t.length; k++) {
      if (t[k] === "(") d++; else if (t[k] === ")") d--;
      if (d === 0 && k < t.length - 1) return false;
    }
    return true;
  }

  function wrap(t, den = false) {
    t = t.trim();
    if (balanced(t)) return t;
    if (WRAP_RE.test(t) && !/\d\s+\d/.test(t)) {
      t = t.replace(/ /g, "");
      const core = t.replace(SMALL_RE, "");
      if (den && core.length > 1 && !/^[\d.]+$/.test(core)) return "(" + t + ")";
      return t;
    }
    if (/^(?:[√∛∜]\(.*\)|[√∛∜][\p{L}\p{N}_.]+)$/su.test(t)) return t;
    return /[\s+\-−×·/]/.test(t) ? "(" + t + ")" : t;
  }

  function latexToText(s) {
    const out = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === "\\") {
        const m = /^\\([A-Za-z]+|.)/s.exec(s.slice(i));
        if (!m) { out.push("\\"); i++; continue; }
        const name = m[1]; i += m[0].length;
        if (/^[A-Za-z]+$/.test(name)) while (i < s.length && s[i] === " ") i++;
        if (name === "frac" || name === "dfrac" || name === "tfrac") {
          let a, b; [a, i] = group(s, i); [b, i] = group(s, i);
          out.push(" " + wrap(latexToText(a)) + "/" + wrap(latexToText(b), true) + " ");
        } else if (name === "sqrt") {
          let n = "";
          if (i < s.length && s[i] === "[") { const j = s.indexOf("]", i); if (j > 0) { n = s.slice(i + 1, j); i = j + 1; } }
          let a; [a, i] = group(s, i);
          const root = { "3": "∛", "4": "∜" }[n.trim()] || "√";
          const inner = latexToText(a);
          out.push(root + (/^[\p{L}\p{N}_.]+$/u.test(inner) ? inner : "(" + inner + ")"));
        } else if (["mathrm", "text", "textrm", "mathbf", "mathit", "operatorname", "mbox", "vec", "bar", "hat", "overline"].includes(name)) {
          let a; [a, i] = group(s, i);
          const t = latexToText(a);
          out.push(t + (name === "vec" && [...t].length === 1 ? "⃗" : ""));
        } else if (hasSym(name)) out.push(SYM[name]);
        else out.push(name);
      } else if (c === "^") { let a; [a, i] = group(s, i + 1); out.push(script(a, SUP, "^")); }
      else if (c === "_") { let a; [a, i] = group(s, i + 1); out.push(script(a, SUB, "_")); }
      else if (c === "{" || c === "}") i++;
      else if (c === "~") { out.push(" "); i++; }
      else { out.push(c); i++; }
    }
    let t = out.join("");
    t = t.replace(/\s+/g, " ");
    t = t.replace(/\s*([=≈≤≥<>⇒→∝×±])\s*/g, " $1 ");
    t = t.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
    return t.replace(/ +/g, " ").trim();
  }

  function plainMaths(text) {
    if (!text) return text;
    const f = (_, g) => latexToText(g);
    text = text.replace(/\\\((.+?)\\\)/gs, f);
    text = text.replace(/\\\[(.+?)\\\]/gs, f);
    text = text.replace(/\$\$(.+?)\$\$/gs, f);
    text = text.replace(/(?<![\w$])\$([^$\n]+?)\$(?![\w$])/g, f);
    return text.replace(/[ \t]+/g, " ").trim();
  }

  // ===================================================================================
  // 9. Balanced shuffle (Python's random.Random(seed): same seed -> same order as quiz2bb.py)
  // ===================================================================================
  class PyRandom {
    constructor(seed) {
      this.mt = new Uint32Array(624); this.idx = 624;
      let n = Math.abs(Math.trunc(seed)); const key = [];
      do { key.push(n % 4294967296); n = Math.floor(n / 4294967296); } while (n > 0);
      this._initByArray(key);
    }
    _initGenrand(s) {
      const mt = this.mt; mt[0] = s >>> 0;
      for (let i = 1; i < 624; i++) mt[i] = (Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i) >>> 0;
    }
    _initByArray(key) {
      const mt = this.mt; this._initGenrand(19650218);
      let i = 1, j = 0;
      for (let k = Math.max(624, key.length); k; k--) {
        mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
        i++; j++; if (i >= 624) { mt[0] = mt[623]; i = 1; } if (j >= key.length) j = 0;
      }
      for (let k = 623; k; k--) {
        mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i) >>> 0;
        i++; if (i >= 624) { mt[0] = mt[623]; i = 1; }
      }
      mt[0] = 0x80000000; this.idx = 624;
    }
    _next() {
      const mt = this.mt;
      if (this.idx >= 624) {
        let kk = 0, y;
        for (; kk < 624 - 397; kk++) { y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff); mt[kk] = mt[kk + 397] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0); }
        for (; kk < 623; kk++) { y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff); mt[kk] = mt[kk + (397 - 624)] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0); }
        y = (mt[623] & 0x80000000) | (mt[0] & 0x7fffffff); mt[623] = mt[396] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
        this.idx = 0;
      }
      let y = mt[this.idx++];
      y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18;
      return y >>> 0;
    }
    randbelow(n) {
      if (!n) return 0;
      const k = 32 - Math.clz32(n);
      let r = this._next() >>> (32 - k);
      while (r >= n) r = this._next() >>> (32 - k);
      return r;
    }
    shuffle(x) { for (let i = x.length - 1; i >= 1; i--) { const j = this.randbelow(i + 1); const t = x[i]; x[i] = x[j]; x[j] = t; } }
  }

  function rebalance(qs, seed) {
    const rng = new PyRandom(seed);
    const mcs = qs.filter((q) => q.type === "mc" && q.correct !== null && q.correct !== undefined);
    if (!mcs.length) return;
    const k = Math.min(...mcs.map((q) => q.options.length));
    const pool = mcs.map((_, i) => i % k);
    for (let tries = 0; tries < 5000; tries++) {
      rng.shuffle(pool);
      let ok = true;
      for (let i = 2; i < pool.length; i++) if (pool[i] === pool[i - 1] && pool[i - 1] === pool[i - 2]) { ok = false; break; }
      if (ok) break;
    }
    mcs.forEach((q, i) => {
      const t = pool[i], opts = q.options, c = q.correct;
      const right = opts[c], others = opts.slice(0, c).concat(opts.slice(c + 1));
      q.options = others.slice(0, t).concat([right], others.slice(t));
      q.correct = t;
    });
  }

  // ===================================================================================
  // 10. Blackboard package
  // ===================================================================================
  const ftHtml = (raw) => '<material><mat_extension><mat_formattedtext type="HTML">' + pyEscape(raw) + "</mat_formattedtext></mat_extension></material>";
  const ft = (text) => ftHtml("<p>" + pyEscape(text) + "</p>");
  const fx = (v) => Number(v).toFixed(1);

  function meta(tag, oid, asitype, qtype, maxscore) {
    return `<${tag}><bbmd_asi_object_id>${oid}</bbmd_asi_object_id><bbmd_asitype>${asitype}</bbmd_asitype>` +
      `<bbmd_assessmenttype>Test</bbmd_assessmenttype><bbmd_sectiontype>Subsection</bbmd_sectiontype>` +
      `<bbmd_questiontype>${qtype}</bbmd_questiontype><bbmd_is_from_cartridge>false</bbmd_is_from_cartridge>` +
      `<bbmd_is_disabled>false</bbmd_is_disabled><bbmd_negative_points_ind>N</bbmd_negative_points_ind>` +
      `<bbmd_canvas_fullcrdt_ind>false</bbmd_canvas_fullcrdt_ind><bbmd_all_fullcredit_ind>false</bbmd_all_fullcredit_ind>` +
      `<bbmd_numbertype>letter_upper</bbmd_numbertype><bbmd_partialcredit>false</bbmd_partialcredit>` +
      `<bbmd_orientationtype>vertical</bbmd_orientationtype><bbmd_is_extracredit>false</bbmd_is_extracredit>` +
      `<qmd_absolutescore_max>${fx(maxscore)}</qmd_absolutescore_max><qmd_weighting>0</qmd_weighting>` +
      `<qmd_instructornotes></qmd_instructornotes></${tag}>`;
  }

  const fbBlock = (ident, text) => `<itemfeedback ident="${ident}" view="All"><flow_mat class="Block"><flow_mat class="FORMATTED_TEXT_BLOCK">` + ft(text) + "</flow_mat></flow_mat></itemfeedback>";
  const dotExt = (name) => { const d = name.lastIndexOf("."); return d >= 0 ? name.slice(d) : ""; };
  const noExt = (name) => { const d = name.lastIndexOf("."); return d >= 0 ? name.slice(0, d) : name; };

  /** Returns {files: [{name,data}], total, nfig, items} - the contents of the Blackboard package. */
  function buildBlackboard(qs, title, instr, packFigures = true) {
    const extra = [];
    const items = [];
    qs.forEach((q, i) => {
      const n = i + 1;
      const pts = Number(q.points === undefined ? 1 : q.points);
      let figs = "";
      if (packFigures) {
        (q.figFiles || []).forEach(([name, data], k) => {
          const ext = dotExt(name).toLowerCase();
          const xid = "9" + String(n).padStart(3, "0") + String(k).padStart(2, "0");
          extra.push({ name: `csfiles/home_dir/${noExt(name)}__xid-${xid}_1${ext}`, data });
          const alt = pyEscape(`Figure for question ${n}`);
          figs += `<p><img src="@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-${xid}_1" alt="${alt}" style="max-width:100%;height:auto;" /></p>`;
        });
      }
      const stem = ftHtml("<p>" + pyEscape(q.text) + "</p>" + figs);
      const q2 = q.type === "tf" ? Object.assign({}, q, { type: "mc", options: ["True", "False"], correct: q.correct ? 0 : 1 }) : q;
      let o;
      if (q2.type === "mc") {
        const ids = q2.options.map((_, k) => `q${n}_a${k}`);
        const c = q2.correct !== null && q2.correct !== undefined ? q2.correct : 0;
        o = [`<item title="Question ${n}" maxattempts="0">`, meta("itemmetadata", `_${100 + n}_1`, "Item", q.type === "tf" ? "True/False" : "Multiple Choice", pts),
          '<presentation><flow class="Block"><flow class="QUESTION_BLOCK"><flow class="FORMATTED_TEXT_BLOCK">', stem,
          '</flow></flow><flow class="RESPONSE_BLOCK"><response_lid ident="response" rcardinality="Single" rtiming="No"><render_choice shuffle="No" minnumber="0" maxnumber="0">'];
        ids.forEach((ident, k) => o.push(`<flow_label class="Block"><response_label ident="${ident}" shuffle="Yes" rarea="Ellipse" rrange="Exact"><flow_mat class="FORMATTED_TEXT_BLOCK">${ft(q2.options[k])}</flow_mat></response_label></flow_label>`));
        o.push("</render_choice></response_lid></flow></flow></presentation>");
        o.push('<resprocessing scoremodel="SumOfScores"><outcomes>' +
          `<decvar varname="SCORE" vartype="Decimal" defaultval="0.0" minvalue="0.0" maxvalue="${fx(pts)}"/></outcomes>` +
          `<respcondition title="correct"><conditionvar><varequal respident="response" case="No">${ids[c]}</varequal></conditionvar>` +
          '<setvar variablename="SCORE" action="Set">SCORE.max</setvar><displayfeedback linkrefid="correct" feedbacktype="Response"/></respcondition>' +
          '<respcondition title="incorrect"><conditionvar><other/></conditionvar><setvar variablename="SCORE" action="Set">0.0</setvar>' +
          '<displayfeedback linkrefid="incorrect" feedbacktype="Response"/></respcondition>');
        ids.forEach((ident, k) => o.push(`<respcondition><conditionvar><varequal respident="${ident}" case="No"/></conditionvar>` +
          `<setvar variablename="SCORE" action="Set">${k === c ? "100" : "0"}</setvar><displayfeedback linkrefid="${ident}" feedbacktype="Response"/></respcondition>`));
        o.push("</resprocessing>");
        const fb = q.feedback || "";
        o.push(fbBlock("correct", ("Correct. " + fb).trim())); o.push(fbBlock("incorrect", ("Not quite. " + fb).trim()));
        for (const ident of ids) o.push(`<itemfeedback ident="${ident}" view="All"><solution view="All" feedbackstyle="Complete"><solutionmaterial><flow_mat class="Block">${ft("")}</flow_mat></solutionmaterial></solution></itemfeedback>`);
      } else {
        o = [`<item title="Question ${n}" maxattempts="0">`, meta("itemmetadata", `_${100 + n}_1`, "Item", "Essay", pts),
          '<presentation><flow class="Block"><flow class="QUESTION_BLOCK"><flow class="FORMATTED_TEXT_BLOCK">', stem,
          '</flow></flow><flow class="RESPONSE_BLOCK"><response_str ident="response" rcardinality="Single" rtiming="No">' +
          '<render_fib charset="us-ascii" encoding="UTF_8" rows="8" columns="127" maxchars="0" prompt="Box" fibtype="String" minnumber="0" maxnumber="0"/></response_str></flow></flow></presentation>',
          '<resprocessing scoremodel="SumOfScores"><outcomes>' +
          `<decvar varname="SCORE" vartype="Decimal" defaultval="0.0" minvalue="0.0" maxvalue="${fx(pts)}"/></outcomes></resprocessing>`,
          fbBlock("correct", ""), fbBlock("incorrect", ""),
          '<itemfeedback ident="solution" view="All"><solution view="All" feedbackstyle="Complete">' +
          `<solutionmaterial><flow_mat class="Block">${ft(q.model || "")}</flow_mat></solutionmaterial></solution></itemfeedback>`];
      }
      o.push("</item>");
      items.push(o.join("\n"));
    });
    const total = qs.reduce((a, q) => a + Number(q.points === undefined ? 1 : q.points), 0);
    const dat = '<?xml version="1.0" encoding="UTF-8"?>\n<questestinterop><assessment title="' + pyEscape(title) + '">' +
      meta("assessmentmetadata", "_100_1", "Assessment", "Multiple Choice", total) +
      `<rubric view="All"><flow_mat class="Block">${ft(instr)}</flow_mat></rubric>` +
      `<presentation_material><flow_mat class="Block">${ft(instr)}</flow_mat></presentation_material><section>` +
      meta("sectionmetadata", "_100_2", "Section", "Multiple Choice", total) + "\n" + items.join("\n") + "\n</section></assessment></questestinterop>\n";
    const filesXml = extra.map((e) => `<file href="${pyEscape(e.name)}"/>`).join("");
    const manifest = '<?xml version="1.0" encoding="UTF-8"?>\n<manifest identifier="man00001" xmlns:bb="http://www.blackboard.com/content-packaging/">' +
      `<organizations/><resources><resource bb:file="res00001.dat" bb:title="${pyEscape(title)}" identifier="res00001" ` +
      `type="assessment/x-bb-qti-test" xml:base="res00001">${filesXml}</resource></resources></manifest>\n`;
    // self-check: both XML files must be well-formed and hold every question
    const datRoot = parseXML(dat); parseXML(manifest);
    const nItems = [...iter(datRoot, "item")].length;
    if (nItems !== qs.length) throw new Error(`Internal check failed: ${nItems} items in the package for ${qs.length} questions.`);
    const files = [{ name: "imsmanifest.xml", data: manifest }, { name: "res00001.dat", data: dat }, { name: ".bb-package-info", data: "cx.package.info.version=6.0\n" }, ...extra];
    return { files, total, nfig: extra.length, items: nItems };
  }

  // ===================================================================================
  // 11. Analyse (read + check) and build outputs
  // ===================================================================================
  function stripExt(name) { return noExt(name.replace(/^.*[\\/]/, "")); }

  /**
   * opts: {fileName, blocks, keyBlocks?, keyText?, title?, points?, keepLatex?, shuffle?, seed?}
   * Returns everything the page needs: questions (in zip order), notes, report, missing list...
   */
  function analyse(opts) {
    const notes = [];
    const points = opts.points == null || isNaN(opts.points) ? 1 : Number(opts.points);
    const [rawQs, docKey, docModels, foundTitle] = parse(opts.blocks, notes);
    if (!rawQs.length) throw new Error("No numbered questions found. Questions must start with a number, e.g. '1.' or 'Q1'.");
    let key = {}, keyModels = {};
    const hasKeyText = !!(opts.keyText && opts.keyText.trim());
    if (hasKeyText) [key, keyModels] = readKeyString(opts.keyText);
    else if (opts.keyBlocks) [key, keyModels] = readKeyBlocks(opts.keyBlocks);
    if ((hasKeyText || opts.keyBlocks) && !Object.keys(key).length && !Object.keys(keyModels).length) notes.push("A key was given but no answers could be read from it.");
    const qs = finalise(rawQs, key, keyModels, docKey, docModels, points, notes);
    if (!opts.keepLatex) {
      for (const q of qs) {
        q.text = plainMaths(q.text); q.feedback = plainMaths(q.feedback || "");
        if (q.model) q.model = plainMaths(q.model);
        if (q.options) q.options = q.options.map(plainMaths);
      }
    }
    const base = stripExt(opts.fileName || "quiz");
    const title = (opts.title && opts.title.trim()) || foundTitle || base.replace(/_/g, " ");
    for (const q of qs) {
      q.figFiles = q.images.map((im, k) => [`Q${String(q.n).padStart(2, "0")}${q.images.length === 1 ? "" : "abcdefgh"[k]}${im.ext}`, im.data]);
      for (const [nm] of q.figFiles) if (/\.(emf|wmf)$/i.test(nm)) notes.push(`${nm}: .emf/.wmf pictures often do not show in Schoology; paste the figure into Word as a PNG and convert again.`);
    }
    const missing = qs.filter((q) => (q.type === "mc" || q.type === "tf") && (q.correct === null || q.correct === undefined)).map((q) => q.n);
    const maxN = Math.max(...qs.map((q) => q.n));
    const have = new Set(qs.map((q) => q.n));
    const gaps = []; for (let n = 1; n <= maxN; n++) if (!have.has(n)) gaps.push(n);
    if (gaps.length) notes.push("Question numbers missing from the file: " + gaps.join(", "));
    // one row per question, with letters as in the source
    const rows = qs.map((q) => {
      let ans = "", src = q.ansSrc || "";
      if (q.type === "mc") ans = q.correct !== null && q.correct !== undefined ? LET[q.correct] : "??";
      else if (q.type === "tf") ans = q.correct === true ? "True" : q.correct === false ? "False" : "??";
      else ans = "(hand-marked)";
      return { n: q.n, type: q.type, nOptions: q.options ? q.options.length : 0, ans, src: src || (q.type === "essay" ? "" : "NO ANSWER FOUND"), figs: q.figFiles.map((f) => f[0]), text: q.text, points: q.points };
    });
    const rep = ["QuizToBBZip check report (engine v" + VERSION + ")", "Source: " + (opts.fileName || ""), "Title: " + title, "Questions found: " + qs.length,
      "Numbers: " + qs.map((q) => q.n).join(", "), ""];
    for (const r of rows) {
      let line;
      if (r.type === "mc") line = `Q${String(r.n).padStart(3)}  MCQ  ${r.nOptions} options  answer ${r.ans}  (${r.src})`;
      else if (r.type === "tf") line = `Q${String(r.n).padStart(3)}  T/F  answer ${r.ans}  (${r.src})`;
      else line = `Q${String(r.n).padStart(3)}  ESSAY  ${r.points} pt  (${r.src})`;
      if (r.figs.length) line += "  figure: " + r.figs.join(", ");
      rep.push(line);
      rep.push("      " + (r.text.length > 110 ? r.text.slice(0, 110) + "…" : r.text));
    }
    const warn = notes.slice();
    if (missing.length) warn.push("NO ANSWER for: " + missing.map((n) => "Q" + n).join(", ") + '. Add a key (e.g. "B C A ..." or a mark scheme file), an \'Answer: B\' line, or mark the option with *.');
    rep.push("", warn.length ? "Warnings:" : "Warnings: none", ...warn.map((x) => "  - " + x));

    // shuffled copy = what goes into the zip
    const finalQs = qs.map((q) => Object.assign({}, q, { options: q.options ? q.options.slice() : undefined }));
    for (const q of finalQs) {
      if (q.type === "mc" && (q.correct === null || q.correct === undefined)) q.correct = 0;
      if (q.type === "tf" && (q.correct === null || q.correct === undefined)) q.correct = true;
    }
    const doShuffle = opts.shuffle !== false;
    const seed = opts.seed == null || isNaN(opts.seed) ? 1 : Number(opts.seed);
    // only questions with a real answer take part in the shuffle (as in quiz2bb.py with all answers present)
    if (doShuffle) {
      if (missing.length) { /* quiz2bb --allow-missing: missing questions already became answer A, then everything is shuffled */ }
      rebalance(finalQs, seed);
    }
    rows.forEach((r, i) => { const q = finalQs[i]; r.zipAns = q.type === "mc" ? LET[q.correct] : q.type === "tf" ? (q.correct ? "True" : "False") : ""; });
    return { title, base, questions: finalQs, rows, notes: warn, missing, report: rep.join("\n") + "\n", shuffled: doShuffle };
  }

  /** Build the downloadable files for an analysed quiz. */
  function buildOutputs(res, o = {}) {
    const instructions = o.instructions || "";
    const packFigures = o.packFigures !== false;
    const qs = res.questions, title = res.title, base = (o.name || res.base).replace(/[^\w.\-]+/g, "_");
    const bb = buildBlackboard(qs, title, instructions, packFigures);
    const bbZip = makeZip(bb.files);
    const keyLines = [], paste = [];
    qs.forEach((q, i0) => {
      const i = i0 + 1;
      const fig = q.figFiles.length ? " [figure: " + q.figFiles.map((f) => f[0]).join(", ") + "]" : "";
      if (q.type === "mc") {
        keyLines.push(`Q${i}: ${LET[q.correct]}  (${q.options[q.correct]})${fig}`);
        paste.push(`${i}. ${q.text}${fig}\n` + q.options.map((op, k) => (k === q.correct ? "*" : "") + `${LET[k]}) ${op}`).join("\n"));
      } else if (q.type === "tf") {
        keyLines.push(`Q${i}: ${q.correct ? "True" : "False"}${fig}`);
        paste.push(`${i}. ${q.text}${fig}\n${q.correct ? "*" : ""}True\n${q.correct ? "" : "*"}False`);
      } else {
        keyLines.push(`Q${i}: essay (${q.points} pts)${fig}` + (q.model ? `  model: ${q.model}` : ""));
        paste.push(`${i}. ${q.text}${fig}`);
      }
    });
    const keyTxt = title + "\n\n" + keyLines.join("\n") + "\n";
    const schoTxt = paste.join("\n\n") + "\n";
    const letters = qs.filter((q) => q.type === "mc").map((q) => LET[q.correct]);
    const spread = {}; for (const l of [...new Set(letters)].sort()) spread[l] = letters.filter((x) => x === l).length;
    const figures = [];
    for (const q of qs) for (const [nm, data] of q.figFiles) figures.push({ name: "figures/" + nm, data });
    const all = [
      { name: `${base}_Blackboard.zip`, data: bbZip },
      { name: `${base}_Key.txt`, data: keyTxt },
      { name: `${base}_Schoology.txt`, data: schoTxt },
      { name: `${base}_Check.txt`, data: res.report },
      ...figures,
    ];
    return { base, bbZip, bbName: `${base}_Blackboard.zip`, combined: makeZip(all), combinedName: `${base}_QuizToBBZip.zip`, keyTxt, schoTxt, letters, spread, total: bb.total, nfig: bb.nfig, nQuestions: qs.length };
  }

  /** Convenience: file bytes -> blocks (docx, txt or md). */
  async function readBlocks(name, bytes) {
    const low = name.toLowerCase();
    if (low.endsWith(".docx")) return (await Docx.load(bytes)).blocks();
    if (/\.(txt|md|text)$/.test(low)) return textBlocks(dec.decode(bytes));
    if (low.endsWith(".doc")) throw new Error("Old .doc format: open it in Word and Save As .docx first.");
    if (low.endsWith(".pdf")) throw new Error("PDF: open it in Word (or Google Docs) and download it as .docx first.");
    throw new Error("Use a .docx, .txt or .md file.");
  }

  return {
    VERSION, analyse, buildOutputs, readBlocks, makeZip, unzip, crc32,
    // exposed for tests
    _: { Docx, parse, finalise, textBlocks, latexToText, plainMaths, PyRandom, rebalance, splitInlineOptions, pairsFromText, readKeyString, parseXML },
  };
});
