// =============================================================================
// Edit PDF — a full document editor (text, objects, pages) that runs entirely
// in the browser.
//
// Coordinate system
// ----------------
// Every object is stored in "page points": the coordinate space of the page's
// pdf.js viewport at scale 1.0, origin top-left, y growing downwards. One unit
// == one PDF point, so zoom never touches the model and saving is a pure
// y-flip (plus a quarter-turn mapping for rotated pages — see edVpToPdf).
//
// Rendering
// ---------
// Per page: a .edit-page-inner sized in points holds the page canvas and an
// absolutely-positioned object layer. The wrapper is CSS-scaled by the zoom
// factor, so object geometry is zoom-independent; the canvas is re-rasterised
// at the new zoom for sharpness.
// =============================================================================

/* ---------------------------------- state --------------------------------- */

let editFile = null;
let editPdfDoc = null;      // pdf.js document
let editBytes = null;       // decrypted bytes for pdf-lib
let editPages = [];         // [{ key, src, rotate, blank, w, h }]  w/h in points
let editObjects = [];       // see edMakeObject()
let editSelectedId = null;
let editTool = 'select';
let editZoom = 1;
let editUndoStack = [];
let editRedoStack = [];
let editKeySeq = 0;
let editRenderObserver = null;
let editNavObserver = null;
let editZoomTimer = null;
let editClipboard = null;
let editSigDataUrl = null;  // last captured signature (data URL)

// transient pointer state
let edDrag = null;          // { id, startX, startY, ox, oy, moved }
let edResize = null;        // { id, handle, startX, startY, box }
let edCreate = null;        // { pageKey, x0, y0, ghost, type, pts }

const EDIT_DRAW_TOOLS = ['whiteout', 'highlight', 'pen', 'line', 'arrow', 'rect', 'ellipse'];
const EDIT_CLICK_TOOLS = ['text', 'image', 'signature'];
const EDIT_FONTS = {
    Helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    TimesRoman: '"Times New Roman", Times, serif',
    Courier: '"Courier New", Courier, monospace'
};
const EDIT_HINTS = {
    select: 'Click an object to select it — drag to move, pull a handle to resize.',
    edittext: 'Click any line of the PDF’s own text to edit it — the original is covered over, not stripped from the file.',
    text: 'Click where the new text should start.',
    whiteout: 'Drag over anything you want erased — it is covered over, not removed from the file.',
    image: 'Click a page to place an image.',
    signature: 'Click a page to place your signature.',
    highlight: 'Drag across text to highlight it.',
    pen: 'Draw freehand on the page.',
    line: 'Drag to draw a line.',
    arrow: 'Drag to draw an arrow.',
    rect: 'Drag to draw a rectangle.',
    ellipse: 'Drag to draw an ellipse.'
};

/* --------------------------------- helpers -------------------------------- */

function edUid() { return 'o' + (++editKeySeq) + '-' + Math.random().toString(36).slice(2, 7); }
function edClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function edEl(id) { return document.getElementById(id); }

// pdf.js Util.transform, implemented locally so we never depend on that
// internal export being present in the CDN build.
function edMulT(a, b) {
    return [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5]
    ];
}

function edHexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#000000');
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
}
function edRgbToHex(r, g, b) {
    const h = (n) => edClamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
}
function edPdfColor(hex) {
    const c = edHexToRgb(hex);
    return PDFLib.rgb(c.r / 255, c.g / 255, c.b / 255);
}
// Anything outside Latin-1 cannot be encoded by pdf-lib's standard fonts, so
// such text is rasterised at save time instead (keeps Arabic/CJK correct).
function edNeedsRaster(str) { return /[^\u0000-ÿ]/.test(String(str == null ? '' : str)); }
function edIsRtl(str) { return /[֐-׿؀-ۿ܀-ݏݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(String(str == null ? '' : str)); }

// Small files should not all read "0.00 MB".
function edFormatSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
}

function edPage(key) { return editPages.find(p => p.key === key); }
function edObj(id) { return editObjects.find(o => o.id === id); }
function edPageObjects(key) { return editObjects.filter(o => o.pageKey === key); }
function edPageIndex(key) { return editPages.findIndex(p => p.key === key); }

/* ------------------------------ undo / redo ------------------------------- */

function edSnapshot() {
    return JSON.stringify({
        pages: editPages.map(p => ({ key: p.key, src: p.src, rotate: p.rotate, blank: p.blank, w: p.w, h: p.h })),
        objects: editObjects
    });
}

function edPushHistory() {
    editUndoStack.push(edSnapshot());
    if (editUndoStack.length > 60) editUndoStack.shift();
    editRedoStack.length = 0;
    edUpdateHistoryButtons();
}

function edRestore(snap) {
    const s = JSON.parse(snap);
    const sameLayout = s.pages.length === editPages.length &&
        s.pages.every((p, i) => editPages[i] && editPages[i].key === p.key &&
            editPages[i].rotate === p.rotate);
    editPages = s.pages;
    editObjects = s.objects;
    editSelectedId = null;
    if (sameLayout) {
        editPages.forEach(p => edRenderObjects(p.key));
        edRenderInspector();
    } else {
        edRenderWorkspace();
        edRenderPagesPanel();
    }
}

function edUndo() {
    if (!editUndoStack.length) return;
    editRedoStack.push(edSnapshot());
    edRestore(editUndoStack.pop());
    edUpdateHistoryButtons();
}

function edRedo() {
    if (!editRedoStack.length) return;
    editUndoStack.push(edSnapshot());
    edRestore(editRedoStack.pop());
    edUpdateHistoryButtons();
}

function edUpdateHistoryButtons() {
    const u = edEl('edit-undo-btn'), r = edEl('edit-redo-btn');
    if (u) u.disabled = editUndoStack.length === 0;
    if (r) r.disabled = editRedoStack.length === 0;
}

/* ------------------------------ file loading ------------------------------ */

async function handleEditFile(file) {
    editFile = file;
    editObjects = [];
    editPages = [];
    editSelectedId = null;
    editUndoStack = [];
    editRedoStack = [];
    editZoom = 1;

    edEl('edit-drop-zone').classList.add('hidden');
    edEl('edit-file-info').classList.remove('hidden');
    edEl('edit-filename').textContent = file.name;
    edEl('edit-filesize').textContent = edFormatSize(file.size);

    if (window.showLoader) window.showLoader('Opening document…');

    try {
        const buf = await file.arrayBuffer();
        const loaded = await window.loadPdfProtected(buf);
        if (!loaded) { resetEditUI(); if (window.hideLoader) window.hideLoader(); return; }

        editPdfDoc = loaded.pdfDoc;
        editBytes = loaded.bytes;

        for (let i = 1; i <= editPdfDoc.numPages; i++) {
            const page = await editPdfDoc.getPage(i);
            const vp = page.getViewport({ scale: 1 });
            editPages.push({
                key: 'pg' + i + '-' + Math.random().toString(36).slice(2, 6),
                src: i, rotate: 0, blank: false,
                w: Math.round(vp.width), h: Math.round(vp.height)
            });
        }

        edEl('edit-toolbar').classList.remove('hidden');
        edEl('edit-main').classList.remove('hidden');
        edEl('edit-total-pages').textContent = editPages.length;
        edEl('edit-page-input').max = editPages.length;

        edSetTool('select');
        edRenderWorkspace();
        edRenderPagesPanel();
        edFitWidth();
        edUpdateHistoryButtons();
        if (window.hideLoader) window.hideLoader();
    } catch (e) {
        console.error(e);
        if (window.hideLoader) window.hideLoader();
        alert('Could not open this PDF: ' + e.message);
        resetEditUI();
    }
}

function resetEditUI() {
    editFile = null;
    editPdfDoc = null;
    editBytes = null;
    editPages = [];
    editObjects = [];
    editSelectedId = null;
    editUndoStack = [];
    editRedoStack = [];
    if (editRenderObserver) { editRenderObserver.disconnect(); editRenderObserver = null; }
    if (editNavObserver) { editNavObserver.disconnect(); editNavObserver = null; }

    const ws = edEl('edit-workspace'); if (ws) ws.innerHTML = '';
    const tp = edEl('edit-thumbs'); if (tp) tp.innerHTML = '';

    edEl('edit-drop-zone').classList.remove('hidden');
    edEl('edit-file-info').classList.add('hidden');
    edEl('edit-toolbar').classList.add('hidden');
    edEl('edit-main').classList.add('hidden');
    edEl('edit-upload').value = '';
}

/* ------------------------------- workspace -------------------------------- */

function edRenderWorkspace() {
    const ws = edEl('edit-workspace');
    if (!ws) return;
    ws.innerHTML = '';
    if (editRenderObserver) editRenderObserver.disconnect();
    if (editNavObserver) editNavObserver.disconnect();

    editPages.forEach((p, i) => {
        const box = document.createElement('div');
        box.className = 'edit-page-box';
        box.dataset.pageKey = p.key;
        box.dataset.pageNo = i + 1;

        const label = document.createElement('div');
        label.className = 'edit-page-label';
        label.textContent = 'Page ' + (i + 1);

        const scaler = document.createElement('div');
        scaler.className = 'edit-page-scaler';

        const inner = document.createElement('div');
        inner.className = 'edit-page-inner';
        inner.style.width = p.w + 'px';
        inner.style.height = p.h + 'px';

        const canvas = document.createElement('canvas');
        canvas.className = 'edit-page-canvas';
        canvas.style.width = p.w + 'px';
        canvas.style.height = p.h + 'px';
        inner.appendChild(canvas);

        if (!p.blank) {
            const spin = document.createElement('div');
            spin.className = 'edit-page-spinner';
            spin.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            inner.appendChild(spin);
        }

        // Clickable boxes for the PDF's own text lines (built on demand).
        const textLayer = document.createElement('div');
        textLayer.className = 'edit-text-layer';
        inner.appendChild(textLayer);

        const objLayer = document.createElement('div');
        objLayer.className = 'edit-obj-layer';
        inner.appendChild(objLayer);

        scaler.appendChild(inner);
        box.appendChild(label);
        box.appendChild(scaler);
        ws.appendChild(box);

        edBindPageEvents(inner, p.key);
    });

    edApplyZoom();
    editPages.forEach(p => edRenderObjects(p.key));

    editRenderObserver = new IntersectionObserver((entries) => {
        entries.forEach(en => {
            if (en.isIntersecting) {
                edRenderPageCanvas(en.target.dataset.pageKey);
                editRenderObserver.unobserve(en.target);
            }
        });
    }, { rootMargin: '400px', threshold: 0 });

    const pageInput = edEl('edit-page-input');
    editNavObserver = new IntersectionObserver((entries) => {
        entries.forEach(en => {
            if (en.isIntersecting && en.intersectionRatio > 0.25 &&
                document.activeElement !== pageInput) {
                pageInput.value = en.target.dataset.pageNo;
            }
        });
    }, { threshold: [0.25] });

    ws.querySelectorAll('.edit-page-box').forEach(el => {
        editRenderObserver.observe(el);
        editNavObserver.observe(el);
    });
}

// Rasterise one page at the current zoom. Idempotent unless the zoom changed.
//
// Renders are serialised per canvas: the lazy-load observer and the zoom
// re-render can both ask for the same page, and pdf.js refuses two concurrent
// render() calls on one canvas. The queued run re-checks `renderedAt` so a
// request that has already been superseded does no work.
function edRenderPageCanvas(pageKey) {
    const p = edPage(pageKey);
    const box = document.querySelector('.edit-page-box[data-page-key="' + pageKey + '"]');
    if (!p || !box) return Promise.resolve();

    const canvas = box.querySelector('.edit-page-canvas');
    const target = Math.min(3, Math.max(1, editZoom)) * (window.devicePixelRatio || 1);
    const stamp = String(target);
    if (canvas.dataset.renderedAt === stamp) return Promise.resolve();
    canvas.dataset.renderedAt = stamp;

    const run = async () => {
        if (canvas.dataset.renderedAt !== stamp) return; // superseded while queued
        if (!canvas.isConnected) return;                 // workspace was rebuilt

        if (p.blank) {
            canvas.width = Math.round(p.w * target);
            canvas.height = Math.round(p.h * target);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            return;
        }

        try {
            const page = await editPdfDoc.getPage(p.src);
            const vp = page.getViewport({ scale: target, rotation: (page.rotate + p.rotate) % 360 });
            canvas.width = Math.round(vp.width);
            canvas.height = Math.round(vp.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
            const spin = box.querySelector('.edit-page-spinner');
            if (spin) spin.remove();
        } catch (e) {
            console.error('Edit: page render failed', p.src, e);
            if (canvas.dataset.renderedAt === stamp) canvas.dataset.renderedAt = '';
        }
    };

    canvas.__edChain = (canvas.__edChain || Promise.resolve()).then(run, run);
    return canvas.__edChain;
}

function edApplyZoom() {
    document.querySelectorAll('#edit-workspace .edit-page-box').forEach(box => {
        const p = edPage(box.dataset.pageKey);
        if (!p) return;
        const scaler = box.querySelector('.edit-page-scaler');
        scaler.style.transform = 'scale(' + editZoom + ')';
        scaler.style.width = p.w + 'px';
        scaler.style.height = p.h + 'px';
        box.style.width = Math.round(p.w * editZoom) + 'px';
        box.style.height = Math.round(p.h * editZoom) + 'px';
    });
    const lvl = edEl('edit-zoom-level');
    if (lvl) lvl.textContent = Math.round(editZoom * 100) + '%';

    clearTimeout(editZoomTimer);
    editZoomTimer = setTimeout(() => {
        document.querySelectorAll('#edit-workspace .edit-page-box').forEach(box => {
            const r = box.getBoundingClientRect();
            if (r.bottom > -600 && r.top < window.innerHeight + 600) {
                edRenderPageCanvas(box.dataset.pageKey);
            }
        });
    }, 250);
}

function edSetZoom(z) {
    editZoom = edClamp(z, 0.25, 4);
    edApplyZoom();
}

function edFitWidth() {
    const ws = edEl('edit-workspace');
    if (!ws || !editPages.length) return;
    const avail = ws.clientWidth - 48;
    if (avail > 100) edSetZoom(avail / editPages[0].w);
}

function edScrollToPage(n) {
    n = edClamp(n, 1, editPages.length);
    const box = document.querySelector('#edit-workspace .edit-page-box[data-page-no="' + n + '"]');
    if (!box) return;
    const bar = edEl('edit-toolbar');
    const off = (bar ? bar.offsetHeight : 0) + 16;
    window.scrollTo({ top: box.getBoundingClientRect().top + window.scrollY - off, behavior: 'smooth' });
    edEl('edit-page-input').value = n;
}

/* --------------------------------- objects -------------------------------- */

function edMakeObject(type, pageKey, props) {
    const base = {
        id: edUid(), type: type, pageKey: pageKey,
        x: 0, y: 0, w: 120, h: 24, rot: 0, opacity: 1
    };
    return Object.assign(base, props || {});
}

function edAddObject(obj, opts) {
    edPushHistory();
    editObjects.push(obj);
    edRenderObjects(obj.pageKey);
    edSelect(obj.id);
    if (opts && opts.edit && obj.type === 'text') {
        const el = document.querySelector('.edit-obj[data-id="' + obj.id + '"] .edit-text-body');
        if (el) { el.focus(); document.execCommand && document.execCommand('selectAll', false, null); }
    }
    return obj;
}

function edDeleteObject(id) {
    const i = editObjects.findIndex(o => o.id === id);
    if (i < 0) return;
    const key = editObjects[i].pageKey;
    edPushHistory();
    editObjects.splice(i, 1);
    if (editSelectedId === id) editSelectedId = null;
    edRenderObjects(key);
    edRenderInspector();
}

function edDuplicateObject(id) {
    const o = edObj(id);
    if (!o) return;
    const copy = JSON.parse(JSON.stringify(o));
    copy.id = edUid();
    copy.x += 12; copy.y += 12;
    edAddObject(copy);
}

function edBringToFront(id) {
    const i = editObjects.findIndex(o => o.id === id);
    if (i < 0) return;
    edPushHistory();
    const [o] = editObjects.splice(i, 1);
    editObjects.push(o);
    edRenderObjects(o.pageKey);
    edSelect(id);
}

function edSendToBack(id) {
    const i = editObjects.findIndex(o => o.id === id);
    if (i < 0) return;
    edPushHistory();
    const [o] = editObjects.splice(i, 1);
    editObjects.unshift(o);
    edRenderObjects(o.pageKey);
    edSelect(id);
}

function edSelect(id) {
    editSelectedId = id;
    document.querySelectorAll('#edit-workspace .edit-obj').forEach(el => {
        el.classList.toggle('selected', el.dataset.id === id);
    });
    edRenderInspector();
}

// Rebuild the object layer of one page.
function edRenderObjects(pageKey) {
    const box = document.querySelector('.edit-page-box[data-page-key="' + pageKey + '"]');
    if (!box) return;
    const layer = box.querySelector('.edit-obj-layer');
    layer.innerHTML = '';
    edPageObjects(pageKey).forEach(o => layer.appendChild(edBuildObjectEl(o)));
    if (editSelectedId) {
        const sel = layer.querySelector('.edit-obj[data-id="' + editSelectedId + '"]');
        if (sel) sel.classList.add('selected');
    }
}

function edBuildObjectEl(o) {
    const el = document.createElement('div');
    el.className = 'edit-obj edit-obj-' + o.type;
    el.dataset.id = o.id;
    el.style.left = o.x + 'px';
    el.style.top = o.y + 'px';
    el.style.width = o.w + 'px';
    el.style.height = o.h + 'px';
    el.style.opacity = o.opacity;
    if (o.rot) el.style.transform = 'rotate(' + o.rot + 'deg)';

    if (o.type === 'text') {
        const body = document.createElement('div');
        body.className = 'edit-text-body';
        body.contentEditable = 'true';
        body.spellcheck = false;
        body.dir = 'auto';
        body.style.fontFamily = EDIT_FONTS[o.font] || EDIT_FONTS.Helvetica;
        body.style.fontSize = o.size + 'px';
        body.style.lineHeight = (o.size * 1.18) + 'px';
        body.style.color = o.color;
        body.style.fontWeight = o.bold ? '700' : '400';
        body.style.fontStyle = o.italic ? 'italic' : 'normal';
        body.style.textAlign = o.align || 'left';
        body.style.whiteSpace = o.autoW ? 'pre' : 'pre-wrap';
        body.textContent = o.text;
        el.appendChild(body);

        body.addEventListener('input', () => {
            o.text = body.innerText.replace(/ /g, ' ').replace(/\n$/, '');
            if (o.autoW) {
                o.w = Math.max(8, body.scrollWidth + 2);
                el.style.width = o.w + 'px';
            }
            o.h = Math.max(o.size * 1.18, body.scrollHeight);
            el.style.height = o.h + 'px';
        });
        body.addEventListener('focus', () => { el.classList.add('editing'); edSelect(o.id); });
        body.addEventListener('blur', () => {
            el.classList.remove('editing');
            o.text = body.innerText.replace(/ /g, ' ').replace(/\n$/, '');
            if (!o.text.trim()) edDeleteObject(o.id);
        });
        body.addEventListener('mousedown', (e) => {
            // Let the caret work inside a focused box; otherwise fall through to drag.
            if (el.classList.contains('editing')) e.stopPropagation();
        });
    } else if (o.type === 'image' || o.type === 'signature') {
        const img = document.createElement('img');
        img.className = 'edit-obj-img';
        img.src = o.src;
        img.draggable = false;
        el.appendChild(img);
    } else if (o.type === 'whiteout') {
        el.style.background = o.fill;
    } else if (o.type === 'highlight') {
        el.style.background = o.fill;
        el.style.mixBlendMode = 'multiply';
    } else {
        el.appendChild(edBuildShapeSvg(o));
    }

    // Selection handles (added for every type; CSS hides them unless selected).
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(h => {
        const k = document.createElement('div');
        k.className = 'edit-handle edit-handle-' + h;
        k.dataset.handle = h;
        el.appendChild(k);
    });

    return el;
}

function edBuildShapeSvg(o) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'edit-obj-svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 ' + Math.max(1, o.w) + ' ' + Math.max(1, o.h));
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('overflow', 'visible');

    const sw = o.stroke || 2;
    const col = o.strokeColor || '#ef4444';
    const fill = o.fill && o.fill !== 'none' ? o.fill : 'none';

    if (o.type === 'rect') {
        const r = document.createElementNS(NS, 'rect');
        r.setAttribute('x', sw / 2); r.setAttribute('y', sw / 2);
        r.setAttribute('width', Math.max(0, o.w - sw));
        r.setAttribute('height', Math.max(0, o.h - sw));
        r.setAttribute('fill', fill);
        r.setAttribute('stroke', col);
        r.setAttribute('stroke-width', sw);
        svg.appendChild(r);
    } else if (o.type === 'ellipse') {
        const e = document.createElementNS(NS, 'ellipse');
        e.setAttribute('cx', o.w / 2); e.setAttribute('cy', o.h / 2);
        e.setAttribute('rx', Math.max(0, o.w / 2 - sw / 2));
        e.setAttribute('ry', Math.max(0, o.h / 2 - sw / 2));
        e.setAttribute('fill', fill);
        e.setAttribute('stroke', col);
        e.setAttribute('stroke-width', sw);
        svg.appendChild(e);
    } else if (o.type === 'line' || o.type === 'arrow') {
        const p = document.createElementNS(NS, 'path');
        const x1 = o.flipX ? o.w : 0, x2 = o.flipX ? 0 : o.w;
        const y1 = o.flipY ? o.h : 0, y2 = o.flipY ? 0 : o.h;
        let d = 'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2;
        if (o.type === 'arrow') {
            const ang = Math.atan2(y2 - y1, x2 - x1);
            const head = Math.max(8, sw * 3.5);
            d += ' M ' + x2 + ' ' + y2 +
                ' L ' + (x2 - head * Math.cos(ang - Math.PI / 6)) + ' ' + (y2 - head * Math.sin(ang - Math.PI / 6)) +
                ' M ' + x2 + ' ' + y2 +
                ' L ' + (x2 - head * Math.cos(ang + Math.PI / 6)) + ' ' + (y2 - head * Math.sin(ang + Math.PI / 6));
        }
        p.setAttribute('d', d);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', col);
        p.setAttribute('stroke-width', sw);
        p.setAttribute('stroke-linecap', 'round');
        svg.appendChild(p);
    } else if (o.type === 'pen') {
        const p = document.createElementNS(NS, 'path');
        const pts = o.points || [];
        let d = '';
        pts.forEach((pt, i) => { d += (i ? ' L ' : 'M ') + pt.x + ' ' + pt.y; });
        p.setAttribute('d', d || 'M 0 0');
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', col);
        p.setAttribute('stroke-width', sw);
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(p);
    }
    return svg;
}

function edRefreshObjectEl(o) {
    const el = document.querySelector('.edit-obj[data-id="' + o.id + '"]');
    if (!el) return;
    const was = el.classList.contains('selected');
    const fresh = edBuildObjectEl(o);
    if (was) fresh.classList.add('selected');
    el.replaceWith(fresh);
}

/* ---------------------------- pointer interaction ------------------------- */

// Point inside a page, in page points.
function edPointIn(inner, e) {
    const r = inner.getBoundingClientRect();
    return {
        x: (e.clientX - r.left) / editZoom,
        y: (e.clientY - r.top) / editZoom
    };
}

function edBindPageEvents(inner, pageKey) {
    inner.addEventListener('mousedown', (e) => {
        const handle = e.target.closest('.edit-handle');
        const objEl = e.target.closest('.edit-obj');

        // 1. Resize via a handle of the selected object.
        if (handle && objEl && objEl.dataset.id === editSelectedId) {
            const o = edObj(editSelectedId);
            if (!o) return;
            edPushHistory();
            const pt = edPointIn(inner, e);
            edResize = {
                id: o.id, handle: handle.dataset.handle,
                startX: pt.x, startY: pt.y,
                box: { x: o.x, y: o.y, w: o.w, h: o.h }
            };
            e.preventDefault(); e.stopPropagation();
            return;
        }

        // 2. Select / drag an existing object (select tool, or any tool when
        //    clicking straight onto an object).
        if (objEl) {
            const o = edObj(objEl.dataset.id);
            if (o) {
                edSelect(o.id);
                if (!objEl.classList.contains('editing')) {
                    edPushHistory();
                    const pt = edPointIn(inner, e);
                    edDrag = { id: o.id, startX: pt.x, startY: pt.y, ox: o.x, oy: o.y, moved: false };
                    e.preventDefault();
                }
                e.stopPropagation();
                return;
            }
        }

        // 3. Empty space.
        const pt = edPointIn(inner, e);

        if (EDIT_CLICK_TOOLS.includes(editTool)) {
            edPlaceClickTool(pageKey, pt);
            e.preventDefault();
            return;
        }

        if (EDIT_DRAW_TOOLS.includes(editTool)) {
            const ghost = document.createElement('div');
            ghost.className = 'edit-ghost edit-ghost-' + editTool;
            inner.querySelector('.edit-obj-layer').appendChild(ghost);
            edCreate = {
                pageKey: pageKey, x0: pt.x, y0: pt.y, ghost: ghost, type: editTool,
                pts: editTool === 'pen' ? [{ x: pt.x, y: pt.y }] : null
            };
            e.preventDefault();
            return;
        }

        edSelect(null);
    });

    inner.addEventListener('dblclick', (e) => {
        const objEl = e.target.closest('.edit-obj');
        if (objEl) {
            const o = edObj(objEl.dataset.id);
            if (o && o.type === 'text') {
                const body = objEl.querySelector('.edit-text-body');
                if (body) body.focus();
            }
            return;
        }
        // Double-click on blank space with the select tool drops a text box.
        if (editTool === 'select') {
            const pt = edPointIn(inner, e);
            edPlaceText(pageKey, pt);
        }
    });
}

function edPlaceClickTool(pageKey, pt) {
    if (editTool === 'text') { edPlaceText(pageKey, pt); return; }
    if (editTool === 'image') { edPendingPlacement = { pageKey, pt }; edEl('edit-image-upload').click(); return; }
    if (editTool === 'signature') { edPendingPlacement = { pageKey, pt }; edOpenSignatureModal(); return; }
}

let edPendingPlacement = null;

function edPlaceText(pageKey, pt) {
    const size = parseFloat(edEl('edit-new-size').value) || 16;
    const o = edMakeObject('text', pageKey, {
        x: Math.round(pt.x), y: Math.round(pt.y),
        w: 160, h: Math.round(size * 1.18),
        text: 'New text',
        size: size,
        font: edEl('edit-new-font').value || 'Helvetica',
        color: edEl('edit-new-color').value || '#111111',
        bold: false, italic: false, align: 'left', autoW: true
    });
    edAddObject(o, { edit: true });
    if (editTool === 'text') edSetTool('select');
}

window.addEventListener('mousemove', (e) => {
    if (edDrag) {
        const o = edObj(edDrag.id);
        const inner = document.querySelector('.edit-page-box[data-page-key="' + o.pageKey + '"] .edit-page-inner');
        if (!o || !inner) return;
        const pt = edPointIn(inner, e);
        o.x = Math.round(edDrag.ox + (pt.x - edDrag.startX));
        o.y = Math.round(edDrag.oy + (pt.y - edDrag.startY));
        edDrag.moved = true;
        const el = document.querySelector('.edit-obj[data-id="' + o.id + '"]');
        if (el) { el.style.left = o.x + 'px'; el.style.top = o.y + 'px'; }
        edSyncGeomInputs(o);
        return;
    }

    if (edResize) {
        const o = edObj(edResize.id);
        const inner = document.querySelector('.edit-page-box[data-page-key="' + o.pageKey + '"] .edit-page-inner');
        if (!o || !inner) return;
        const pt = edPointIn(inner, e);
        const dx = pt.x - edResize.startX, dy = pt.y - edResize.startY;
        const b = edResize.box;
        const h = edResize.handle;
        let x = b.x, y = b.y, w = b.w, hh = b.h;

        if (h.includes('w')) { x = b.x + dx; w = b.w - dx; }
        if (h.includes('e')) { w = b.w + dx; }
        if (h.includes('n')) { y = b.y + dy; hh = b.h - dy; }
        if (h.includes('s')) { hh = b.h + dy; }

        if (w < 6) { w = 6; }
        if (hh < 6) { hh = 6; }

        // Keep aspect for images/signatures on corner handles.
        if ((o.type === 'image' || o.type === 'signature') && h.length === 2 && b.w > 0) {
            const ar = b.w / b.h;
            hh = w / ar;
            if (h.includes('n')) y = b.y + (b.h - hh);
        }

        o.x = Math.round(x); o.y = Math.round(y);
        o.w = Math.round(w); o.h = Math.round(hh);
        if (o.type === 'text') o.autoW = false;
        edRefreshObjectEl(o);
        edSyncGeomInputs(o);
        return;
    }

    if (edCreate) {
        const inner = document.querySelector('.edit-page-box[data-page-key="' + edCreate.pageKey + '"] .edit-page-inner');
        if (!inner) return;
        const pt = edPointIn(inner, e);
        if (edCreate.type === 'pen') {
            const last = edCreate.pts[edCreate.pts.length - 1];
            if (Math.abs(pt.x - last.x) + Math.abs(pt.y - last.y) > 1.5) edCreate.pts.push({ x: pt.x, y: pt.y });
            edDrawPenGhost();
        } else {
            const x = Math.min(edCreate.x0, pt.x), y = Math.min(edCreate.y0, pt.y);
            const w = Math.abs(pt.x - edCreate.x0), h = Math.abs(pt.y - edCreate.y0);
            const g = edCreate.ghost;
            g.style.left = x + 'px'; g.style.top = y + 'px';
            g.style.width = w + 'px'; g.style.height = h + 'px';
            if (edCreate.type === 'line' || edCreate.type === 'arrow') {
                g.dataset.x2 = pt.x; g.dataset.y2 = pt.y;
            }
        }
    }
});

function edDrawPenGhost() {
    const pts = edCreate.pts;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min.apply(null, xs), minY = Math.min.apply(null, ys);
    const g = edCreate.ghost;
    g.style.left = minX + 'px';
    g.style.top = minY + 'px';
    g.style.width = (Math.max.apply(null, xs) - minX) + 'px';
    g.style.height = (Math.max.apply(null, ys) - minY) + 'px';
    g.innerHTML = '';
    const tmp = {
        type: 'pen',
        w: Math.max(1, Math.max.apply(null, xs) - minX),
        h: Math.max(1, Math.max.apply(null, ys) - minY),
        stroke: parseFloat(edEl('edit-new-stroke').value) || 2,
        strokeColor: edEl('edit-new-color').value,
        points: pts.map(p => ({ x: p.x - minX, y: p.y - minY }))
    };
    g.appendChild(edBuildShapeSvg(tmp));
}

window.addEventListener('mouseup', () => {
    if (edDrag) {
        if (!edDrag.moved) editUndoStack.pop(); // a plain click shouldn't fill history
        edDrag = null;
        edUpdateHistoryButtons();
    }
    if (edResize) { edResize = null; }
    if (edCreate) { edFinishCreate(); }
});

function edFinishCreate() {
    const c = edCreate;
    edCreate = null;
    if (c.ghost && c.ghost.parentNode) c.ghost.parentNode.removeChild(c.ghost);

    const color = edEl('edit-new-color').value || '#ef4444';
    const stroke = parseFloat(edEl('edit-new-stroke').value) || 2;

    if (c.type === 'pen') {
        if (!c.pts || c.pts.length < 2) return;
        const xs = c.pts.map(p => p.x), ys = c.pts.map(p => p.y);
        const minX = Math.min.apply(null, xs), minY = Math.min.apply(null, ys);
        const w = Math.max(1, Math.max.apply(null, xs) - minX);
        const h = Math.max(1, Math.max.apply(null, ys) - minY);
        edAddObject(edMakeObject('pen', c.pageKey, {
            x: minX, y: minY, w: w, h: h,
            stroke: stroke, strokeColor: color,
            points: c.pts.map(p => ({ x: p.x - minX, y: p.y - minY }))
        }));
        return;
    }

    const g = c.ghost;
    const x = parseFloat(g.style.left) || 0, y = parseFloat(g.style.top) || 0;
    const w = parseFloat(g.style.width) || 0, h = parseFloat(g.style.height) || 0;
    if (w < 3 && h < 3) return;

    if (c.type === 'whiteout') {
        const fill = edSampleBackground(c.pageKey, x, y, w, h) || '#ffffff';
        edAddObject(edMakeObject('whiteout', c.pageKey, { x, y, w, h, fill: fill }));
    } else if (c.type === 'highlight') {
        edAddObject(edMakeObject('highlight', c.pageKey, {
            x, y, w, h: Math.max(6, h), fill: edEl('edit-new-highlight').value || '#ffe866', opacity: 0.45
        }));
    } else if (c.type === 'rect' || c.type === 'ellipse') {
        edAddObject(edMakeObject(c.type, c.pageKey, {
            x, y, w, h, stroke: stroke, strokeColor: color, fill: 'none'
        }));
    } else if (c.type === 'line' || c.type === 'arrow') {
        const x2 = parseFloat(g.dataset.x2), y2 = parseFloat(g.dataset.y2);
        edAddObject(edMakeObject(c.type, c.pageKey, {
            x, y, w: Math.max(1, w), h: Math.max(1, h),
            stroke: stroke, strokeColor: color,
            flipX: x2 < c.x0, flipY: y2 < c.y0
        }));
    }
}

/* -------------------- sampling colours off the page canvas ---------------- */

// Median colour of a thin ring just outside a box — used to patch out text so
// the whiteout blends with coloured or shaded backgrounds.
function edSampleBackground(pageKey, x, y, w, h) {
    const box = document.querySelector('.edit-page-box[data-page-key="' + pageKey + '"]');
    if (!box) return null;
    const canvas = box.querySelector('.edit-page-canvas');
    if (!canvas || !canvas.width) return null;
    const p = edPage(pageKey);
    const sx = canvas.width / p.w, sy = canvas.height / p.h;

    try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const pad = 3;
        const rx = edClamp(Math.round((x - pad) * sx), 0, canvas.width - 1);
        const ry = edClamp(Math.round((y - pad) * sy), 0, canvas.height - 1);
        const rw = edClamp(Math.round((w + pad * 2) * sx), 1, canvas.width - rx);
        const rh = edClamp(Math.round((h + pad * 2) * sy), 1, canvas.height - ry);
        const data = ctx.getImageData(rx, ry, rw, rh).data;

        const counts = {};
        let best = null, bestN = 0;
        const step = Math.max(1, Math.floor((rw * rh) / 4000));
        // Walk the border ring only.
        for (let py = 0; py < rh; py++) {
            for (let px = 0; px < rw; px++) {
                const onRing = px < 2 || py < 2 || px > rw - 3 || py > rh - 3;
                if (!onRing) continue;
                const i = (py * rw + px) * 4;
                const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
                const n = (counts[k] = (counts[k] || 0) + 1);
                if (n > bestN) { bestN = n; best = [data[i], data[i + 1], data[i + 2]]; }
            }
        }
        void step;
        return best ? edRgbToHex(best[0], best[1], best[2]) : null;
    } catch (e) {
        return null; // tainted canvas or zero-size region
    }
}

// Darkest pixel in a box — a good approximation of the glyph colour.
function edSampleInk(pageKey, x, y, w, h) {
    const box = document.querySelector('.edit-page-box[data-page-key="' + pageKey + '"]');
    if (!box) return null;
    const canvas = box.querySelector('.edit-page-canvas');
    if (!canvas || !canvas.width) return null;
    const p = edPage(pageKey);
    const sx = canvas.width / p.w, sy = canvas.height / p.h;
    try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const rx = edClamp(Math.round(x * sx), 0, canvas.width - 1);
        const ry = edClamp(Math.round(y * sy), 0, canvas.height - 1);
        const rw = edClamp(Math.round(w * sx), 1, canvas.width - rx);
        const rh = edClamp(Math.round(h * sy), 1, canvas.height - ry);
        const data = ctx.getImageData(rx, ry, rw, rh).data;
        let best = null, bestLum = 1e9;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 128) continue;
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (lum < bestLum) { bestLum = lum; best = [data[i], data[i + 1], data[i + 2]]; }
        }
        if (!best || bestLum > 190) return null; // nothing dark enough to be ink
        return edRgbToHex(best[0], best[1], best[2]);
    } catch (e) {
        return null;
    }
}

/* ---------------------- editing the PDF's existing text ------------------- */

// Build clickable boxes over every text line of the rendered pages.
async function edBuildTextLayers() {
    const boxes = Array.from(document.querySelectorAll('#edit-workspace .edit-page-box'));
    for (const box of boxes) {
        const p = edPage(box.dataset.pageKey);
        const layer = box.querySelector('.edit-text-layer');
        if (!p || !layer || p.blank) continue;
        if (layer.dataset.built === '1') { layer.classList.add('active'); continue; }
        layer.dataset.built = '1';

        try {
            const lines = await edExtractLines(p);
            lines.forEach(ln => {
                const b = document.createElement('div');
                b.className = 'edit-text-pick';
                b.style.left = ln.x + 'px';
                b.style.top = ln.y + 'px';
                b.style.width = ln.w + 'px';
                b.style.height = ln.h + 'px';
                b.title = 'Click to edit this text';
                b.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    edLiftTextLine(p.key, ln, b);
                });
                layer.appendChild(b);
            });
            layer.classList.add('active');
        } catch (e) {
            console.error('Edit: text extraction failed', e);
        }
    }
}

function edClearTextLayers() {
    document.querySelectorAll('#edit-workspace .edit-text-layer').forEach(l => l.classList.remove('active'));
}

// Group pdf.js text items into visual lines, in page points.
async function edExtractLines(p) {
    const page = await editPdfDoc.getPage(p.src);
    const vp = page.getViewport({ scale: 1, rotation: (page.rotate + p.rotate) % 360 });
    const tc = await page.getTextContent();
    const items = [];

    tc.items.forEach(it => {
        if (!it.str || !it.str.trim()) return;
        const m = edMulT(vp.transform, it.transform);
        const size = Math.hypot(m[2], m[3]) || Math.abs(m[3]) || 10;
        const style = tc.styles && tc.styles[it.fontName];
        const ascent = style && style.ascent ? style.ascent : 0.78;
        const descent = style && style.descent ? Math.abs(style.descent) : 0.22;
        const fam = (style && style.fontFamily) || 'sans-serif';
        items.push({
            str: it.str,
            x: m[4],
            baseline: m[5],
            top: m[5] - size * ascent,
            h: size * (ascent + descent),
            w: it.width || size * it.str.length * 0.5,
            size: size,
            family: fam
        });
    });

    items.sort((a, b) => (a.baseline - b.baseline) || (a.x - b.x));

    const lines = [];
    let cur = null;
    items.forEach(it => {
        const fits = cur &&
            Math.abs(it.baseline - cur.baseline) <= Math.max(1.5, cur.size * 0.35) &&
            it.x >= cur.x - cur.size * 0.5 &&
            it.x - (cur.x + cur.w) <= cur.size * 1.2;
        if (!fits) {
            cur = {
                str: it.str, x: it.x, y: it.top, w: it.w, h: it.h,
                baseline: it.baseline, size: it.size, family: it.family
            };
            lines.push(cur);
            return;
        }
        const gap = it.x - (cur.x + cur.w);
        if (gap > it.size * 0.18 && !/\s$/.test(cur.str) && !/^\s/.test(it.str)) cur.str += ' ';
        cur.str += it.str;
        cur.w = (it.x + it.w) - cur.x;
        cur.y = Math.min(cur.y, it.top);
        cur.h = Math.max(cur.h, it.h);
        cur.size = Math.max(cur.size, it.size);
    });

    return lines.filter(l => l.w > 1 && l.h > 1 && l.str.trim());
}

function edFamilyToStd(family) {
    const f = String(family || '').toLowerCase();
    if (f.includes('mono') || f.includes('courier')) return 'Courier';
    if (f.includes('serif') && !f.includes('sans')) return 'TimesRoman';
    if (f.includes('times') || f.includes('georgia') || f.includes('book')) return 'TimesRoman';
    return 'Helvetica';
}

// Replace a line of original text with an editable text object, patching the
// original glyphs out with the sampled page background.
function edLiftTextLine(pageKey, ln, pickEl) {
    const pad = Math.max(1, ln.size * 0.12);
    const bg = edSampleBackground(pageKey, ln.x, ln.y, ln.w, ln.h) || '#ffffff';
    const ink = edSampleInk(pageKey, ln.x, ln.y, ln.w, ln.h) || '#111111';

    edPushHistory();

    const patch = edMakeObject('whiteout', pageKey, {
        x: Math.round(ln.x - pad),
        y: Math.round(ln.y - pad),
        w: Math.round(ln.w + pad * 2),
        h: Math.round(ln.h + pad * 2),
        fill: bg
    });
    const text = edMakeObject('text', pageKey, {
        x: Math.round(ln.x),
        y: Math.round(ln.y),
        w: Math.round(ln.w + 4),
        h: Math.round(ln.h),
        text: ln.str,
        size: Math.round(ln.size * 10) / 10,
        font: edFamilyToStd(ln.family),
        color: ink,
        bold: false, italic: false, align: 'left', autoW: true
    });

    editObjects.push(patch, text);
    if (pickEl && pickEl.parentNode) pickEl.parentNode.removeChild(pickEl);
    edRenderObjects(pageKey);
    edSelect(text.id);

    const body = document.querySelector('.edit-obj[data-id="' + text.id + '"] .edit-text-body');
    if (body) {
        body.focus();
        const r = document.createRange();
        r.selectNodeContents(body);
        const s = window.getSelection();
        s.removeAllRanges(); s.addRange(r);
    }
    if (window.showToast) window.showToast('Text lifted for editing — type to replace it.', 'info', 2600);
}

/* ------------------------------- page actions ----------------------------- */

function edRotatePage(key, delta) {
    const p = edPage(key);
    if (!p) return;
    edPushHistory();
    const steps = ((delta / 90) % 4 + 4) % 4;
    for (let s = 0; s < steps; s++) {
        const w0 = p.w, h0 = p.h;
        edPageObjects(key).forEach(o => {
            const nx = h0 - (o.y + o.h);
            const ny = o.x;
            const nw = o.h, nh = o.w;
            if (o.points) {
                o.points = o.points.map(pt => ({ x: o.h - pt.y, y: pt.x }));
            }
            if (o.type === 'line' || o.type === 'arrow') {
                const fx = o.flipX, fy = o.flipY;
                o.flipX = !fy; o.flipY = fx;
            }
            o.x = nx; o.y = ny; o.w = nw; o.h = nh;
            if (o.type === 'text' || o.type === 'image' || o.type === 'signature') {
                o.rot = ((o.rot || 0) + 90) % 360;
            }
        });
        p.w = h0; p.h = w0;
        p.rotate = (p.rotate + 90) % 360;
    }
    edRenderWorkspace();
    edRenderPagesPanel();
}

function edDeletePage(key) {
    if (editPages.length <= 1) {
        if (window.showToast) window.showToast('A document needs at least one page.', 'error');
        return;
    }
    edPushHistory();
    editPages = editPages.filter(p => p.key !== key);
    editObjects = editObjects.filter(o => o.pageKey !== key);
    editSelectedId = null;
    edAfterPageSetChange();
}

function edDuplicatePage(key) {
    const i = edPageIndex(key);
    if (i < 0) return;
    edPushHistory();
    const src = editPages[i];
    const copy = Object.assign({}, src, { key: 'pg-' + edUid() });
    editPages.splice(i + 1, 0, copy);
    edPageObjects(key).forEach(o => {
        const c = JSON.parse(JSON.stringify(o));
        c.id = edUid();
        c.pageKey = copy.key;
        editObjects.push(c);
    });
    edAfterPageSetChange();
}

function edInsertBlankPage(key) {
    const i = edPageIndex(key);
    const ref = editPages[i] || editPages[0];
    edPushHistory();
    editPages.splice(i + 1, 0, {
        key: 'pg-' + edUid(), src: null, rotate: 0, blank: true,
        w: ref ? ref.w : 595, h: ref ? ref.h : 842
    });
    edAfterPageSetChange();
}

function edMovePage(key, dir) {
    const i = edPageIndex(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= editPages.length) return;
    edPushHistory();
    const [p] = editPages.splice(i, 1);
    editPages.splice(j, 0, p);
    edAfterPageSetChange();
}

function edAfterPageSetChange() {
    edEl('edit-total-pages').textContent = editPages.length;
    edEl('edit-page-input').max = editPages.length;
    edRenderWorkspace();
    edRenderPagesPanel();
    edRenderInspector();
}

/* ------------------------------- pages panel ------------------------------ */

function edRenderPagesPanel() {
    const list = edEl('edit-thumbs');
    if (!list) return;
    list.innerHTML = '';

    editPages.forEach((p, i) => {
        const item = document.createElement('div');
        item.className = 'edit-thumb';
        item.dataset.pageKey = p.key;

        const shot = document.createElement('div');
        shot.className = 'edit-thumb-shot';
        const canvas = document.createElement('canvas');
        shot.appendChild(canvas);

        const no = document.createElement('div');
        no.className = 'edit-thumb-no';
        no.textContent = i + 1;

        const acts = document.createElement('div');
        acts.className = 'edit-thumb-acts';
        acts.innerHTML =
            '<button data-act="rot" title="Rotate 90°"><i class="fas fa-rotate-right"></i></button>' +
            '<button data-act="dup" title="Duplicate page"><i class="fas fa-clone"></i></button>' +
            '<button data-act="blank" title="Insert blank page after"><i class="fas fa-circle-plus"></i></button>' +
            '<button data-act="up" title="Move up"><i class="fas fa-arrow-up"></i></button>' +
            '<button data-act="down" title="Move down"><i class="fas fa-arrow-down"></i></button>' +
            '<button data-act="del" class="danger" title="Delete page"><i class="fas fa-trash"></i></button>';

        acts.addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (!b) return;
            e.stopPropagation();
            const act = b.dataset.act;
            if (act === 'rot') edRotatePage(p.key, 90);
            else if (act === 'dup') edDuplicatePage(p.key);
            else if (act === 'blank') edInsertBlankPage(p.key);
            else if (act === 'up') edMovePage(p.key, -1);
            else if (act === 'down') edMovePage(p.key, 1);
            else if (act === 'del') edDeletePage(p.key);
        });

        item.appendChild(shot);
        item.appendChild(no);
        item.appendChild(acts);
        item.addEventListener('click', () => edScrollToPage(edPageIndex(p.key) + 1));
        list.appendChild(item);

        edRenderThumb(p, canvas);
    });

    if (typeof Sortable !== 'undefined') {
        new Sortable(list, {
            animation: 150,
            handle: '.edit-thumb-shot',
            onEnd: (evt) => {
                if (evt.oldIndex === evt.newIndex) return;
                edPushHistory();
                const [p] = editPages.splice(evt.oldIndex, 1);
                editPages.splice(evt.newIndex, 0, p);
                edAfterPageSetChange();
            }
        });
    }
}

async function edRenderThumb(p, canvas) {
    const W = 120;
    const scale = W / p.w;
    canvas.width = Math.round(p.w * scale);
    canvas.height = Math.round(p.h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (p.blank) return;
    try {
        const page = await editPdfDoc.getPage(p.src);
        const vp = page.getViewport({ scale: scale, rotation: (page.rotate + p.rotate) % 360 });
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
    } catch (e) { /* thumbnail is cosmetic */ }
}

/* -------------------------------- inspector ------------------------------- */

function edShow(id, on) {
    const el = edEl(id);
    if (el) el.classList.toggle('hidden', !on);
}

function edSyncGeomInputs(o) {
    if (!o || editSelectedId !== o.id) return;
    const set = (id, v) => { const e = edEl(id); if (e && document.activeElement !== e) e.value = Math.round(v); };
    set('edit-ix', o.x); set('edit-iy', o.y);
    set('edit-iw', o.w); set('edit-ih', o.h);
}

function edRenderInspector() {
    const o = edObj(editSelectedId);
    edShow('edit-insp-empty', !o);
    edShow('edit-insp-body', !!o);
    if (!o) return;

    const isText = o.type === 'text';
    const isShape = ['rect', 'ellipse', 'line', 'arrow', 'pen'].includes(o.type);
    const hasFill = ['rect', 'ellipse', 'whiteout', 'highlight'].includes(o.type);
    const canRotate = ['text', 'image', 'signature'].includes(o.type);

    const names = {
        text: 'Text', image: 'Image', signature: 'Signature', whiteout: 'Erased area',
        highlight: 'Highlight', rect: 'Rectangle', ellipse: 'Ellipse',
        line: 'Line', arrow: 'Arrow', pen: 'Freehand'
    };
    edEl('edit-insp-type').textContent = names[o.type] || o.type;

    edShow('edit-grp-text', isText);
    edShow('edit-grp-stroke', isShape);
    edShow('edit-grp-fill', hasFill);
    edShow('edit-grp-rotate', canRotate);

    if (isText) {
        edEl('edit-font-family').value = o.font || 'Helvetica';
        edEl('edit-font-size').value = o.size || 16;
        edEl('edit-text-color').value = o.color || '#111111';
        edEl('edit-bold').classList.toggle('active', !!o.bold);
        edEl('edit-italic').classList.toggle('active', !!o.italic);
        document.querySelectorAll('#edit-grp-text [data-align]').forEach(b => {
            b.classList.toggle('active', (o.align || 'left') === b.dataset.align);
        });
    }
    if (isShape) {
        edEl('edit-stroke-color').value = o.strokeColor || '#ef4444';
        edEl('edit-stroke-width').value = o.stroke || 2;
        edEl('edit-stroke-width-val').textContent = (o.stroke || 2) + ' pt';
    }
    if (hasFill) {
        const none = !o.fill || o.fill === 'none';
        edEl('edit-fill-color').value = none ? '#ffffff' : o.fill;
        edEl('edit-fill-none').checked = none;
    }
    if (canRotate) {
        edEl('edit-rotation').value = o.rot || 0;
        edEl('edit-rotation-val').textContent = (o.rot || 0) + '°';
    }

    edEl('edit-opacity').value = o.opacity == null ? 1 : o.opacity;
    edEl('edit-opacity-val').textContent = Math.round((o.opacity == null ? 1 : o.opacity) * 100) + '%';
    edSyncGeomInputs(o);
}

// Apply a property change to the selected object.
function edApply(mut, opts) {
    const o = edObj(editSelectedId);
    if (!o) return;
    if (!opts || opts.history !== false) edPushHistory();
    mut(o);
    edRefreshObjectEl(o);
    if (!opts || opts.reinspect !== false) edRenderInspector();
}

/* ------------------------------ tool switching ---------------------------- */

function edSetTool(tool) {
    editTool = tool;
    document.querySelectorAll('.edit-tool-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === tool);
    });
    const hint = edEl('edit-hint');
    if (hint) hint.textContent = EDIT_HINTS[tool] || '';

    const ws = edEl('edit-workspace');
    if (ws) {
        ws.classList.toggle('crosshair', EDIT_DRAW_TOOLS.includes(tool) || EDIT_CLICK_TOOLS.includes(tool));
        ws.classList.toggle('picking-text', tool === 'edittext');
    }

    // Toolbar sections that only matter for some tools.
    edShow('edit-opts-text', tool === 'text');
    edShow('edit-opts-draw', EDIT_DRAW_TOOLS.includes(tool) && tool !== 'whiteout' && tool !== 'highlight');
    edShow('edit-opts-highlight', tool === 'highlight');

    if (tool === 'edittext') edBuildTextLayers();
    else edClearTextLayers();
}

/* ----------------------------- image placement ---------------------------- */

function edPlaceImageFile(file) {
    const target = edPendingPlacement;
    edPendingPlacement = null;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            const key = (target && target.pageKey) || (editPages[0] && editPages[0].key);
            const p = edPage(key);
            if (!p) return;
            const maxW = Math.min(260, p.w * 0.6);
            const scale = Math.min(1, maxW / img.naturalWidth);
            const w = Math.round(img.naturalWidth * scale);
            const h = Math.round(img.naturalHeight * scale);
            const pt = (target && target.pt) || { x: (p.w - w) / 2, y: (p.h - h) / 2 };
            edAddObject(edMakeObject('image', key, {
                x: Math.round(pt.x), y: Math.round(pt.y), w: w, h: h,
                src: reader.result
            }));
            edSetTool('select');
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

/* ----------------------------- signature modal ---------------------------- */

let edSigCtx = null;
let edSigDrawing = false;
let edSigDirty = false;

function edOpenSignatureModal() {
    const modal = edEl('edit-sig-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const canvas = edEl('edit-sig-canvas');
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(480, Math.round(rect.width || 480)) * 2;
    canvas.height = 180 * 2;
    edSigCtx = canvas.getContext('2d');
    edSigCtx.scale(2, 2);
    edSigCtx.lineWidth = 2.6;
    edSigCtx.lineCap = 'round';
    edSigCtx.lineJoin = 'round';
    edSigCtx.strokeStyle = edEl('edit-sig-color').value || '#0b2447';
    edSigDirty = false;
}

function edCloseSignatureModal() {
    const modal = edEl('edit-sig-modal');
    if (modal) modal.classList.add('hidden');
    edPendingPlacement = null;
    if (editTool === 'signature') edSetTool('select');
}

function edSigClear() {
    const canvas = edEl('edit-sig-canvas');
    if (!canvas || !edSigCtx) return;
    edSigCtx.clearRect(0, 0, canvas.width, canvas.height);
    edSigDirty = false;
}

function edSigPoint(e) {
    const canvas = edEl('edit-sig-canvas');
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (canvas.width / 2 / r.width), y: (t.clientY - r.top) * (canvas.height / 2 / r.height) };
}

// Render the typed name onto the signature canvas.
function edSigRenderTyped() {
    const canvas = edEl('edit-sig-canvas');
    if (!canvas || !edSigCtx) return;
    const name = edEl('edit-sig-text').value || '';
    const font = edEl('edit-sig-font').value || '"Segoe Script", "Brush Script MT", cursive';
    edSigClear();
    if (!name.trim()) return;
    const w = canvas.width / 2, h = canvas.height / 2;
    let size = 64;
    edSigCtx.fillStyle = edEl('edit-sig-color').value || '#0b2447';
    edSigCtx.textBaseline = 'middle';
    edSigCtx.textAlign = 'center';
    edSigCtx.direction = edIsRtl(name) ? 'rtl' : 'ltr';
    do {
        edSigCtx.font = size + 'px ' + font;
        if (edSigCtx.measureText(name).width <= w - 24) break;
        size -= 2;
    } while (size > 14);
    edSigCtx.fillText(name, w / 2, h / 2);
    edSigDirty = true;
}

// Trim transparent margins and return { dataUrl, w, h }.
function edSigTrim() {
    const canvas = edEl('edit-sig-canvas');
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            if (data.data[(y * canvas.width + x) * 4 + 3] > 8) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return null;
    const pad = 6;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(canvas.width - 1, maxX + pad); maxY = Math.min(canvas.height - 1, maxY + pad);
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d').drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
    return { dataUrl: out.toDataURL('image/png'), w: w, h: h };
}

function edSigApply() {
    if (!edSigDirty) {
        if (window.showToast) window.showToast('Draw or type a signature first.', 'error');
        return;
    }
    const trimmed = edSigTrim();
    if (!trimmed) { edCloseSignatureModal(); return; }
    editSigDataUrl = trimmed.dataUrl;

    const target = edPendingPlacement;
    const key = (target && target.pageKey) || (editPages[0] && editPages[0].key);
    const p = edPage(key);
    if (p) {
        const w = Math.min(190, p.w * 0.45);
        const h = Math.round(w * (trimmed.h / trimmed.w));
        const pt = (target && target.pt) || { x: p.w - w - 60, y: p.h - h - 70 };
        const modal = edEl('edit-sig-modal');
        if (modal) modal.classList.add('hidden');
        edPendingPlacement = null;
        edAddObject(edMakeObject('signature', key, {
            x: Math.round(pt.x), y: Math.round(pt.y), w: Math.round(w), h: h,
            src: trimmed.dataUrl
        }));
        edSetTool('select');
        return;
    }
    edCloseSignatureModal();
}

/* -------------------------------- save (PDF) ------------------------------ */

// Map a point from display-viewport coords (y-down, top-left) to PDF user
// space (y-up, bottom-left) for a page rotated by R with mediabox W x H.
function edVpToPdf(R, W, H, vx, vy) {
    if (R === 90) return { x: vy, y: vx };
    if (R === 180) return { x: W - vx, y: vy };
    if (R === 270) return { x: W - vy, y: H - vx };
    return { x: vx, y: H - vy };
}

function edRotCW(x, y, deg) {
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return { x: x * c - y * s, y: x * s + y * c };
}

// Axis-aligned box -> PDF rect.
function edBoxToPdf(R, W, H, x, y, w, h) {
    const a = edVpToPdf(R, W, H, x, y);
    const b = edVpToPdf(R, W, H, x + w, y + h);
    return {
        x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y)
    };
}

// The lower-left anchor of an object's own (rotated) frame, in PDF space.
function edAnchorToPdf(R, W, H, o) {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    const off = edRotCW(-o.w / 2, o.h / 2, o.rot || 0);
    return edVpToPdf(R, W, H, cx + off.x, cy + off.y);
}

function edWrapLines(text, measure, maxW, wrap) {
    const out = [];
    String(text == null ? '' : text).split('\n').forEach(para => {
        if (!wrap || measure(para) <= maxW) { out.push(para); return; }
        const words = para.split(/(\s+)/);
        let line = '';
        words.forEach(tok => {
            const next = line + tok;
            if (line && measure(next) > maxW) {
                out.push(line.replace(/\s+$/, ''));
                line = /^\s+$/.test(tok) ? '' : tok;
            } else {
                line = next;
            }
        });
        out.push(line.replace(/\s+$/, ''));
    });
    return out.length ? out : [''];
}

// Unicode text is painted on a canvas and embedded as a transparent PNG,
// because pdf-lib's standard fonts are Latin-1 only.
async function edDrawTextAsImage(outDoc, page, R, W, H, o) {
    const k = 4; // supersample
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(o.w * k));
    canvas.height = Math.max(1, Math.round(o.h * k));
    const ctx = canvas.getContext('2d');
    ctx.scale(k, k);

    const fam = EDIT_FONTS[o.font] || EDIT_FONTS.Helvetica;
    const weight = o.bold ? '700' : '400';
    const style = o.italic ? 'italic' : 'normal';
    ctx.font = style + ' ' + weight + ' ' + o.size + 'px ' + fam;
    ctx.fillStyle = o.color || '#111111';
    ctx.textBaseline = 'alphabetic';
    const rtl = edIsRtl(o.text);
    ctx.direction = rtl ? 'rtl' : 'ltr';

    const measure = (s) => ctx.measureText(s).width;
    const lines = edWrapLines(o.text, measure, o.w, !o.autoW);
    const lh = o.size * 1.18;
    const align = o.align || (rtl ? 'right' : 'left');
    ctx.textAlign = align === 'center' ? 'center' : (align === 'right' ? 'right' : 'left');
    const ax = align === 'center' ? o.w / 2 : (align === 'right' ? o.w : 0);

    lines.forEach((ln, i) => {
        ctx.fillText(ln, ax, i * lh + o.size * 0.84);
    });

    const png = await outDoc.embedPng(canvas.toDataURL('image/png'));
    const anchor = edAnchorToPdf(R, W, H, o);
    page.drawImage(png, {
        x: anchor.x, y: anchor.y, width: o.w, height: o.h,
        rotate: PDFLib.degrees(R - (o.rot || 0)),
        opacity: o.opacity == null ? 1 : o.opacity
    });
}

async function saveEditedPDF() {
    if (!editFile || !editPages.length) return;
    const btn = edEl('edit-save-btn');
    const label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }
    if (window.showLoader) window.showLoader('Building your PDF…');

    try {
        const srcDoc = await PDFLib.PDFDocument.load(editBytes, { ignoreEncryption: true });
        const out = await PDFLib.PDFDocument.create();

        // Standard fonts, embedded on first use.
        const fontCache = {};
        const fontFor = async (name, bold, italic) => {
            const key = name + (bold ? 'B' : '') + (italic ? 'I' : '');
            if (fontCache[key]) return fontCache[key];
            const S = PDFLib.StandardFonts;
            let std;
            if (name === 'TimesRoman') {
                std = bold && italic ? S.TimesRomanBoldItalic : bold ? S.TimesRomanBold : italic ? S.TimesRomanItalic : S.TimesRoman;
            } else if (name === 'Courier') {
                std = bold && italic ? S.CourierBoldOblique : bold ? S.CourierBold : italic ? S.CourierOblique : S.Courier;
            } else {
                std = bold && italic ? S.HelveticaBoldOblique : bold ? S.HelveticaBold : italic ? S.HelveticaOblique : S.Helvetica;
            }
            fontCache[key] = await out.embedFont(std);
            return fontCache[key];
        };

        // 1. Assemble pages in the editor's order.
        const srcIndices = editPages.filter(p => !p.blank).map(p => p.src - 1);
        const copied = srcIndices.length ? await out.copyPages(srcDoc, srcIndices) : [];
        let ci = 0;
        const outPages = [];
        for (const p of editPages) {
            if (p.blank) {
                outPages.push(out.addPage([p.w, p.h]));
            } else {
                const cp = copied[ci++];
                out.addPage(cp);
                if (p.rotate) {
                    cp.setRotation(PDFLib.degrees((cp.getRotation().angle + p.rotate) % 360));
                }
                outPages.push(cp);
            }
        }

        // 2. Paint objects, in z-order, onto their page.
        for (let i = 0; i < editPages.length; i++) {
            const p = editPages[i];
            const page = outPages[i];
            const R = ((page.getRotation().angle % 360) + 360) % 360;
            const size = page.getSize();
            const W = size.width, H = size.height;

            for (const o of edPageObjects(p.key)) {
                const opacity = o.opacity == null ? 1 : o.opacity;

                if (o.type === 'whiteout' || o.type === 'highlight') {
                    if (!o.fill || o.fill === 'none') continue;
                    const r = edBoxToPdf(R, W, H, o.x, o.y, o.w, o.h);
                    page.drawRectangle({
                        x: r.x, y: r.y, width: r.w, height: r.h,
                        color: edPdfColor(o.fill), opacity: opacity
                    });
                } else if (o.type === 'rect') {
                    const r = edBoxToPdf(R, W, H, o.x, o.y, o.w, o.h);
                    const sw = o.stroke || 2;
                    page.drawRectangle({
                        x: r.x + sw / 2, y: r.y + sw / 2,
                        width: Math.max(0, r.w - sw), height: Math.max(0, r.h - sw),
                        borderColor: edPdfColor(o.strokeColor), borderWidth: sw,
                        borderOpacity: opacity,
                        color: o.fill && o.fill !== 'none' ? edPdfColor(o.fill) : undefined,
                        opacity: o.fill && o.fill !== 'none' ? opacity : undefined
                    });
                } else if (o.type === 'ellipse') {
                    const r = edBoxToPdf(R, W, H, o.x, o.y, o.w, o.h);
                    const sw = o.stroke || 2;
                    page.drawEllipse({
                        x: r.x + r.w / 2, y: r.y + r.h / 2,
                        xScale: Math.max(0.5, r.w / 2 - sw / 2), yScale: Math.max(0.5, r.h / 2 - sw / 2),
                        borderColor: edPdfColor(o.strokeColor), borderWidth: sw,
                        borderOpacity: opacity,
                        color: o.fill && o.fill !== 'none' ? edPdfColor(o.fill) : undefined,
                        opacity: o.fill && o.fill !== 'none' ? opacity : undefined
                    });
                } else if (o.type === 'line' || o.type === 'arrow') {
                    const vx1 = o.flipX ? o.x + o.w : o.x;
                    const vx2 = o.flipX ? o.x : o.x + o.w;
                    const vy1 = o.flipY ? o.y + o.h : o.y;
                    const vy2 = o.flipY ? o.y : o.y + o.h;
                    const s = edVpToPdf(R, W, H, vx1, vy1);
                    const e = edVpToPdf(R, W, H, vx2, vy2);
                    const sw = o.stroke || 2;
                    const col = edPdfColor(o.strokeColor);
                    page.drawLine({ start: s, end: e, thickness: sw, color: col, opacity: opacity });
                    if (o.type === 'arrow') {
                        const head = Math.max(8, sw * 3.5);
                        const ang = Math.atan2(e.y - s.y, e.x - s.x);
                        [-1, 1].forEach(sign => {
                            page.drawLine({
                                start: e,
                                end: {
                                    x: e.x - head * Math.cos(ang + sign * Math.PI / 6),
                                    y: e.y - head * Math.sin(ang + sign * Math.PI / 6)
                                },
                                thickness: sw, color: col, opacity: opacity
                            });
                        });
                    }
                } else if (o.type === 'pen') {
                    const pts = o.points || [];
                    const sw = o.stroke || 2;
                    const col = edPdfColor(o.strokeColor);
                    for (let n = 1; n < pts.length; n++) {
                        page.drawLine({
                            start: edVpToPdf(R, W, H, o.x + pts[n - 1].x, o.y + pts[n - 1].y),
                            end: edVpToPdf(R, W, H, o.x + pts[n].x, o.y + pts[n].y),
                            thickness: sw, color: col, opacity: opacity
                        });
                    }
                } else if (o.type === 'image' || o.type === 'signature') {
                    const embedded = /^data:image\/png/i.test(o.src)
                        ? await out.embedPng(o.src)
                        : await out.embedJpg(o.src);
                    const anchor = edAnchorToPdf(R, W, H, o);
                    page.drawImage(embedded, {
                        x: anchor.x, y: anchor.y, width: o.w, height: o.h,
                        rotate: PDFLib.degrees(R - (o.rot || 0)),
                        opacity: opacity
                    });
                } else if (o.type === 'text') {
                    if (!o.text || !o.text.trim()) continue;

                    if (edNeedsRaster(o.text)) {
                        await edDrawTextAsImage(out, page, R, W, H, o);
                        continue;
                    }

                    const font = await fontFor(o.font || 'Helvetica', !!o.bold, !!o.italic);
                    const measure = (s) => font.widthOfTextAtSize(s, o.size);
                    const lines = edWrapLines(o.text, measure, o.w, !o.autoW);
                    const lh = o.size * 1.18;
                    const align = o.align || 'left';
                    const color = edPdfColor(o.color);
                    const rotate = PDFLib.degrees(R - (o.rot || 0));
                    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;

                    lines.forEach((ln, idx) => {
                        if (!ln) return;
                        const lw = measure(ln);
                        // Baseline-left, relative to the box centre, unrotated.
                        let rx = -o.w / 2;
                        if (align === 'center') rx = -lw / 2;
                        else if (align === 'right') rx = o.w / 2 - lw;
                        const ry = -o.h / 2 + idx * lh + o.size * 0.84;
                        const off = edRotCW(rx, ry, o.rot || 0);
                        const pt = edVpToPdf(R, W, H, cx + off.x, cy + off.y);
                        page.drawText(ln, {
                            x: pt.x, y: pt.y, size: o.size, font: font,
                            color: color, opacity: opacity, rotate: rotate
                        });
                    });
                }
            }
        }

        const bytes = await out.save();
        const blob = new Blob([bytes], { type: 'application/pdf' });
        saveAs(blob, editFile.name.replace(/\.pdf$/i, '') + '_edited.pdf');

        if (window.hideLoader) window.hideLoader();
        if (window.showToast) window.showToast('Edited PDF saved.', 'success');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Saved'; }
        setTimeout(() => { if (btn) btn.innerHTML = label; }, 2500);
    } catch (e) {
        console.error(e);
        if (window.hideLoader) window.hideLoader();
        alert('Could not save the PDF: ' + e.message);
        if (btn) { btn.disabled = false; btn.innerHTML = label; }
    }
}

/* --------------------------------- wiring --------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = edEl('edit-drop-zone');
    const fileInput = edEl('edit-upload');
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
        dropZone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });
    dropZone.addEventListener('drop', (e) => {
        const f = e.dataTransfer.files;
        if (f.length && f[0].type === 'application/pdf') handleEditFile(f[0]);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleEditFile(e.target.files[0]);
    });

    const resetBtn = edEl('edit-reset-btn');
    if (resetBtn) resetBtn.addEventListener('click', resetEditUI);

    document.querySelectorAll('.edit-tool-btn').forEach(b => {
        b.addEventListener('click', () => edSetTool(b.dataset.tool));
    });

    edEl('edit-undo-btn').addEventListener('click', edUndo);
    edEl('edit-redo-btn').addEventListener('click', edRedo);
    edEl('edit-save-btn').addEventListener('click', saveEditedPDF);

    edEl('edit-zoom-in').addEventListener('click', () => edSetZoom(editZoom * 1.2));
    edEl('edit-zoom-out').addEventListener('click', () => edSetZoom(editZoom / 1.2));
    edEl('edit-zoom-fit').addEventListener('click', edFitWidth);

    const pageInput = edEl('edit-page-input');
    edEl('edit-prev-page').addEventListener('click', () => edScrollToPage(parseInt(pageInput.value, 10) - 1));
    edEl('edit-next-page').addEventListener('click', () => edScrollToPage(parseInt(pageInput.value, 10) + 1));
    pageInput.addEventListener('change', () => edScrollToPage(parseInt(pageInput.value, 10)));

    const panelToggle = edEl('edit-pages-toggle');
    panelToggle.addEventListener('click', () => {
        const open = edEl('edit-main').classList.toggle('pages-open');
        panelToggle.classList.toggle('active', open);
        panelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) requestAnimationFrame(edFitWidth);
    });

    edEl('edit-image-upload').addEventListener('change', (e) => {
        if (e.target.files.length) edPlaceImageFile(e.target.files[0]);
        e.target.value = '';
    });

    /* ---- inspector bindings ---- */
    edEl('edit-font-family').addEventListener('change', (e) => edApply(o => { o.font = e.target.value; }));
    edEl('edit-font-size').addEventListener('change', (e) => edApply(o => {
        o.size = edClamp(parseFloat(e.target.value) || 16, 4, 400);
        o.h = Math.max(o.size * 1.18, o.h);
    }));
    edEl('edit-text-color').addEventListener('change', (e) => edApply(o => { o.color = e.target.value; }));
    edEl('edit-bold').addEventListener('click', () => edApply(o => { o.bold = !o.bold; }));
    edEl('edit-italic').addEventListener('click', () => edApply(o => { o.italic = !o.italic; }));
    document.querySelectorAll('#edit-grp-text [data-align]').forEach(b => {
        b.addEventListener('click', () => edApply(o => { o.align = b.dataset.align; o.autoW = false; }));
    });

    edEl('edit-stroke-color').addEventListener('change', (e) => edApply(o => { o.strokeColor = e.target.value; }));
    edEl('edit-stroke-width').addEventListener('input', (e) => {
        edEl('edit-stroke-width-val').textContent = e.target.value + ' pt';
        edApply(o => { o.stroke = parseFloat(e.target.value); }, { history: false, reinspect: false });
    });
    edEl('edit-stroke-width').addEventListener('change', edPushHistory);

    edEl('edit-fill-color').addEventListener('change', (e) => edApply(o => {
        o.fill = e.target.value;
        edEl('edit-fill-none').checked = false;
    }));
    edEl('edit-fill-none').addEventListener('change', (e) => edApply(o => {
        o.fill = e.target.checked ? 'none' : (edEl('edit-fill-color').value || '#ffffff');
    }));

    edEl('edit-opacity').addEventListener('input', (e) => {
        edEl('edit-opacity-val').textContent = Math.round(e.target.value * 100) + '%';
        edApply(o => { o.opacity = parseFloat(e.target.value); }, { history: false, reinspect: false });
    });
    edEl('edit-opacity').addEventListener('change', edPushHistory);

    edEl('edit-rotation').addEventListener('input', (e) => {
        edEl('edit-rotation-val').textContent = e.target.value + '°';
        edApply(o => { o.rot = parseInt(e.target.value, 10); }, { history: false, reinspect: false });
    });
    edEl('edit-rotation').addEventListener('change', edPushHistory);

    ['ix', 'iy', 'iw', 'ih'].forEach(k => {
        edEl('edit-' + k).addEventListener('change', (e) => edApply(o => {
            const v = parseFloat(e.target.value);
            if (isNaN(v)) return;
            if (k === 'ix') o.x = v;
            else if (k === 'iy') o.y = v;
            else if (k === 'iw') { o.w = Math.max(4, v); if (o.type === 'text') o.autoW = false; }
            else o.h = Math.max(4, v);
        }));
    });

    edEl('edit-front').addEventListener('click', () => edBringToFront(editSelectedId));
    edEl('edit-back').addEventListener('click', () => edSendToBack(editSelectedId));
    edEl('edit-duplicate').addEventListener('click', () => edDuplicateObject(editSelectedId));
    edEl('edit-delete').addEventListener('click', () => edDeleteObject(editSelectedId));

    /* ---- signature modal ---- */
    const sigCanvas = edEl('edit-sig-canvas');
    const startSig = (e) => {
        if (!edSigCtx) return;
        edSigDrawing = true;
        const p = edSigPoint(e);
        edSigCtx.strokeStyle = edEl('edit-sig-color').value || '#0b2447';
        edSigCtx.beginPath();
        edSigCtx.moveTo(p.x, p.y);
        e.preventDefault();
    };
    const moveSig = (e) => {
        if (!edSigDrawing) return;
        const p = edSigPoint(e);
        edSigCtx.lineTo(p.x, p.y);
        edSigCtx.stroke();
        edSigDirty = true;
        e.preventDefault();
    };
    const endSig = () => { edSigDrawing = false; };

    sigCanvas.addEventListener('mousedown', startSig);
    sigCanvas.addEventListener('touchstart', startSig, { passive: false });
    window.addEventListener('mousemove', moveSig);
    sigCanvas.addEventListener('touchmove', moveSig, { passive: false });
    window.addEventListener('mouseup', endSig);
    sigCanvas.addEventListener('touchend', endSig);

    edEl('edit-sig-clear').addEventListener('click', edSigClear);
    edEl('edit-sig-cancel').addEventListener('click', edCloseSignatureModal);
    edEl('edit-sig-apply').addEventListener('click', edSigApply);
    edEl('edit-sig-text').addEventListener('input', edSigRenderTyped);
    edEl('edit-sig-font').addEventListener('change', edSigRenderTyped);
    document.querySelectorAll('.edit-sig-tab').forEach(t => {
        t.addEventListener('click', () => {
            document.querySelectorAll('.edit-sig-tab').forEach(x => x.classList.toggle('active', x === t));
            const typed = t.dataset.sigTab === 'type';
            edShow('edit-sig-type-row', typed);
            edSigClear();
            if (typed) edSigRenderTyped();
        });
    });

    /* ---- keyboard ---- */
    window.addEventListener('keydown', (e) => {
        const panel = edEl('edit');
        if (!panel || panel.classList.contains('hidden') || !editFile) return;

        const modalOpen = !edEl('edit-sig-modal').classList.contains('hidden');
        const typing = document.activeElement && (
            document.activeElement.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));

        if (e.key === 'Escape') {
            if (modalOpen) { edCloseSignatureModal(); return; }
            if (document.activeElement && document.activeElement.isContentEditable) {
                document.activeElement.blur();
                return;
            }
            edSelect(null);
            return;
        }
        if (typing || modalOpen) return;

        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? edRedo() : edUndo(); return; }
        if (ctrl && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); edRedo(); return; }
        if (ctrl && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveEditedPDF(); return; }
        if (ctrl && (e.key === 'c' || e.key === 'C')) {
            const o = edObj(editSelectedId);
            if (o) { editClipboard = JSON.parse(JSON.stringify(o)); if (window.showToast) window.showToast('Object copied.', 'info', 1500); }
            return;
        }
        if (ctrl && (e.key === 'v' || e.key === 'V')) {
            if (!editClipboard) return;
            const c = JSON.parse(JSON.stringify(editClipboard));
            c.id = edUid(); c.x += 14; c.y += 14;
            if (!edPage(c.pageKey)) c.pageKey = editPages[0].key;
            edAddObject(c);
            return;
        }
        if (ctrl && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); edDuplicateObject(editSelectedId); return; }

        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (editSelectedId) { e.preventDefault(); edDeleteObject(editSelectedId); }
            return;
        }

        if (/^Arrow(Up|Down|Left|Right)$/.test(e.key) && editSelectedId) {
            e.preventDefault();
            const step = e.shiftKey ? 10 : 1;
            edApply(o => {
                if (e.key === 'ArrowUp') o.y -= step;
                else if (e.key === 'ArrowDown') o.y += step;
                else if (e.key === 'ArrowLeft') o.x -= step;
                else o.x += step;
            }, { reinspect: false });
            edSyncGeomInputs(edObj(editSelectedId));
            return;
        }

        // Single-key tool shortcuts.
        const map = {
            v: 'select', e: 'edittext', t: 'text', w: 'whiteout', i: 'image',
            s: 'signature', h: 'highlight', p: 'pen', l: 'line', a: 'arrow',
            r: 'rect', o: 'ellipse'
        };
        const tool = map[e.key.toLowerCase()];
        if (tool && !ctrl && !e.altKey) { edSetTool(tool); }
    });

    window.addEventListener('resize', () => {
        if (!editFile) return;
        clearTimeout(editZoomTimer);
        editZoomTimer = setTimeout(edApplyZoom, 200);
    });
});
