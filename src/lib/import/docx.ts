import JSZip from 'jszip';
import { LABELS, RUMUS, type DraftOption, type DraftQuestion } from './types';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

type Para = {
  numId: string | null;
  text: string;
  red: boolean;
  images: Blob[];
};

function childW(el: Element, name: string): Element | null {
  for (const c of Array.from(el.children)) {
    if (c.namespaceURI === W && c.localName === name) return c;
  }
  return null;
}
const valW = (el: Element | null) => (el ? el.getAttributeNS(W, 'val') ?? el.getAttribute('w:val') : null);

function runText(r: Element): string {
  let s = '';
  for (const c of Array.from(r.children)) {
    if (c.namespaceURI !== W) continue;
    if (c.localName === 't') s += c.textContent ?? '';
    else if (c.localName === 'tab') s += ' ';
    else if (c.localName === 'br' || c.localName === 'cr') s += '\n';
    else if (c.localName === 'noBreakHyphen') s += '-';
  }
  return s;
}

const WRAPPERS = new Set(['hyperlink', 'ins', 'smartTag', 'sdt', 'sdtContent', 'fldSimple']);

function collectText(node: Element): string {
  let s = '';
  for (const c of Array.from(node.children)) {
    if (c.namespaceURI === W) {
      if (c.localName === 'r') s += runText(c);
      else if (WRAPPERS.has(c.localName)) s += collectText(c);
    } else if (c.namespaceURI === M && (c.localName === 'oMath' || c.localName === 'oMathPara')) {
      s += RUMUS;
    }
  }
  return s;
}

function isRedHex(v: string | null): boolean {
  if (!v || !/^[0-9a-fA-F]{6}$/.test(v)) return false;
  const n = parseInt(v, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r >= 0xc0 && g <= 0x60 && b <= 0x60;
}

function paragraphIsRed(p: Element): boolean {
  const runs = [...Array.from(p.getElementsByTagNameNS(W, 'r')), ...Array.from(p.getElementsByTagNameNS(M, 'r'))];
  for (const r of runs) {
    if (!(r.textContent ?? '').trim()) continue;
    const rPr = childW(r, 'rPr');
    const color = rPr ? childW(rPr, 'color') : null;
    if (isRedHex(valW(color))) return true;
  }
  return false;
}

function mimeOf(name: string): string {
  const e = name.split('.').pop()?.toLowerCase();
  if (e === 'png') return 'image/png';
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'gif') return 'image/gif';
  if (e === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

export async function parseDocx(file: File | Blob): Promise<DraftQuestion[]> {
  return parseDocxBuffer(await file.arrayBuffer());
}

export async function parseDocxBuffer(buf: ArrayBuffer | Uint8Array): Promise<DraftQuestion[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error('DOCX_INVALID');
  }
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('DOCX_INVALID');
  const xml = await docFile.async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('DOCX_INVALID');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('DOCX_INVALID');

  // relasi gambar: rId -> path di dalam zip
  const rels = new Map<string, string>();
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    const rdoc = new DOMParser().parseFromString(await relsFile.async('string'), 'application/xml');
    for (const rel of Array.from(rdoc.getElementsByTagName('Relationship'))) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : 'word/' + target);
    }
  }
  const imageCache = new Map<string, Blob | null>();
  async function imageFor(rid: string): Promise<Blob | null> {
    if (imageCache.has(rid)) return imageCache.get(rid)!;
    const path = rels.get(rid);
    const f = path ? zip.file(path) : null;
    const blob = f ? new Blob([await f.async('arraybuffer')], { type: mimeOf(path!) }) : null;
    imageCache.set(rid, blob);
    return blob;
  }

  const paras: Para[] = [];
  for (const p of Array.from(body.children)) {
    if (p.namespaceURI !== W || p.localName !== 'p') continue;
    const pPr = childW(p, 'pPr');
    const numPr = pPr ? childW(pPr, 'numPr') : null;
    const numIdRaw = numPr ? valW(childW(numPr, 'numId')) : null;
    const numId = numIdRaw && numIdRaw !== '0' ? numIdRaw : null;

    const images: Blob[] = [];
    const rids: string[] = [];
    for (const blip of Array.from(p.getElementsByTagNameNS(A, 'blip'))) {
      const rid = blip.getAttributeNS(R, 'embed');
      if (rid) rids.push(rid);
    }
    for (const im of Array.from(p.getElementsByTagNameNS('*', 'imagedata'))) {
      const rid = im.getAttributeNS(R, 'id');
      if (rid) rids.push(rid);
    }
    for (const rid of rids) {
      const b = await imageFor(rid);
      if (b) images.push(b);
    }
    paras.push({ numId, text: collectText(p), red: paragraphIsRed(p), images });
  }

  // Daftar soal = numId yang muncul sebagai paling banyak "blok" terpisah
  // (soal berselang-seling dengan opsi; opsi satu soal biasanya satu blok).
  const runs = new Map<string, { blocks: number; count: number; first: number }>();
  let prev: string | null = null;
  paras.forEach((p, i) => {
    if (!p.numId) return;
    const e = runs.get(p.numId) ?? { blocks: 0, count: 0, first: i };
    if (p.numId !== prev) e.blocks++;
    e.count++;
    runs.set(p.numId, e);
    prev = p.numId;
  });
  if (!runs.size) throw new Error('DOCX_NO_NUMBERING');
  const qNum = [...runs.entries()].sort(
    (a, b) => b[1].blocks - a[1].blocks || b[1].count - a[1].count || a[1].first - b[1].first,
  )[0][0];

  type Raw = { stimulus: Para[]; qText: Para[]; options: Para[] };
  const raws: Raw[] = [];
  let cur: Raw | null = null;
  let pending: Para[] = [];
  for (const p of paras) {
    if (p.numId === qNum) {
      cur = { stimulus: pending, qText: [p], options: [] };
      raws.push(cur);
      pending = [];
    } else if (p.numId !== null) {
      if (cur) cur.options.push(p);
    } else {
      if (!cur) continue; // kop dokumen sebelum soal pertama
      if (!p.text.trim() && !p.images.length) continue;
      if (cur.options.length === 0) cur.qText.push(p);
      else pending.push(p);
    }
  }

  return raws.map((raw) => {
    const notes: string[] = [];
    const joined = (ps: Para[]) => ps.map((p) => p.text.trim()).filter(Boolean).join('\n');
    const stimulus = joined(raw.stimulus) || null;
    if (stimulus) notes.push('teks pengantar terdeteksi');
    if (raw.qText.filter((p) => p.text.trim()).length > 1) notes.push('lanjutan pertanyaan digabung ke soal');

    const imgs = [...raw.stimulus, ...raw.qText].flatMap((p) => p.images);
    if (imgs.length > 1) notes.push(`ada ${imgs.length} gambar, hanya yang pertama dipakai`);

    const options: DraftOption[] = raw.options.slice(0, 5).map((p, i) => ({
      label: LABELS[i],
      body: p.text.trim(),
      ...(p.images[0] ? { image: p.images[0] } : {}),
    }));
    if (raw.options.length > 5) notes.push(`opsi lebih dari lima (${raw.options.length}), sisanya dibuang`);

    const reds = raw.options
      .slice(0, 5)
      .map((p, i) => (p.red ? LABELS[i] : null))
      .filter((x): x is (typeof LABELS)[number] => x !== null);
    const q: DraftQuestion = {
      stimulus,
      body: joined(raw.qText),
      options,
      answer: reds.length === 1 ? reds[0] : null,
      keyCandidates: reds,
      errors: [],
      notes,
    };
    if (imgs[0]) q.image = imgs[0];
    return q;
  });
}
