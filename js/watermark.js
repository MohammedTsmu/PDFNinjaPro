// Watermark Tool — stamp a diagonal text watermark across every page of a PDF.
// pdf-lib loads the original document (keeping all existing content), embeds
// Helvetica, and draws one centered rotated stamp on each page.
//
// A live "page 1" preview (rendered with pdf.js + a canvas overlay) mirrors the
// stamp so the user sees roughly what they'll get before saving.

let watermarkFile = null;
let watermarkPdfDoc = null;      // pdf.js doc, for the preview only
let watermarkPreviewPage = null;
let watermarkPreviewTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('watermark-drop-zone');
    const fileInput = document.getElementById('watermark-upload');
    const startBtn = document.getElementById('start-watermark-btn');
    const resetBtn = document.getElementById('watermark-reset-btn');

    // Live-updating controls -> refresh the labels + preview.
    const text = document.getElementById('watermark-text');
    const color = document.getElementById('watermark-color');
    const opacity = document.getElementById('watermark-opacity');
    const size = document.getElementById('watermark-size');
    const rotation = document.getElementById('watermark-rotation');

    if (text) text.addEventListener('input', scheduleWatermarkPreview);
    if (color) color.addEventListener('input', scheduleWatermarkPreview);
    if (opacity) opacity.addEventListener('input', (e) => {
        document.getElementById('watermark-opacity-val').textContent =
            Math.round(parseFloat(e.target.value) * 100) + '%';
        scheduleWatermarkPreview();
    });
    if (size) size.addEventListener('input', (e) => {
        document.getElementById('watermark-size-val').textContent = e.target.value;
        scheduleWatermarkPreview();
    });
    if (rotation) rotation.addEventListener('input', (e) => {
        document.getElementById('watermark-rotation-val').textContent = e.target.value + '°';
        scheduleWatermarkPreview();
    });

    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
            dropZone.addEventListener(evt, preventDefaults, false);
        });
        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        ['dragenter', 'dragover'].forEach(evt => {
            dropZone.addEventListener(evt, () => dropZone.classList.add('drag-over'), false);
        });
        ['dragleave', 'drop'].forEach(evt => {
            dropZone.addEventListener(evt, () => dropZone.classList.remove('drag-over'), false);
        });

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') handleWatermarkFile(files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleWatermarkFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetWatermarkUI);
    if (startBtn) startBtn.addEventListener('click', startWatermark);
});

async function handleWatermarkFile(file) {
    watermarkFile = file;

    document.getElementById('watermark-drop-zone').classList.add('hidden');
    document.getElementById('watermark-file-info').classList.remove('hidden');
    document.getElementById('watermark-settings').classList.remove('hidden');
    document.getElementById('start-watermark-btn').classList.remove('hidden');

    document.getElementById('watermark-filename').textContent = file.name;
    document.getElementById('watermark-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

    try {
        const arrayBuffer = await file.arrayBuffer();
        // pdf.js consumes the buffer, so keep an untouched copy for pdf-lib later.
        watermarkPdfDoc = await pdfjsLib.getDocument(arrayBuffer.slice(0)).promise;
        watermarkPreviewPage = await watermarkPdfDoc.getPage(1);
        document.getElementById('watermark-preview-wrap').classList.remove('hidden');
        renderWatermarkPreview();
    } catch (e) {
        console.error(e);
        alert('Invalid PDF file.');
        resetWatermarkUI();
    }
}

function resetWatermarkUI() {
    watermarkFile = null;
    watermarkPdfDoc = null;
    watermarkPreviewPage = null;

    document.getElementById('watermark-drop-zone').classList.remove('hidden');
    document.getElementById('watermark-file-info').classList.add('hidden');
    document.getElementById('watermark-settings').classList.add('hidden');
    document.getElementById('watermark-preview-wrap').classList.add('hidden');
    document.getElementById('start-watermark-btn').classList.add('hidden');
    document.getElementById('watermark-progress-container').classList.add('hidden');
    document.getElementById('watermark-upload').value = '';
}

// ---- Settings ----

function currentWatermarkSettings() {
    return {
        text: document.getElementById('watermark-text').value || 'CONFIDENTIAL',
        color: document.getElementById('watermark-color').value,      // #rrggbb
        opacity: parseFloat(document.getElementById('watermark-opacity').value),
        size: parseInt(document.getElementById('watermark-size').value, 10),
        rotation: parseInt(document.getElementById('watermark-rotation').value, 10) // degrees
    };
}

function hexToRgb01(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return { r: 1, g: 0, b: 0 };
    return {
        r: parseInt(m[1], 16) / 255,
        g: parseInt(m[2], 16) / 255,
        b: parseInt(m[3], 16) / 255
    };
}

// ---- Live preview (pdf.js render + canvas text overlay) ----

function scheduleWatermarkPreview() {
    if (!watermarkPreviewPage) return;
    clearTimeout(watermarkPreviewTimer);
    watermarkPreviewTimer = setTimeout(renderWatermarkPreview, 150);
}

async function renderWatermarkPreview() {
    if (!watermarkPreviewPage) return;
    try {
        const s = currentWatermarkSettings();
        const scale = 1.1;
        const viewport = watermarkPreviewPage.getViewport({ scale });
        const canvas = document.getElementById('watermark-preview-canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await watermarkPreviewPage.render({ canvasContext: ctx, viewport }).promise;

        // Overlay the stamp centered, rotated. Canvas y grows downward, so use
        // -rotation to match pdf-lib's counter-clockwise (y-up) rotation.
        ctx.save();
        ctx.globalAlpha = s.opacity;
        ctx.fillStyle = s.color;
        ctx.font = `bold ${s.size * scale}px Helvetica, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(-s.rotation * Math.PI / 180);
        ctx.fillText(s.text, 0, 0);
        ctx.restore();
    } catch (e) {
        console.error('Watermark preview error:', e);
    }
}

// ---- Export ----

async function startWatermark() {
    if (!watermarkFile) return;

    const startBtn = document.getElementById('start-watermark-btn');
    const progressContainer = document.getElementById('watermark-progress-container');
    const progressFill = document.getElementById('watermark-progress-fill');
    const currentSpan = document.getElementById('watermark-current-page');
    const totalSpan = document.getElementById('watermark-total-pages');

    const s = currentWatermarkSettings();
    const rgb = hexToRgb01(s.color);

    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Stamping...';
    progressContainer.classList.remove('hidden');
    if (window.showLoader) window.showLoader('Applying watermark…');

    try {
        const arrayBuffer = await watermarkFile.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

        const pages = pdfDoc.getPages();
        const total = pages.length;
        totalSpan.textContent = total;

        const angle = s.rotation * Math.PI / 180; // radians, counter-clockwise
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const textWidth = font.widthOfTextAtSize(s.text, s.size);

        for (let i = 0; i < total; i++) {
            currentSpan.textContent = i + 1;
            progressFill.style.width = (((i + 1) / total) * 100) + '%';

            const page = pages[i];
            const { width: pw, height: ph } = page.getSize();

            // Center the (rotated) text: pdf-lib anchors drawText at the baseline
            // start, so shift back by half the text width along the rotated axis.
            const x = pw / 2 - (textWidth / 2) * cos;
            const y = ph / 2 - (textWidth / 2) * sin;

            page.drawText(s.text, {
                x,
                y,
                size: s.size,
                font,
                color: PDFLib.rgb(rgb.r, rgb.g, rgb.b),
                opacity: s.opacity,
                rotate: PDFLib.degrees(s.rotation)
            });
        }

        startBtn.innerHTML = '<i class="fas fa-stamp"></i> Saving...';
        const pdfBytes = await pdfDoc.save();
        if (window.hideLoader) window.hideLoader();

        const outBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        saveAs(outBlob, watermarkFile.name.replace(/\.pdf$/i, '') + '_watermarked.pdf');

        if (window.showToast) window.showToast('Watermarked PDF ready — ' + total + ' page(s).', 'success');
        startBtn.innerHTML = '<i class="fas fa-check"></i> Done';
        startBtn.className = 'btn btn-success';
        startBtn.style.width = '100%';

        setTimeout(() => {
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="fas fa-stamp"></i> Watermark Again';
            startBtn.className = 'btn btn-primary';
            startBtn.style.width = '100%';
            progressContainer.classList.add('hidden');
        }, 3000);

    } catch (e) {
        console.error(e);
        if (window.hideLoader) window.hideLoader();
        alert('Error creating watermarked PDF: ' + e.message);
        startBtn.disabled = false;
        startBtn.innerHTML = '<i class="fas fa-stamp"></i> Try Again';
    }
}
