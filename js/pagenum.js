// Add Page Numbers Tool Logic
// Stamps a page number onto every page using pdf-lib + StandardFonts.Helvetica.

let pagenumFile = null;

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('pagenum-drop-zone');
    const fileInput = document.getElementById('pagenum-upload');
    const resetBtn = document.getElementById('pagenum-reset-btn');
    const saveBtn = document.getElementById('start-pagenum-btn');

    // Drag & Drop
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') handlePagenumFile(files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handlePagenumFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetPagenumUI);
    if (saveBtn) saveBtn.addEventListener('click', savePagenumPDF);
});

function handlePagenumFile(file) {
    pagenumFile = file;

    document.getElementById('pagenum-drop-zone').classList.add('hidden');
    document.getElementById('pagenum-file-info').classList.remove('hidden');
    document.getElementById('pagenum-settings').classList.remove('hidden');
    document.getElementById('start-pagenum-btn').classList.remove('hidden');

    document.getElementById('pagenum-filename').textContent = file.name;
    document.getElementById('pagenum-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + " MB";
}

function resetPagenumUI() {
    pagenumFile = null;

    document.getElementById('pagenum-drop-zone').classList.remove('hidden');
    document.getElementById('pagenum-file-info').classList.add('hidden');
    document.getElementById('pagenum-settings').classList.add('hidden');
    document.getElementById('start-pagenum-btn').classList.add('hidden');
    document.getElementById('pagenum-upload').value = '';
}

// Build the visible label for a given human page number and total count.
function buildPagenumLabel(format, humanNumber, total) {
    if (format === 'page') return 'Page ' + humanNumber;
    if (format === 'slash') return humanNumber + ' / ' + total;
    return String(humanNumber);
}

async function savePagenumPDF() {
    if (!pagenumFile) return;
    const btn = document.getElementById('start-pagenum-btn');

    const position = (document.querySelector('input[name="pagenum-position"]:checked') || {}).value || 'bottom-center';
    const [vPos, hAlign] = position.split('-'); // top|bottom , left|center|right
    const format = document.getElementById('pagenum-format').value;
    const start = parseInt(document.getElementById('pagenum-start').value, 10) || 0;
    const size = parseFloat(document.getElementById('pagenum-size').value) || 11;
    const margin = parseFloat(document.getElementById('pagenum-margin').value) || 0;
    const hex = document.getElementById('pagenum-color').value || '#000000';
    const color = PDFLib.rgb(
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255
    );

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    try {
        const arrayBuffer = await pagenumFile.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
        const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
        const pages = pdfDoc.getPages();
        const total = pages.length;

        pages.forEach((page, j) => {
            const humanNumber = start + j;
            const label = buildPagenumLabel(format, humanNumber, total);
            const { width, height } = page.getSize();
            const textWidth = font.widthOfTextAtSize(label, size);

            let x;
            if (hAlign === 'left') x = margin;
            else if (hAlign === 'right') x = width - margin - textWidth;
            else x = (width - textWidth) / 2; // center

            // Baseline sits `margin` from the bottom edge, or `margin` below the
            // top edge (leaving room for the glyph height) for top positions.
            const y = vPos === 'top' ? height - margin - size : margin;

            page.drawText(label, { x, y, size, font, color });
        });

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const name = pagenumFile.name.replace(/\.pdf$/i, '') + '_numbered.pdf';
        saveAs(blob, name);

        btn.innerHTML = '<i class="fas fa-check"></i> Done';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-download"></i> Add Numbers & Save';
            btn.disabled = false;
        }, 2000);

    } catch (e) {
        console.error(e);
        alert('Error saving PDF: ' + e.message);
        btn.innerHTML = 'Error';
        btn.disabled = false;
    }
}
