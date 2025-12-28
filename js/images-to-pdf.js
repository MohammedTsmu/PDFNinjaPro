// Images to PDF Tool Logic

let img2pdfImages = []; // { file, dataUrl, element }
let img2pdfSortable = null;

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('img2pdf-drop-zone');
    const fileInput = document.getElementById('img2pdf-upload');
    const resetBtn = document.getElementById('img2pdf-reset-btn');
    const saveBtn = document.getElementById('img2pdf-save-btn');
    const addMoreBtn = document.getElementById('img2pdf-add-more');

    // Drag & Drop
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        dropZone.addEventListener('dragenter', () => dropZone.classList.add('dragover'));
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            dropZone.classList.remove('dragover');
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
            if (files.length > 0) handleImages(files);
        });

        fileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            if (files.length > 0) handleImages(files);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetImg2PdfUI);
    if (saveBtn) saveBtn.addEventListener('click', createPDF);
    if (addMoreBtn) addMoreBtn.addEventListener('click', () => fileInput.click());
});

async function handleImages(files) {
    // Show UI
    document.getElementById('img2pdf-drop-zone').classList.add('hidden');
    document.getElementById('img2pdf-file-info').classList.remove('hidden');
    document.getElementById('img2pdf-toolbar').classList.remove('hidden');
    document.getElementById('img2pdf-grid').classList.remove('hidden');

    // Process each image
    for (const file of files) {
        const dataUrl = await readFileAsDataURL(file);
        const card = createImageCard(file, dataUrl, img2pdfImages.length);
        img2pdfImages.push({ file, dataUrl, element: card });
        document.getElementById('img2pdf-grid').appendChild(card);
    }

    updateImageCount();
    initSortable();
}

function readFileAsDataURL(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });
}

function createImageCard(file, dataUrl, index) {
    const card = document.createElement('div');
    card.className = 'page-card img2pdf-card';
    card.dataset.index = index;

    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'canvas-wrapper';
    imgWrapper.style.width = '150px';
    imgWrapper.style.height = '150px';
    imgWrapper.style.overflow = 'hidden';

    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '6px';

    imgWrapper.appendChild(img);
    card.appendChild(imgWrapper);

    // File name
    const nameDiv = document.createElement('div');
    nameDiv.className = 'page-num';
    nameDiv.textContent = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name;
    nameDiv.title = file.name;
    card.appendChild(nameDiv);

    // Delete button
    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'img-delete-btn';
    deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
    deleteBtn.title = 'Remove image';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeImage(card);
    });
    card.appendChild(deleteBtn);

    // Drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'drag-handle-icon';
    dragHandle.innerHTML = '<i class="fas fa-grip-vertical"></i>';
    card.appendChild(dragHandle);

    return card;
}

function removeImage(card) {
    const index = img2pdfImages.findIndex(i => i.element === card);
    if (index > -1) {
        img2pdfImages.splice(index, 1);
        card.remove();
        updateImageCount();
    }

    if (img2pdfImages.length === 0) {
        resetImg2PdfUI();
    }
}

function updateImageCount() {
    const count = img2pdfImages.length;
    const totalSize = img2pdfImages.reduce((sum, i) => sum + i.file.size, 0);
    document.getElementById('img2pdf-count').textContent = `${count} image${count !== 1 ? 's' : ''} selected`;
    document.getElementById('img2pdf-total-size').textContent = (totalSize / (1024 * 1024)).toFixed(2) + ' MB';
}

function initSortable() {
    if (img2pdfSortable) return;
    const grid = document.getElementById('img2pdf-grid');
    img2pdfSortable = new Sortable(grid, {
        animation: 200,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        handle: '.img2pdf-card'
    });
}

function resetImg2PdfUI() {
    img2pdfImages = [];
    if (img2pdfSortable) {
        img2pdfSortable.destroy();
        img2pdfSortable = null;
    }
    document.getElementById('img2pdf-grid').innerHTML = '';

    document.getElementById('img2pdf-drop-zone').classList.remove('hidden');
    document.getElementById('img2pdf-file-info').classList.add('hidden');
    document.getElementById('img2pdf-toolbar').classList.add('hidden');
    document.getElementById('img2pdf-grid').classList.add('hidden');
    document.getElementById('img2pdf-upload').value = '';
}

async function createPDF() {
    if (img2pdfImages.length === 0) return;

    const btn = document.getElementById('img2pdf-save-btn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    btn.disabled = true;

    try {
        const pdfDoc = await PDFLib.PDFDocument.create();
        const pageSize = document.getElementById('img2pdf-page-size').value;

        // Get current order from DOM
        const cards = document.querySelectorAll('#img2pdf-grid .img2pdf-card');

        for (const card of cards) {
            const imgData = img2pdfImages.find(i => i.element === card);
            if (!imgData) continue;

            // Embed image
            let embeddedImage;
            const mimeType = imgData.file.type;
            const arrayBuffer = await imgData.file.arrayBuffer();

            if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
                embeddedImage = await pdfDoc.embedJpg(arrayBuffer);
            } else if (mimeType === 'image/png') {
                embeddedImage = await pdfDoc.embedPng(arrayBuffer);
            } else {
                // For other formats (gif, webp), convert via canvas
                const img = new Image();
                img.src = imgData.dataUrl;
                await new Promise(r => img.onload = r);

                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                const pngDataUrl = canvas.toDataURL('image/png');
                const pngBase64 = pngDataUrl.split(',')[1];
                const pngBytes = Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0));
                embeddedImage = await pdfDoc.embedPng(pngBytes);
            }

            const imgWidth = embeddedImage.width;
            const imgHeight = embeddedImage.height;

            let pageWidth, pageHeight;

            if (pageSize === 'fit') {
                // Fit page to image (72 DPI standard)
                pageWidth = imgWidth;
                pageHeight = imgHeight;
            } else if (pageSize === 'a4') {
                pageWidth = 595.28; // A4 width in points
                pageHeight = 841.89; // A4 height in points
            } else if (pageSize === 'letter') {
                pageWidth = 612; // Letter width
                pageHeight = 792; // Letter height
            }

            const page = pdfDoc.addPage([pageWidth, pageHeight]);

            // Calculate scaling to fit image on page
            let drawWidth, drawHeight, x, y;

            if (pageSize === 'fit') {
                drawWidth = imgWidth;
                drawHeight = imgHeight;
                x = 0;
                y = 0;
            } else {
                const scale = Math.min(pageWidth / imgWidth, pageHeight / imgHeight);
                drawWidth = imgWidth * scale;
                drawHeight = imgHeight * scale;
                x = (pageWidth - drawWidth) / 2;
                y = (pageHeight - drawHeight) / 2;
            }

            page.drawImage(embeddedImage, {
                x: x,
                y: y,
                width: drawWidth,
                height: drawHeight
            });
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        saveAs(blob, 'images.pdf');

        btn.innerHTML = '<i class="fas fa-check"></i> Done!';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-file-pdf"></i> Create PDF';
            btn.disabled = false;
        }, 2000);

    } catch (e) {
        console.error(e);
        alert('Error creating PDF: ' + e.message);
        btn.innerHTML = 'Error';
        btn.disabled = false;
    }
}
