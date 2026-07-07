// Scannify Tool — turn a clean digital PDF into a scanned-looking PDF.
// Each page is rasterised, given paper texture / skew / noise, then re-embedded
// as a JPEG image into a fresh PDF (image-only, like a real scan).

let scanFile = null;
let scanPdfDoc = null;

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('scan-drop-zone');
    const fileInput = document.getElementById('scan-upload');
    const startBtn = document.getElementById('start-scan-btn');
    const resetBtn = document.getElementById('scan-reset-btn');
    const intensity = document.getElementById('scan-intensity');
    const intensityVal = document.getElementById('scan-intensity-val');

    if (intensity && intensityVal) {
        intensity.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10);
            let label = 'Medium';
            if (v <= 0) label = 'None (clean)';
            else if (v <= 30) label = 'Light';
            else if (v <= 60) label = 'Medium';
            else if (v <= 80) label = 'Heavy';
            else label = 'Old photocopy';
            intensityVal.textContent = label;
        });
    }

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
            if (files.length > 0 && files[0].type === 'application/pdf') handleScanFile(files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleScanFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetScanUI);
    if (startBtn) startBtn.addEventListener('click', startScannify);
});

async function handleScanFile(file) {
    scanFile = file;

    document.getElementById('scan-drop-zone').classList.add('hidden');
    document.getElementById('scan-file-info').classList.remove('hidden');
    document.getElementById('scan-settings').classList.remove('hidden');
    document.getElementById('start-scan-btn').classList.remove('hidden');

    document.getElementById('scan-filename').textContent = file.name;
    document.getElementById('scan-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

    try {
        const arrayBuffer = await file.arrayBuffer();
        scanPdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
    } catch (e) {
        console.error(e);
        alert('Invalid PDF file.');
        resetScanUI();
    }
}

function resetScanUI() {
    scanFile = null;
    scanPdfDoc = null;

    document.getElementById('scan-drop-zone').classList.remove('hidden');
    document.getElementById('scan-file-info').classList.add('hidden');
    document.getElementById('scan-settings').classList.add('hidden');
    document.getElementById('start-scan-btn').classList.add('hidden');
    document.getElementById('scan-progress-container').classList.add('hidden');
    document.getElementById('scan-upload').value = '';
}

// Apply grayscale / contrast / paper noise in place.
function applyScanEffects(imgData, opts) {
    const d = imgData.data;
    const c = opts.contrast;
    const intercept = 128 * (1 - c);
    for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i + 1], b = d[i + 2];
        if (opts.grayscale) {
            const v = 0.299 * r + 0.587 * g + 0.114 * b;
            r = g = b = v;
        }
        // Contrast
        r = r * c + intercept;
        g = g * c + intercept;
        b = b * c + intercept;
        // Paper noise
        if (opts.noise > 0) {
            const n = (Math.random() - 0.5) * opts.noise;
            r += n; g += n; b += n;
        }
        d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
}

async function startScannify() {
    if (!scanPdfDoc) return;

    const startBtn = document.getElementById('start-scan-btn');
    const progressContainer = document.getElementById('scan-progress-container');
    const progressFill = document.getElementById('scan-progress-fill');
    const currentSpan = document.getElementById('scan-current-page');
    const totalSpan = document.getElementById('scan-total-pages');

    const grayscale = document.querySelector('input[name="scan-color"]:checked').value === 'gray';
    const intensity = parseInt(document.getElementById('scan-intensity').value, 10) / 100; // 0..1

    // Map intensity to effect strength.
    const rotationMax = intensity * 1.1;          // degrees of random skew
    const noiseAmount = intensity * 20;           // +/- luminance jitter
    const contrast = 1 + intensity * 0.18;        // mild contrast boost
    const quality = 0.8 - intensity * 0.18;       // lower quality = more "scanned"

    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...';
    progressContainer.classList.remove('hidden');
    if (window.showLoader) window.showLoader('Scannifying your PDF…');

    const total = scanPdfDoc.numPages;
    totalSpan.textContent = total;

    try {
        const outPdf = await PDFLib.PDFDocument.create();

        for (let i = 1; i <= total; i++) {
            currentSpan.textContent = i;
            progressFill.style.width = ((i / total) * 100) + '%';
            if (window.updateLoader) window.updateLoader('Scanning page ' + i + ' of ' + total + '…');

            const page = await scanPdfDoc.getPage(i);
            const scale = 2.0;
            const viewport = page.getViewport({ scale });
            const pageDims = page.getViewport({ scale: 1 }); // PDF points for output page size

            // 1. Render the page.
            const src = document.createElement('canvas');
            src.width = viewport.width;
            src.height = viewport.height;
            await page.render({ canvasContext: src.getContext('2d'), viewport }).promise;

            // 2. Compose onto an off-white "paper" with a slight skew.
            const out = document.createElement('canvas');
            out.width = viewport.width;
            out.height = viewport.height;
            const ctx = out.getContext('2d');
            ctx.fillStyle = grayscale ? 'rgb(249, 249, 247)' : 'rgb(250, 249, 245)';
            ctx.fillRect(0, 0, out.width, out.height);

            const angle = (Math.random() - 0.5) * 2 * rotationMax * Math.PI / 180;
            ctx.save();
            ctx.translate(out.width / 2, out.height / 2);
            ctx.rotate(angle);
            const shrink = 0.985; // keep rotated content inside the page
            ctx.drawImage(src, -out.width / 2 * shrink, -out.height / 2 * shrink,
                out.width * shrink, out.height * shrink);
            ctx.restore();

            // 3. Post-process pixels (grayscale / contrast / noise).
            const imgData = ctx.getImageData(0, 0, out.width, out.height);
            applyScanEffects(imgData, { grayscale, contrast, noise: noiseAmount });
            ctx.putImageData(imgData, 0, 0);

            // 4. Embed as JPEG into the output PDF at the original page size.
            const blob = await new Promise(res => out.toBlob(res, 'image/jpeg', Math.max(0.5, quality)));
            const jpgBytes = new Uint8Array(await blob.arrayBuffer());
            const jpg = await outPdf.embedJpg(jpgBytes);
            const newPage = outPdf.addPage([pageDims.width, pageDims.height]);
            newPage.drawImage(jpg, { x: 0, y: 0, width: pageDims.width, height: pageDims.height });

            page.cleanup();
            if (i % 3 === 0) await new Promise(r => setTimeout(r, 10));
        }

        startBtn.innerHTML = '<i class="fas fa-file-archive"></i> Saving...';
        const pdfBytes = await outPdf.save();
        if (window.hideLoader) window.hideLoader();

        const outBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        saveAs(outBlob, scanFile.name.replace(/\.pdf$/i, '') + '_scanned.pdf');

        if (window.showToast) window.showToast('Scanned PDF ready — ' + total + ' page(s).', 'success');
        startBtn.innerHTML = '<i class="fas fa-check"></i> Done';
        startBtn.className = 'btn btn-success';
        startBtn.style.width = '100%';

        setTimeout(() => {
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="fas fa-print"></i> Scan Again';
            startBtn.className = 'btn btn-primary';
            startBtn.style.width = '100%';
            progressContainer.classList.add('hidden');
        }, 3000);

    } catch (e) {
        console.error(e);
        if (window.hideLoader) window.hideLoader();
        alert('Error creating scanned PDF: ' + e.message);
        startBtn.disabled = false;
        startBtn.innerHTML = '<i class="fas fa-print"></i> Try Again';
    }
}
