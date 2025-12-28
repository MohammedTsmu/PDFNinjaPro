// Reorder Tool Logic

let reorderFile = null;
let reorderPdfDoc = null;
let reorderPages = []; // { pageIndex, element }
let reorderSortable = null;

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('reorder-drop-zone');
    const fileInput = document.getElementById('reorder-upload');
    const resetBtn = document.getElementById('reorder-reset-btn');
    const saveBtn = document.getElementById('reorder-save-btn');

    // Drag & Drop
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') handleReorderFile(files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleReorderFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetReorderUI);
    if (saveBtn) saveBtn.addEventListener('click', saveReorderedPDF);
});

async function handleReorderFile(file) {
    reorderFile = file;
    reorderPages = [];

    document.getElementById('reorder-drop-zone').classList.add('hidden');
    document.getElementById('reorder-file-info').classList.remove('hidden');
    document.getElementById('reorder-toolbar').classList.remove('hidden');
    document.getElementById('reorder-grid').classList.remove('hidden');

    document.getElementById('reorder-filename').textContent = file.name;
    document.getElementById('reorder-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + " MB";

    try {
        const arrayBuffer = await file.arrayBuffer();
        reorderPdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
        renderReorderGrid();
    } catch (e) {
        console.error(e);
        alert("Invalid PDF file.");
        resetReorderUI();
    }
}

function resetReorderUI() {
    reorderFile = null;
    reorderPdfDoc = null;
    reorderPages = [];
    if (reorderSortable) {
        reorderSortable.destroy();
        reorderSortable = null;
    }
    document.getElementById('reorder-grid').innerHTML = '';

    document.getElementById('reorder-drop-zone').classList.remove('hidden');
    document.getElementById('reorder-file-info').classList.add('hidden');
    document.getElementById('reorder-toolbar').classList.add('hidden');
    document.getElementById('reorder-grid').classList.add('hidden');
    document.getElementById('reorder-upload').value = '';
}

async function renderReorderGrid() {
    const grid = document.getElementById('reorder-grid');
    grid.innerHTML = '';
    reorderPages = [];

    for (let i = 1; i <= reorderPdfDoc.numPages; i++) {
        const page = await reorderPdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 0.3 }); // Thumbnail size

        const card = document.createElement('div');
        card.className = 'page-card reorder-card';
        card.dataset.pageIndex = i;

        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'canvas-wrapper';
        canvasWrapper.style.width = viewport.width + 'px';
        canvasWrapper.style.height = viewport.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        canvasWrapper.appendChild(canvas);
        card.appendChild(canvasWrapper);

        // Page Number Badge
        const pageNum = document.createElement('div');
        pageNum.className = 'page-num';
        pageNum.textContent = `Page ${i}`;
        card.appendChild(pageNum);

        // Drag Handle Indicator
        const dragIcon = document.createElement('div');
        dragIcon.className = 'drag-handle-icon';
        dragIcon.innerHTML = '<i class="fas fa-grip-vertical"></i>';
        card.appendChild(dragIcon);

        grid.appendChild(card);

        reorderPages.push({
            pageIndex: i,
            element: card
        });
    }

    // Initialize Sortable.js
    reorderSortable = new Sortable(grid, {
        animation: 200,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        handle: '.page-card', // Entire card is draggable
        onEnd: updatePageNumbers
    });
}

function updatePageNumbers() {
    // Update visual page numbers after reorder
    const cards = document.querySelectorAll('#reorder-grid .page-card');
    cards.forEach((card, idx) => {
        const pageNum = card.querySelector('.page-num');
        if (pageNum) {
            pageNum.textContent = `Position ${idx + 1}`;
        }
    });
}

async function saveReorderedPDF() {
    if (!reorderFile) return;
    const btn = document.getElementById('reorder-save-btn');

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    try {
        const arrayBuffer = await reorderFile.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const newPdfDoc = await PDFLib.PDFDocument.create();

        // Get new order from DOM
        const cards = document.querySelectorAll('#reorder-grid .page-card');
        const newOrder = Array.from(cards).map(card => parseInt(card.dataset.pageIndex, 10) - 1);

        const copiedPages = await newPdfDoc.copyPages(pdfDoc, newOrder);
        copiedPages.forEach(page => newPdfDoc.addPage(page));

        const pdfBytes = await newPdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const name = reorderFile.name.replace('.pdf', '_reordered.pdf');
        saveAs(blob, name);

        btn.innerHTML = '<i class="fas fa-check"></i> Done';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-download"></i> Save Reordered PDF';
            btn.disabled = false;
        }, 2000);

    } catch (e) {
        console.error(e);
        alert('Error saving PDF: ' + e.message);
        btn.innerHTML = 'Error';
        btn.disabled = false;
    }
}
