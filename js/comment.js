
// Comment Tool Logic

let commentFile = null;
let commentPdfDoc = null;
let comments = []; // { id, pageIndex, x, y, text, color, size, fontName, opacity, rotation, element, canvasWidth, canvasHeight }

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

    // UI Helpers: Reset Logic
    const bindReset = (triggerId, inputId, defaultVal, displayId = null, displaySuffix = '') => {
        const trigger = document.getElementById(triggerId);
        const input = document.getElementById(inputId);
        const display = displayId ? document.getElementById(displayId) : null;

        if (trigger && input) {
            trigger.addEventListener('click', () => {
                input.value = defaultVal;
                // Trigger change event manually if needed, or just update UI
                if (display) display.textContent = defaultVal + displaySuffix;
            });
            // Update display on input change (for ranges)
            if (display) {
                input.addEventListener('input', () => {
                    display.textContent = input.value + displaySuffix;
                });
            }
        }
    };

    // Initialize Resets
    bindReset('rotation-value', 'comment-rotation', '0', 'rotation-value', '°');
    bindReset('opacity-value', 'comment-opacity', '1', 'opacity-value', '');

    // Bind Labels too
    bindReset('lbl-rotate', 'comment-rotation', '0', 'rotation-value', '°');
    bindReset('lbl-opacity', 'comment-opacity', '1', 'opacity-value', '');

    bindReset('lbl-color', 'comment-color', '#ff0000');
    bindReset('lbl-size', 'comment-size', '20');
    bindReset('lbl-font', 'comment-font', 'Helvetica');

});

async function handleCommentFile(file) {
    commentFile = file;
    comments = []; // Reset comments

    document.getElementById('comment-drop-zone').classList.add('hidden');
    document.getElementById('comment-file-info').classList.remove('hidden');
    document.getElementById('comment-toolbar').classList.remove('hidden');
    document.getElementById('comment-main-container').classList.remove('hidden'); // Show Layout

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
    document.getElementById('comment-sidebar').innerHTML = '<div style="font-size:12px; font-weight:bold; margin-bottom:5px; opacity:0.7;">Go to Page:</div>';

    document.getElementById('comment-drop-zone').classList.remove('hidden');
    document.getElementById('comment-file-info').classList.add('hidden');
    document.getElementById('comment-toolbar').classList.add('hidden');
    document.getElementById('comment-main-container').classList.add('hidden'); // Hide Layout
    document.getElementById('comment-upload').value = '';
}

async function renderCommentPages() {
    const workspace = document.getElementById('comment-workspace');
    // Navigation Controls
    const prevBtn = document.getElementById('comment-prev-page');
    const nextBtn = document.getElementById('comment-next-page');
    const pageInput = document.getElementById('comment-page-input');
    const totalPagesSpan = document.getElementById('comment-total-pages');

    totalPagesSpan.textContent = commentPdfDoc.numPages;
    pageInput.max = commentPdfDoc.numPages;

    const scrollToPage = (p) => {
        if (p < 1) p = 1;
        if (p > commentPdfDoc.numPages) p = commentPdfDoc.numPages;
        const container = document.getElementById('comment-page-' + p);
        if (container) {
            // Offset for sticky toolbar (approx 60px)
            const toolbarHeight = document.getElementById('comment-toolbar').offsetHeight || 60;
            const top = container.getBoundingClientRect().top + window.scrollY - toolbarHeight - 10;
            window.scrollTo({ top: top, behavior: 'smooth' });
            pageInput.value = p;
        }
    };

    prevBtn.onclick = () => scrollToPage(parseInt(pageInput.value) - 1);
    nextBtn.onclick = () => scrollToPage(parseInt(pageInput.value) + 1);
    pageInput.onchange = () => scrollToPage(parseInt(pageInput.value));

    // Render Pages Loop
    for (let i = 1; i <= commentPdfDoc.numPages; i++) {
        const page = await commentPdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });

        const container = document.createElement('div');
        container.className = 'comment-page-container';
        container.id = 'comment-page-' + i; // ID for scrolling

        const wrapper = document.createElement('div');
        wrapper.className = 'comment-canvas-wrapper';
        wrapper.dataset.pageIndex = i;
        wrapper.style.width = viewport.width + 'px';
        wrapper.style.height = viewport.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.className = 'comment-page-canvas';
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        wrapper.appendChild(canvas);
        container.appendChild(wrapper);
        workspace.appendChild(container);

        wrapper.addEventListener('click', (e) => {
            if (draggingCommentId || e.target.closest('.comment-overlay')) return;
            addComment(i, e.offsetX, e.offsetY, wrapper, viewport.width, viewport.height);
        });
    }

    // Intersection Observer to update input on scroll
    const observer = new IntersectionObserver((entries) => {
        // Find the most visible page
        entries.forEach(entry => {
            if (entry.isIntersecting && entry.intersectionRatio > 0.3) {
                const index = entry.target.dataset.pIndex;
                if (document.activeElement !== pageInput) {
                    pageInput.value = index;
                }
            }
        });
    }, { threshold: [0.3] });

    // Observe all page containers
    document.querySelectorAll('.comment-page-container').forEach((el, idx) => {
        el.dataset.pIndex = idx + 1; // Store page index
        observer.observe(el);
    });

    // JS-Based Sticky Toolbar logic removed as position:sticky top:0 is now sufficient 
    // with sidebar gone and correct stacking context.
}

function addComment(pageIndex, x, y, wrapper, canvasWidth, canvasHeight) {
    const textInput = document.getElementById('comment-input-text');
    const colorInput = document.getElementById('comment-color');
    const sizeInput = document.getElementById('comment-size');
    const fontInput = document.getElementById('comment-font');
    const opacityInput = document.getElementById('comment-opacity');
    const rotationInput = document.getElementById('comment-rotation');

    const text = textInput.value.trim();
    if (!text) {
        textInput.focus();
        textInput.style.border = '1px solid red';
        setTimeout(() => textInput.style.border = '', 500);
        return;
    }

    const color = colorInput.value;
    const size = parseInt(sizeInput.value);
    const fontName = fontInput.value;
    const opacity = parseFloat(opacityInput.value);
    const rotation = parseInt(rotationInput.value);

    const id = Date.now() + Math.random().toString();

    const commentEl = document.createElement('div');
    commentEl.className = 'comment-overlay';
    commentEl.dataset.id = id;
    commentEl.textContent = text;
    commentEl.style.color = color;
    commentEl.style.fontSize = size + 'px';

    // Apply New Styles
    commentEl.style.fontFamily = fontName === 'TimesRoman' ? 'Times New Roman, serif' :
        fontName === 'Courier' ? 'Courier New, monospace' :
            'Helvetica, Arial, sans-serif';
    commentEl.style.opacity = opacity;

    // Position & Rotation
    commentEl.style.left = x + 'px';
    commentEl.style.top = y + 'px';
    // Translate -50% is for centering. Rotation is added on top.
    commentEl.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;

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

        // FIX: Use current style left/top (Center Coords) instead of offset (Corner Coords)
        // to prevent jumping because of translate(-50%, -50%)
        dragStartLeft = parseFloat(commentEl.style.left);
        dragStartTop = parseFloat(commentEl.style.top);

        commentEl.classList.add('selected');
    });

    wrapper.appendChild(commentEl);

    comments.push({
        id, pageIndex, x, y,
        text, color, size, fontName, opacity, rotation,
        element: commentEl, canvasWidth, canvasHeight
    });
}

function handleGlobalDragMove(e) {
    if (!draggingCommentId) return;
    e.preventDefault();

    const comment = comments.find(c => c.id === draggingCommentId);
    if (!comment) return;

    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    const newLeft = dragStartLeft + dx;
    const newTop = dragStartTop + dy;

    // Update DOM
    comment.element.style.left = newLeft + 'px';
    comment.element.style.top = newTop + 'px';

    // Update State
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

        // Load fonts
        const helveticaFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
        const timesFont = await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRoman);
        const courierFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Courier);

        const fonts = {
            'Helvetica': helveticaFont,
            'TimesRoman': timesFont,
            'Courier': courierFont
        };

        comments.forEach(c => {
            const page = pages[c.pageIndex - 1]; // 0-based
            const { width, height } = page.getSize();

            const scaleX = width / (c.canvasWidth || width);
            const scaleY = height / (c.canvasHeight || height);

            const font = fonts[c.fontName] || helveticaFont;

            const textWidth = font.widthOfTextAtSize(c.text, c.size);
            const textHeight = font.heightAtSize(c.size);

            const scaledX = c.x * scaleX;
            const scaledY = c.y * scaleY;

            // Scaled Center Point (Target)
            const cx = scaledX;
            const cy = height - scaledY; // Cartesian Y

            // Rotation Correction
            // The UI rotates around the center (cx, cy).
            // pdf-lib rotates around the anchor (x, y).
            // We need to calculate where to place the anchor (x, y) such that 
            // the center of the text ends up at (cx, cy) after rotation.

            // Vector from Anchor to Center (Unrotated)
            // V = (textWidth / 2, textHeight / 4)  <-- using our heuristic offset
            const ox = textWidth / 2;
            const oy = textHeight / 4;

            // Rotation Angle (Radians)
            // pdf-lib rotates CCW. CSS rotation (c.rotation) is typically CW in UI logic usually,
            // but let's match the rotation direction passed to drawText.
            // We pass `degrees(-c.rotation)`. 
            // If c.rotation is 45 (CW), we pass -45 (CCW) to PDF.
            // The correction vector must be rotated by THIS SAME ANGLE.
            const rad = (-c.rotation * Math.PI) / 180;

            // Rotate Vector V by rad
            // x' = x*cos - y*sin
            // y' = x*sin + y*cos
            const rotatedOx = ox * Math.cos(rad) - oy * Math.sin(rad);
            const rotatedOy = ox * Math.sin(rad) + oy * Math.cos(rad);

            // New Anchor Position = TargetCenter - RotatedVector
            const pdfX = cx - rotatedOx;
            const pdfY = cy - rotatedOy;

            const rgbColor = hexToRgb(c.color);

            page.drawText(c.text, {
                x: pdfX,
                y: pdfY,
                size: c.size,
                font: font,
                color: PDFLib.rgb(rgbColor.r / 255, rgbColor.g / 255, rgbColor.b / 255),
                opacity: c.opacity,
                rotate: PDFLib.degrees(-c.rotation)
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
