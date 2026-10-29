import { uid, type SheetMeta, type TextItem } from './types';

export type LoadedSheet = { meta: SheetMeta; blob: Blob };

const MAX_PX = 3200; // long edge of rendered PDF pages — sharp enough to zoom, small enough for phones

async function loadPdf(file: File, onProgress?: (msg: string) => void): Promise<LoadedSheet[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const base = file.name.replace(/\.pdf$/i, '');
  const out: LoadedSheet[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.(`Rendering page ${i} of ${doc.numPages}…`);
    const page = await doc.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const r = Math.min(4, MAX_PX / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale: r });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    const text = await extractText(page, vp);
    out.push({
      blob,
      meta: {
        id: uid(),
        name: doc.numPages > 1 ? `${base} — p${i}` : base,
        source: 'pdf',
        width: canvas.width,
        height: canvas.height,
        // 1 PDF point = 1/72 inch = 25.4/72 mm
        pxPerPaperMm: (r * 72) / 25.4,
        scale: null,
        regions: [],
        text,
      },
    });
  }
  return out;
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs').getDocument>['promise']>['getPage']>>;
type PdfViewport = ReturnType<PdfPage['getViewport']>;

/** Read every text run on the page and convert to sheet pixel coordinates (centre, size, angle). */
async function extractText(page: PdfPage, vp: PdfViewport): Promise<TextItem[]> {
  try {
    const content = await page.getTextContent();
    const out: TextItem[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const [a, b, , , e, f] = it.transform as number[];
      const angle = (Math.atan2(b, a) * 180) / Math.PI;
      const rad = (angle * Math.PI) / 180;
      const fontH = Math.hypot(a, b) || it.height || 1;
      // Baseline start → middle of the run, along its direction, lifted by half the font height.
      const mx = e + (Math.cos(rad) * it.width) / 2 - (Math.sin(rad) * fontH) / 2;
      const my = f + (Math.sin(rad) * it.width) / 2 + (Math.cos(rad) * fontH) / 2;
      const [x, y] = vp.convertToViewportPoint(mx, my);
      out.push({ s: it.str.trim(), x, y, w: it.width * vp.scale, h: fontH * vp.scale, a: Math.round(angle) });
    }
    return out;
  } catch {
    return [];
  }
}

async function loadImage(file: File, camera: boolean): Promise<LoadedSheet> {
  const bmp = await createImageBitmap(file);
  const meta: SheetMeta = {
    id: uid(),
    name: camera ? `Photo ${new Date().toLocaleTimeString()}` : file.name.replace(/\.(png|jpe?g)$/i, ''),
    source: camera ? 'camera' : /png$/i.test(file.type) ? 'png' : 'jpg',
    width: bmp.width,
    height: bmp.height,
    pxPerPaperMm: null,
    scale: null,
    regions: [],
  };
  bmp.close();
  return { meta, blob: file };
}

export async function loadFiles(files: FileList | File[], camera = false, onProgress?: (msg: string) => void) {
  const out: LoadedSheet[] = [];
  for (const f of Array.from(files)) {
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) out.push(...(await loadPdf(f, onProgress)));
    else if (/^image\/(png|jpe?g)$/i.test(f.type) || /\.(png|jpe?g)$/i.test(f.name)) out.push(await loadImage(f, camera));
    else throw new Error(`${f.name}: only PDF, PNG and JPG drawings are supported.`);
  }
  return out;
}
