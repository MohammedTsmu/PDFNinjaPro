// Background Tool Logic

let backgroundFile = null;
let backgroundPdfDoc = null;
let backgroundPages = []; // { pageIndex, selected, element }

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('background-drop-zone');
    const fileInput = document.getElementById('background-upload');
    const resetBtn = document.getElementById('background-reset-btn');
    const saveBtn = document.getElementById('background-save-btn');
    const selectAllBtn = document.getElementById('background-select-all');
    const opacityInput = document.getElementById('background-opacity');
    const opacityValue = document.getElementById('background-opacity-value');

    // Drag & Drop
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') handleBackgroundFile(files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleBackgroundFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetBackgroundUI);
    if (saveBtn) saveBtn.addEventListener('click', saveBackgroundPDF);
    if (selectAllBtn) selectAllBtn.addEventListener('click', selectAllPages);

    // Opacity Slider
    if (opacityInput && opacityValue) {
        opacityInput.addEventListener('input', () => {
            opacityValue.textContent = Math.round(opacityInput.value * 100) + '%';
        });
    }
});

async function handleBackgroundFile(file) {
    backgroundFile = file;
    backgroundPages = [];

    document.getElementById('background-drop-zone').classList.add('hidden');
    document.getElementById('background-file-info').classList.remove('hidden');
    document.getElementById('background-toolbar').classList.remove('hidden');
    document.getElementById('background-grid').classList.remove('hidden');

    document.getElementById('background-filename').textContent = file.name;
    document.getElementById('background-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + " MB";

    try {
        const arrayBuffer = await file.arrayBuffer();
        backgroundPdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
        renderBackgroundGrid();
    } catch (e) {
        console.error(e);
        alert("Invalid PDF file.");
        resetBackgroundUI();
    }
}

function resetBackgroundUI() {
    backgroundFile = null;
    backgroundPdfDoc = null;
    backgroundPages = [];
    document.getElementById('background-grid').innerHTML = '';

    document.getElementById('background-drop-zone').classList.remove('hidden');
    document.getElementById('background-file-info').classList.add('hidden');
    document.getElementById('background-toolbar').classList.add('hidden');
    document.getElementById('background-grid').classList.add('hidden');
    document.getElementById('background-upload').value = '';
}

async function renderBackgroundGrid() {
    const grid = document.getElementById('background-grid');
    grid.innerHTML = '';
    backgroundPages = [];

    const totalPages = backgroundPdfDoc.numPages;
    const BATCH_SIZE = 10; // Render 10 pages at a time
    const BATCH_DELAY = 50; // 50ms delay between batches

    for (let i = 1; i <= totalPages; i++) {
        // Create placeholder card first (fast, no rendering)
        const card = document.createElement('div');
        card.className = 'page-card background-card loading';
        card.dataset.pageIndex = i;

        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'canvas-wrapper';
        canvasWrapper.style.width = '150px'; // Placeholder size
        canvasWrapper.style.height = '200px';
        canvasWrapper.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:24px; color:rgba(255,255,255,0.3);"></i>';
        card.appendChild(canvasWrapper);

        const pageNum = document.createElement('div');
        pageNum.className = 'page-num';
        pageNum.textContent = `Page ${i}`;
        card.appendChild(pageNum);

        const checkbox = document.createElement('div');
        checkbox.className = 'page-checkbox';
        checkbox.innerHTML = '<i class="fas fa-check"></i>';
        card.appendChild(checkbox);

        grid.appendChild(card);

        const pageData = {
            pageIndex: i,
            selected: false,
            element: card,
            rendered: false
        };
        backgroundPages.push(pageData);

        card.addEventListener('click', () => {
            pageData.selected = !pageData.selected;
            card.classList.toggle('selected', pageData.selected);
        });
    }

    // Use IntersectionObserver for true lazy loading
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const card = entry.target;
                const pageIndex = parseInt(card.dataset.pageIndex, 10);
                renderSinglePage(pageIndex);
                observer.unobserve(card); // Stop observing once rendered
            }
        });
    }, {
        root: null, // viewport
        rootMargin: '200px', // Start loading 200px before visible
        threshold: 0
    });

    // Observe all cards
    backgroundPages.forEach(p => observer.observe(p.element));
}

async function renderSinglePage(pageIndex) {
    const pageData = backgroundPages[pageIndex - 1];
    if (!pageData || pageData.rendered) return;

    try {
        const page = await backgroundPdfDoc.getPage(pageIndex);
        const viewport = page.getViewport({ scale: 0.2 }); // Even smaller for large docs

        const card = pageData.element;
        const canvasWrapper = card.querySelector('.canvas-wrapper');
        canvasWrapper.innerHTML = '';
        canvasWrapper.style.width = viewport.width + 'px';
        canvasWrapper.style.height = viewport.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        canvasWrapper.appendChild(canvas);
        card.classList.remove('loading');
        pageData.rendered = true;
    } catch (e) {
        console.error('Error rendering page', pageIndex, e);
    }
}

function selectAllPages() {
    const allSelected = backgroundPages.every(p => p.selected);
    backgroundPages.forEach(p => {
        p.selected = !allSelected;
        p.element.classList.toggle('selected', p.selected);
    });
}

async function saveBackgroundPDF() {
    if (!backgroundFile) return;

    const selectedPages = backgroundPages.filter(p => p.selected);
    if (selectedPages.length === 0) {
        alert('Please select at least one page.');
        return;
    }

    const btn = document.getElementById('background-save-btn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    try {
        const backgroundColor = document.getElementById('background-color').value;
        const opacity = parseFloat(document.getElementById('background-opacity').value);

        const arrayBuffer = await backgroundFile.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const newPdfDoc = await PDFLib.PDFDocument.create();

        // Copy all pages, apply background to selected ones
        for (let i = 0; i < pdfDoc.getPageCount(); i++) {
            const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
            const { width, height } = copiedPage.getSize();

            const isSelected = selectedPages.some(p => p.pageIndex === i + 1);

            if (isSelected) {
                // Create new page with background
                const newPage = newPdfDoc.addPage([width, height]);

                // Draw background rectangle
                newPage.drawRectangle({
                    x: 0,
                    y: 0,
                    width: width,
                    height: height,
                    color: PDFLib.rgb(
                        parseInt(backgroundColor.slice(1, 3), 16) / 255,
                        parseInt(backgroundColor.slice(3, 5), 16) / 255,
                        parseInt(backgroundColor.slice(5, 7), 16) / 255
                    ),
                    opacity: opacity
                });

                // Embed and draw original page on top
                const embeddedPage = await newPdfDoc.embedPage(copiedPage);
                newPage.drawPage(embeddedPage);
            } else {
                // Just add the page as-is
                newPdfDoc.addPage(copiedPage);
            }
        }

        const pdfBytes = await newPdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const name = backgroundFile.name.replace('.pdf', '_background.pdf');
        saveAs(blob, name);

        btn.innerHTML = '<i class="fas fa-check"></i> Done';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-download"></i> Save PDF';
            btn.disabled = false;
        }, 2000);

    } catch (e) {
        console.error(e);
        alert('Error saving PDF: ' + e.message);
        btn.innerHTML = 'Error';
        btn.disabled = false;
    }
}
