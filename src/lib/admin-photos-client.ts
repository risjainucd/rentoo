import { renditionPlan, watermarkLayout, WHITE_OPACITY, SHADOW_OPACITY } from './admin-photos';

const ACCEPT = /^image\/(jpeg|png|webp)$/;

// Load the wordmark once as white + black SVG images (mirrors _watermark.mjs loadWordmarkSvgs):
// white is the faint mark, black (blurred, offset) is its soft shadow.
let logos: Promise<{ white: HTMLImageElement; black: HTMLImageElement }> | null = null;
function loadLogos(): Promise<{ white: HTMLImageElement; black: HTMLImageElement }> {
  if (logos) return logos;
  logos = fetch('/Rentoo.svg')
    .then((r) => r.text())
    .then(async (svg) => {
      const white = svg.replace(/fill="#[0-9A-Fa-f]{3,8}"/g, 'fill="#ffffff"');
      const black = svg.replace(/fill="#[0-9A-Fa-f]{3,8}"/g, 'fill="#000000"');
      const toImg = (s: string) => loadImg(`data:image/svg+xml;utf8,${encodeURIComponent(s)}`);
      return { white: await toImg(white), black: await toImg(black) };
    });
  return logos;
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('image load failed'));
    img.src = src;
  });
}

// Render one watermarked WebP rendition at the given width.
async function renderRendition(
  bitmap: ImageBitmap, targetW: number, quality: number, logo: { white: HTMLImageElement; black: HTMLImageElement },
): Promise<Blob> {
  const scale = targetW / bitmap.width;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high'; // high-quality downscale (closer to sharp)
  ctx.drawImage(bitmap, 0, 0, w, h);

  const aspect = logo.white.naturalWidth / logo.white.naturalHeight;
  const box = watermarkLayout(w, h, aspect);
  const off = Math.max(2, Math.round(box.w / 300));
  const blur = Math.max(1, Math.round(box.w / 90));

  // Draw the shadow and the mark in SEPARATE passes so each keeps its own opacity.
  // (A single globalAlpha would multiply into the canvas drop-shadow and wash it out.)
  ctx.save();
  ctx.globalAlpha = SHADOW_OPACITY;
  ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(logo.black, box.left + off, box.top + off, box.w, box.h);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = WHITE_OPACITY;
  ctx.drawImage(logo.white, box.left, box.top, box.w, box.h);
  ctx.restore();

  return await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/webp', quality),
  );
}

async function processFile(file: File): Promise<{ form: FormData; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const logo = await loadLogos();
  const plan = renditionPlan(bitmap.width);
  const form = new FormData();
  let galleryDims = { w: bitmap.width, h: bitmap.height };
  for (const r of plan) {
    const blob = await renderRendition(bitmap, r.width, r.quality, logo);
    form.set(r.name, blob, `${r.name}.webp`);
    if (r.name === 'gallery') {
      const s = r.width / bitmap.width;
      galleryDims = { w: Math.round(bitmap.width * s), h: Math.round(bitmap.height * s) };
    }
  }
  bitmap.close();
  form.set('width', String(galleryDims.w));
  form.set('height', String(galleryDims.h));
  return { form, width: galleryDims.w, height: galleryDims.h };
}

export function initPhotoManager(root: HTMLElement): void {
  const slug = root.dataset.slug!;
  const grid = root.querySelector<HTMLElement>('[data-grid]')!;
  const fileInput = root.querySelector<HTMLInputElement>('[data-file]')!;
  const dropZone = root.querySelector<HTMLElement>('[data-drop]')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;

  const setStatus = (msg: string) => { status.textContent = msg; };
  const orderedIds = () => Array.from(grid.querySelectorAll<HTMLElement>('[data-id]')).map((el) => el.dataset.id!);
  const markCover = () => {
    grid.querySelectorAll<HTMLElement>('[data-id]').forEach((el, i) => el.classList.toggle('is-cover', i === 0));
  };

  async function postJson(path: string, body: unknown): Promise<boolean> {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok;
  }

  function makeTile(id: string, cardUrl: string): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'ph-tile';
    tile.dataset.id = id;
    tile.draggable = true;
    tile.innerHTML = `<img src="${cardUrl}" alt="" loading="lazy" /><span class="cover-badge">Cover</span><button type="button" class="del" data-del aria-label="Delete photo">×</button>`;
    return tile;
  }

  // ---- upload ----
  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    for (const file of list) {
      if (!ACCEPT.test(file.type)) { setStatus(`Skipped ${file.name}: ${/he/i.test(file.type) || /\.hei/i.test(file.name) ? 'HEIC not supported — export as JPEG first.' : 'unsupported type.'}`); continue; }
      try {
        setStatus(`Processing ${file.name}…`);
        const { form } = await processFile(file);
        setStatus(`Uploading ${file.name}…`);
        const res = await fetch(`/api/admin/photos/${slug}`, { method: 'POST', body: form });
        const data = await res.json().catch(() => null) as { ok?: boolean; id?: string; r2_key?: string; error?: string } | null;
        if (!res.ok || !data?.ok) { setStatus(`Failed ${file.name}: ${data?.error ?? res.status}`); continue; }
        grid.appendChild(makeTile(data.id!, `/media/${data.r2_key}-card.webp`));
        markCover();
        setStatus(`Added ${file.name}.`);
      } catch (e) { setStatus(`Error on ${file.name}: ${(e as Error).message}`); }
    }
  }

  fileInput.addEventListener('change', () => { if (fileInput.files?.length) { uploadFiles(fileInput.files); fileInput.value = ''; } });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('over'); if (e.dataTransfer?.files.length) uploadFiles(e.dataTransfer.files); });

  // ---- delete (optimistic + revert) ----
  grid.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-del]');
    if (!btn) return;
    const tile = btn.closest<HTMLElement>('[data-id]')!;
    if (!confirm('Delete this photo?')) return;
    const id = tile.dataset.id!;
    const next = tile.nextElementSibling;
    tile.remove(); markCover();
    const ok = await postJson(`/api/admin/photos/${slug}/delete`, { id });
    if (!ok) { next ? grid.insertBefore(tile, next) : grid.appendChild(tile); markCover(); setStatus('Delete failed — restored.'); }
    else setStatus('Deleted.');
  });

  // ---- drag reorder (optimistic + revert-on-error) ----
  let dragEl: HTMLElement | null = null;
  let orderBeforeDrag: string[] = [];
  grid.addEventListener('dragstart', (e) => {
    dragEl = (e.target as HTMLElement).closest('[data-id]');
    orderBeforeDrag = orderedIds();
    dragEl?.classList.add('dragging');
  });
  grid.addEventListener('dragend', () => { dragEl?.classList.remove('dragging'); dragEl = null; });
  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    const over = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
    if (!over || over === dragEl || !dragEl) return;
    const rect = over.getBoundingClientRect();
    const after = (e.clientX - rect.left) / rect.width > 0.5;
    grid.insertBefore(dragEl, after ? over.nextSibling : over);
  });
  grid.addEventListener('drop', async (e) => {
    e.preventDefault();
    markCover();
    const ids = orderedIds();
    if (ids.join() === orderBeforeDrag.join()) return; // no net change → nothing to persist
    const prev = orderBeforeDrag.slice();
    const ok = await postJson(`/api/admin/photos/${slug}/reorder`, { ids });
    if (ok) { setStatus('Order saved.'); return; }
    // Revert the DOM to the pre-drag order (re-append each tile in the old sequence).
    for (const id of prev) {
      const el = grid.querySelector<HTMLElement>(`[data-id="${id}"]`);
      if (el) grid.appendChild(el);
    }
    markCover();
    setStatus('Reorder failed — restored.');
  });

  markCover();
}
