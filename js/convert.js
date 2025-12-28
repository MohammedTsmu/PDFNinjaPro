
// Convert Tool Logic

let convertFile = null;
let convertPdfDoc = null;

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('convert-drop-zone');
    const fileInput = document.getElementById('convert-upload');
    const startBtn = document.getElementById('start-convert-btn');
    const resetBtn = document.getElementById('convert-reset-btn');

    // Quality Slider Update
    const qualityInput = document.getElementById('img-quality');
    const qualityVal = document.getElementById('quality-val');

    if (qualityInput && qualityVal) {
        qualityInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            let text = `High (${val})`;
            if (val >= 1.0) text = "Max (1.0)";
            if (val <= 0.6) text = "Medium (0.6)";
            if (val <= 0.5) text = "Low (0.5)";
            qualityVal.textContent = text;
        });
    }

    // Format Toggle
    const fmtRadios = document.getElementsByName('img-fmt');
    const qualityGroup = document.getElementById('quality-group');

    if (fmtRadios && qualityGroup) {
        fmtRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.value === 'png') {
                    qualityGroup.style.opacity = '0.5';
                    qualityGroup.style.pointerEvents = 'none'; // PNG is lossless
                } else {
                    qualityGroup.style.opacity = '1';
                    qualityGroup.style.pointerEvents = 'auto';
                }
            });
        });
    }

    // Drag & Drop
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
        });

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') handleConvertFile(files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleConvertFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetConvertUI);

    if (startBtn) {
        startBtn.addEventListener('click', startConversion);
    }
});

async function handleConvertFile(file) {
    convertFile = file;

    // UI Update
    document.getElementById('convert-drop-zone').classList.add('hidden');
    document.getElementById('convert-file-info').classList.remove('hidden');
    document.getElementById('convert-settings').classList.remove('hidden');
    document.getElementById('start-convert-btn').classList.remove('hidden');

    document.getElementById('convert-filename').textContent = file.name;
    document.getElementById('convert-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + " MB";

    // Load PDF Document to get page count (optional, but good for range input later)
    try {
        const arrayBuffer = await file.arrayBuffer();
        convertPdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
        // Could enable page range selection here
    } catch (e) {
        console.error(e);
        alert("Invalid PDF file.");
        resetConvertUI();
    }
}

function resetConvertUI() {
    convertFile = null;
    convertPdfDoc = null;

    document.getElementById('convert-drop-zone').classList.remove('hidden');
    document.getElementById('convert-file-info').classList.add('hidden');
    document.getElementById('convert-settings').classList.add('hidden');
    document.getElementById('start-convert-btn').classList.add('hidden');
    document.getElementById('convert-progress-container').classList.add('hidden');
    document.getElementById('convert-upload').value = '';
}

async function startConversion() {
    if (!convertPdfDoc) return;

    const startBtn = document.getElementById('start-convert-btn');
    const progressContainer = document.getElementById('convert-progress-container');
    const progressFill = document.getElementById('convert-progress-fill');
    const currentSpan = document.getElementById('convert-current-page');
    const totalSpan = document.getElementById('convert-total-pages');

    // Get Settings
    const format = document.querySelector('input[name="img-fmt"]:checked').value; // 'jpeg' or 'png'
    const quality = parseFloat(document.getElementById('img-quality').value);

    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    progressContainer.classList.remove('hidden');

    const totalPages = convertPdfDoc.numPages;
    totalSpan.textContent = totalPages;

    const zip = new JSZip();
    const imgFolder = zip.folder("images");

    try {
        for (let i = 1; i <= totalPages; i++) {
            currentSpan.textContent = i;
            progressFill.style.width = ((i / totalPages) * 100) + '%';

            // Render Page
            const page = await convertPdfDoc.getPage(i);
            const scale = 2.0; // High Quality
            const viewport = page.getViewport({ scale: scale });

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport: viewport }).promise;

            // Convert to Blob
            const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
            const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, quality));

            // Add to Zip
            const ext = format === 'png' ? 'png' : 'jpg';
            const padNum = i.toString().padStart(3, '0');
            imgFolder.file(`page_${padNum}.${ext}`, blob);

            // Breathing Room
            if (i % 5 === 0) await new Promise(r => setTimeout(r, 10));
        }

        // Generate Zip
        startBtn.innerHTML = '<i class="fas fa-file-archive"></i> Zipping...';
        const zipBlob = await zip.generateAsync({ type: "blob" });

        // Save
        const fileName = convertFile.name.replace('.pdf', '') + '_images.zip';
        saveAs(zipBlob, fileName);

        startBtn.innerHTML = '<i class="fas fa-check"></i> Done';
        startBtn.className = 'btn btn-success';

        setTimeout(() => {
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="fas fa-bolt"></i> Convert Again';
            startBtn.className = 'btn btn-primary';
            progressContainer.classList.add('hidden');
        }, 3000);

    } catch (e) {
        console.error(e);
        alert('Error converting: ' + e.message);
        startBtn.disabled = false;
        startBtn.innerHTML = 'Try Again';
    }
}
