
// Comment Tool Logic

let commentFile = null;
let commentPdfDoc = null;
let comments = []; // { id, pageIndex, x, y, text, color, size, element, canvasWidth, canvasHeight }

// Global Drag State
let draggingCommentId = null;
let dragStartX = 0;
let dragStartY = 0;
let dragStartLeft = 0;
let dragStartTop = 0;

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('comment-drop-zone');
    const fileInput = document.getElementById('comment-upload');
    const resetBtn = document.getElementById('comment-reset-btn');
    const downloadBtn = document.getElementById('download-commented-btn');

    // Drag & Drop
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') handleCommentFile(files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleCommentFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetCommentUI);
    if (downloadBtn) downloadBtn.addEventListener('click', saveCommentedPDF);

    // Global Drag Listeners
    window.addEventListener('mousemove', handleGlobalDragMove);
    window.addEventListener('mouseup', handleGlobalDragEnd);
});

async function handleCommentFile(file) {
    commentFile = file;
    comments = []; // Reset comments

    document.getElementById('comment-drop-zone').classList.add('hidden');
    document.getElementById('comment-file-info').classList.remove('hidden');
    document.getElementById('comment-toolbar').classList.remove('hidden');
    document.getElementById('comment-workspace').classList.remove('hidden');

    document.getElementById('comment-filename').textContent = file.name;
    document.getElementById('comment-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + " MB";

    try {
        const arrayBuffer = await file.arrayBuffer();
        commentPdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
        renderCommentPages();
    } catch (e) {
        console.error(e);
        alert("Invalid PDF file.");
        resetCommentUI();
    }
}

function resetCommentUI() {
    commentFile = null;
    commentPdfDoc = null;
    comments = [];
    document.getElementById('comment-workspace').innerHTML = '';

    document.getElementById('comment-drop-zone').classList.remove('hidden');
    document.getElementById('comment-file-info').classList.add('hidden');
    document.getElementById('comment-toolbar').classList.add('hidden');
    document.getElementById('comment-workspace').classList.add('hidden');
    document.getElementById('comment-upload').value = '';
}

async function renderCommentPages() {
    const workspace = document.getElementById('comment-workspace');
    workspace.innerHTML = '';

    for (let i = 1; i <= commentPdfDoc.numPages; i++) {
        const page = await commentPdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });

        // 1. Outer Container (Margins)
        const container = document.createElement('div');
        container.className = 'comment-page-container';

        // 2. Strict Wrapper (Coordinate System)
        const wrapper = document.createElement('div');
        wrapper.className = 'comment-canvas-wrapper';
        wrapper.dataset.pageIndex = i;
        wrapper.style.width = viewport.width + 'px';
        wrapper.style.height = viewport.height + 'px';

        // 3. Canvas
        const canvas = document.createElement('canvas');
        canvas.className = 'comment-page-canvas';
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        wrapper.appendChild(canvas);
        container.appendChild(wrapper);
        workspace.appendChild(container);

        // Click Event: Attached to the Wrapper (Strict Area)
        wrapper.addEventListener('click', (e) => {
            // Check if we are dragging or clicking a comment/button
            if (draggingCommentId || e.target.closest('.comment-overlay')) return;

            // Pass known viewport dimensions to store precise scaling reference
            addComment(i, e.offsetX, e.offsetY, wrapper, viewport.width, viewport.height);
        });
    }
}

function addComment(pageIndex, x, y, wrapper, canvasWidth, canvasHeight) {
    const textInput = document.getElementById('comment-input-text');
    const colorInput = document.getElementById('comment-color');
    const sizeInput = document.getElementById('comment-size');

    const text = textInput.value.trim();
    if (!text) {
        textInput.focus();
        textInput.style.border = '1px solid red';
        setTimeout(() => textInput.style.border = '', 500);
        return;
    }

    const color = colorInput.value;
    const size = parseInt(sizeInput.value);

    const id = Date.now() + Math.random().toString();

    const commentEl = document.createElement('div');
    commentEl.className = 'comment-overlay';
    commentEl.dataset.id = id;
    commentEl.textContent = text;
    commentEl.style.color = color;
    commentEl.style.fontSize = size + 'px';

    // Position
    commentEl.style.left = x + 'px';
    commentEl.style.top = y + 'px';
    commentEl.style.transform = 'translate(-50%, -50%)';

    // Delete Button
    const delBtn = document.createElement('div');
    delBtn.className = 'comment-delete-btn';
    delBtn.innerHTML = '<i class="fas fa-times"></i>';
    delBtn.onclick = (e) => {
        e.stopPropagation();
        removeComment(id);
    };
    commentEl.appendChild(delBtn);

    // Drag Start
    commentEl.addEventListener('mousedown', (e) => {
        if (e.target === delBtn) return;
        e.preventDefault();
        e.stopPropagation();

        draggingCommentId = id;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragStartLeft = commentEl.offsetLeft;
        dragStartTop = commentEl.offsetTop;

        commentEl.classList.add('selected');
    });

    wrapper.appendChild(commentEl);

    comments.push({ id, pageIndex, x, y, text, color, size, element: commentEl, canvasWidth, canvasHeight });
}

function handleGlobalDragMove(e) {
    if (!draggingCommentId) return;
    e.preventDefault();

    // Find comment in list
    const comment = comments.find(c => c.id === draggingCommentId);
    if (!comment) return;

    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    const newLeft = dragStartLeft + dx;
    const newTop = dragStartTop + dy;

    // Update DOM (Visual)
    comment.element.style.left = newLeft + 'px';
    comment.element.style.top = newTop + 'px';

    // Update State (Logic)
    comment.x = newLeft;
    comment.y = newTop;
}

function handleGlobalDragEnd() {
    if (!draggingCommentId) return;

    const comment = comments.find(c => c.id === draggingCommentId);
    if (comment) {
        comment.element.classList.remove('selected');
    }
    draggingCommentId = null;
}

function removeComment(id) {
    const idx = comments.findIndex(c => c.id === id);
    if (idx !== -1) {
        comments[idx].element.remove();
        comments.splice(idx, 1);
    }
}

async function saveCommentedPDF() {
    if (!commentFile) return;
    const btn = document.getElementById('download-commented-btn');

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    try {
        const arrayBuffer = await commentFile.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const pages = pdfDoc.getPages();

        const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

        comments.forEach(c => {
            const page = pages[c.pageIndex - 1]; // 0-based
            const { width, height } = page.getSize();

            // Calculate Ratios: PDF Points / Screen Pixels
            // Fallback to width if canvasWidth missing (old comments?)
            const scaleX = width / (c.canvasWidth || width);
            const scaleY = height / (c.canvasHeight || height);

            // Measure Text Width in PDF font
            const textWidth = font.widthOfTextAtSize(c.text, c.size);
            const textHeight = font.heightAtSize(c.size);

            // Scale coordinates
            const scaledX = c.x * scaleX;
            const scaledY = c.y * scaleY;

            // FIX: Center Offset
            // PDF DrawText starts at X.
            // HTML Center is c.x.
            // So PDF X must be (Center - HalfWidth)
            const pdfX = scaledX - (textWidth / 2);

            // Y Axis Inversion
            const pdfY = height - scaledY - (textHeight / 4);

            const rgbColor = hexToRgb(c.color);

            page.drawText(c.text, {
                x: pdfX,
                y: pdfY,
                size: c.size,
                font: font,
                color: PDFLib.rgb(rgbColor.r / 255, rgbColor.g / 255, rgbColor.b / 255),
            });
        });

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const name = commentFile.name.replace('.pdf', '_commented.pdf');
        saveAs(blob, name);

        btn.innerHTML = '<i class="fas fa-check"></i> Done';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-file-signature"></i> Save PDF';
            btn.disabled = false;
        }, 3000);

    } catch (e) {
        console.error(e);
        alert('Error saving PDF: ' + e.message);
        btn.innerHTML = 'Error';
        btn.disabled = false;
    }
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}
