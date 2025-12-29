// Rotate Tool Logic

let rotateFile = null;
let rotatePdfDoc = null;
let rotatePages = []; // { pageIndex, rotation, element }

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('rotate-drop-zone');
    const fileInput = document.getElementById('rotate-upload');
    const resetBtn = document.getElementById('rotate-reset-btn');
    const saveBtn = document.getElementById('rotate-save-btn');
    const allLeftBtn = document.getElementById('rotate-all-left');
    const allRightBtn = document.getElementById('rotate-all-right');
    const resetAllBtn = document.getElementById('rotate-reset-all');

    // Drag & Drop
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') handleRotateFile(files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleRotateFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetRotateUI);
    if (saveBtn) saveBtn.addEventListener('click', saveRotatedPDF);

    if (allLeftBtn) allLeftBtn.addEventListener('click', () => rotateAllPages(-90));
    if (allRightBtn) allRightBtn.addEventListener('click', () => rotateAllPages(90));
    if (resetAllBtn) resetAllBtn.addEventListener('click', resetAllRotations);
});

async function handleRotateFile(file) {
    rotateFile = file;
    rotatePages = [];

    document.getElementById('rotate-drop-zone').classList.add('hidden');
    document.getElementById('rotate-file-info').classList.remove('hidden');
    document.getElementById('rotate-toolbar').classList.remove('hidden');
    document.getElementById('rotate-grid').classList.remove('hidden');

    document.getElementById('rotate-filename').textContent = file.name;
    document.getElementById('rotate-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + " MB";

    try {
        const arrayBuffer = await file.arrayBuffer();
        rotatePdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
        renderRotateGrid();
    } catch (e) {
        console.error(e);
        alert("Invalid PDF file.");
        resetRotateUI();
    }
}

function resetRotateUI() {
    rotateFile = null;
    rotatePdfDoc = null;
    rotatePages = [];
    document.getElementById('rotate-grid').innerHTML = '';

    document.getElementById('rotate-drop-zone').classList.remove('hidden');
    document.getElementById('rotate-file-info').classList.add('hidden');
    document.getElementById('rotate-toolbar').classList.add('hidden');
    document.getElementById('rotate-grid').classList.add('hidden');
    document.getElementById('rotate-upload').value = '';
}

async function renderRotateGrid() {
    const grid = document.getElementById('rotate-grid');
    grid.innerHTML = '';
    rotatePages = [];

    const totalPages = rotatePdfDoc.numPages;
    const BATCH_SIZE = 10;
    const BATCH_DELAY = 50;

    // Create all placeholders first
    for (let i = 1; i <= totalPages; i++) {
        const card = document.createElement('div');
        card.className = 'page-card loading';
        card.dataset.pageIndex = i;

        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'canvas-wrapper';
        canvasWrapper.style.width = '150px';
        canvasWrapper.style.height = '200px';
        canvasWrapper.style.transition = 'transform 0.3s ease';
        canvasWrapper.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:24px; color:rgba(255,255,255,0.3);"></i>';
        card.appendChild(canvasWrapper);

        const pageNum = document.createElement('div');
        pageNum.className = 'page-num';
        pageNum.textContent = `Page ${i}`;
        card.appendChild(pageNum);

        const controls = document.createElement('div');
        controls.className = 'rotate-controls';
        controls.innerHTML = `
            <button class="btn-rotate-left" title="Rotate Left"><i class="fas fa-undo"></i></button>
            <span class="rotation-display">0°</span>
            <button class="btn-rotate-right" title="Rotate Right"><i class="fas fa-redo"></i></button>
        `;
        card.appendChild(controls);

        grid.appendChild(card);

        const pageData = {
            pageIndex: i,
            rotation: 0,
            element: card,
            canvasWrapper: canvasWrapper,
            display: controls.querySelector('.rotation-display'),
            rendered: false
        };
        rotatePages.push(pageData);

        controls.querySelector('.btn-rotate-left').addEventListener('click', () => rotatePage(pageData, -90));
        controls.querySelector('.btn-rotate-right').addEventListener('click', () => rotatePage(pageData, 90));
    }

    // Use IntersectionObserver for true lazy loading
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const card = entry.target;
                const pageIndex = parseInt(card.dataset.pageIndex, 10);
                renderRotatePage(pageIndex);
                observer.unobserve(card);
            }
        });
    }, {
        root: null,
        rootMargin: '200px',
        threshold: 0
    });

    rotatePages.forEach(p => observer.observe(p.element));
}

async function renderRotatePage(pageIndex) {
    const pageData = rotatePages[pageIndex - 1];
    if (!pageData || pageData.rendered) return;

    try {
        const page = await rotatePdfDoc.getPage(pageIndex);
        const viewport = page.getViewport({ scale: 0.2 });

        const canvasWrapper = pageData.canvasWrapper;
        canvasWrapper.innerHTML = '';
        canvasWrapper.style.width = viewport.width + 'px';
        canvasWrapper.style.height = viewport.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        canvasWrapper.appendChild(canvas);
        pageData.element.classList.remove('loading');
        pageData.rendered = true;
    } catch (e) {
        console.error('Error rendering page', pageIndex, e);
    }
}

function rotatePage(pageData, delta) {
    pageData.rotation = (pageData.rotation + delta + 360) % 360;
    pageData.canvasWrapper.style.transform = `rotate(${pageData.rotation}deg)`;
    pageData.display.textContent = `${pageData.rotation}°`;
}

function rotateAllPages(delta) {
    rotatePages.forEach(p => rotatePage(p, delta));
}

function resetAllRotations() {
    rotatePages.forEach(p => {
        p.rotation = 0;
        p.canvasWrapper.style.transform = `rotate(0deg)`;
        p.display.textContent = `0°`;
    });
}

async function saveRotatedPDF() {
    if (!rotateFile) return;
    const btn = document.getElementById('rotate-save-btn');

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    try {
        const arrayBuffer = await rotateFile.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
        const pages = pdfDoc.getPages();

        rotatePages.forEach(p => {
            if (p.rotation !== 0) {
                const page = pages[p.pageIndex - 1];
                const currentRotation = page.getRotation().angle;
                page.setRotation(PDFLib.degrees(currentRotation + p.rotation));
            }
        });

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const name = rotateFile.name.replace('.pdf', '_rotated.pdf');
        saveAs(blob, name);

        btn.innerHTML = '<i class="fas fa-check"></i> Done';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-download"></i> Save Rotated PDF';
            btn.disabled = false;
        }, 2000);

    } catch (e) {
        console.error(e);
        alert('Error saving PDF: ' + e.message);
        btn.innerHTML = 'Error';
        btn.disabled = false;
    }
}