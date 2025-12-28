
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


    // JS-Based Sticky Toolbar (Robust Fallback)
    const toolbar = document.getElementById('comment-toolbar');
    const toolbarPlaceholder = document.getElementById('comment-toolbar-placeholder');

    if (toolbar && toolbarPlaceholder) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 200) {
                toolbar.classList.add('is-sticky');
                toolbarPlaceholder.style.display = 'block';
            } else {
                toolbar.classList.remove('is-sticky');
                toolbarPlaceholder.style.display = 'none';
            }
        });
    }

    // Ghost Cursor Logic
    const ghost = document.createElement('div');
    ghost.id = 'comment-ghost';
    ghost.innerText = "Type here...";
    document.body.appendChild(ghost);

    const updateGhostStyle = () => {
        const size = document.getElementById('comment-size') ? document.getElementById('comment-size').value : 20;
        const color = document.getElementById('comment-color') ? document.getElementById('comment-color').value : '#000';
        const font = document.getElementById('comment-font') ? document.getElementById('comment-font').value : 'Helvetica';
        const opacity = document.getElementById('comment-opacity') ? document.getElementById('comment-opacity').value : 1;
        const rotation = document.getElementById('comment-rotation') ? document.getElementById('comment-rotation').value : 0;

        ghost.style.fontSize = size + 'px';
        ghost.style.color = color;
        ghost.style.fontFamily = font;
        ghost.style.opacity = opacity;
        ghost.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
    };

    // Update ghost when inputs change
    const inputs = ['comment-size', 'comment-color', 'comment-font', 'comment-opacity', 'comment-rotation'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateGhostStyle);
    });

    // Show/Hide Ghost on Canvas
    // Use event delegation for performance
    document.addEventListener('mousemove', (e) => {
        // Hide if typing (contentEditable focused)
        if (document.activeElement && document.activeElement.isContentEditable) {
            ghost.style.display = 'none';
            return;
        }

        // Hide if hovering over an existing comment or overlay
        if (e.target.closest('.comment-overlay') || e.target.closest('.comment-drag-handle')) {
            ghost.style.display = 'none';
            return;
        }

        if (e.target.closest('.comment-page-canvas')) {
            ghost.style.display = 'block';
            ghost.style.left = e.pageX + 'px';
            ghost.style.top = e.pageY + 'px';
            updateGhostStyle();
        } else {
            ghost.style.display = 'none';
        }
    });

}); // END DOMContentLoaded

async function handleCommentFile(file) {
    commentFile = file;
    comments = []; // Reset comments

    document.getElementById('comment-drop-zone').classList.add('hidden');
    document.getElementById('comment-file-info').classList.remove('hidden');
    document.getElementById('comment-toolbar').classList.remove('hidden');
    document.getElementById('comment-main-container').classList.remove('hidden'); // Show layout

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
}

// --- NEW WRAPPER IMPLEMENTATION ---

function addComment(pageIndex, x, y, wrapper, canvasWidth, canvasHeight) {
    // Current Settings
    const colorInput = document.getElementById('comment-color');
    const sizeInput = document.getElementById('comment-size');
    const fontInput = document.getElementById('comment-font');
    const opacityInput = document.getElementById('comment-opacity');
    const rotationInput = document.getElementById('comment-rotation');

    const color = colorInput.value;
    const size = parseInt(sizeInput.value);
    const fontName = fontInput.value;
    const opacity = parseFloat(opacityInput.value);
    const rotation = parseInt(rotationInput.value);

    const id = Date.now() + Math.random().toString();

    // 1. Wrapper (Position, Rotation, Opacity)
    // This element moves, but doesn't contain text text directly (except via child)
    const container = document.createElement('div');
    container.className = 'comment-overlay'; // Keep class for basic positioning styles
    container.dataset.id = id;
    container.style.position = 'absolute';
    container.style.left = x + 'px';
    container.style.top = y + 'px';
    container.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
    container.style.opacity = opacity;
    container.style.zIndex = '100'; // Base Z

    // Clean up incompatible styles from .comment-overlay if any (reset some basics)
    container.style.display = 'flex'; // Help with alignment?
    container.style.flexDirection = 'column';
    container.style.pointerEvents = 'auto';
    container.style.minWidth = "20px";
    container.style.minHeight = "1em";

    // 2. UI Controls (Handle, Delete) - NOT CONTENT EDITABLE

    // Drag Handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'comment-drag-handle';
    dragHandle.innerHTML = '<i class="fas fa-arrows-alt"></i>';
    dragHandle.title = "Drag to Move";
    dragHandle.contentEditable = "false";
    dragHandle.style.userSelect = "none";
    dragHandle.style.cursor = "grab";
    container.appendChild(dragHandle);

    // Delete Button
    const delBtn = document.createElement('div');
    delBtn.className = 'comment-delete-btn';
    delBtn.innerHTML = '<i class="fas fa-times"></i>';
    delBtn.style.display = 'none';
    delBtn.contentEditable = "false";
    delBtn.style.userSelect = "none";
    delBtn.onclick = (e) => {
        e.stopPropagation();
        removeComment(id);
    };
    container.appendChild(delBtn);

    // 3. Text Content Area (Editable)
    const textDiv = document.createElement('div');
    textDiv.className = 'comment-text-content';
    textDiv.contentEditable = "true";
    textDiv.spellcheck = false;
    textDiv.innerText = ""; // Start empty

    // Apply Text Styles
    textDiv.style.color = color;
    textDiv.style.fontSize = size + 'px';
    textDiv.style.fontFamily = fontName === 'TimesRoman' ? 'Times New Roman, serif' :
        fontName === 'Courier' ? 'Courier New, monospace' :
            'Helvetica, Arial, sans-serif';
    textDiv.style.minWidth = "20px";
    textDiv.style.minHeight = "1em";
    textDiv.style.whiteSpace = "nowrap";
    textDiv.style.outline = "2px dashed rgba(255,255,255,0.5)";
    textDiv.style.padding = "2px";
    textDiv.style.cursor = "text";

    // Prevent dragging from text
    textDiv.onmousedown = (e) => e.stopPropagation();

    container.appendChild(textDiv);

    // --- Logic ---

    // Blur (Save/Delete)
    textDiv.onblur = () => {
        const content = textDiv.innerText.trim();
        if (!content) {
            removeComment(id);
        } else {
            // Save
            textDiv.style.outline = "none";
            delBtn.style.display = 'flex';

            // Reset Ghost (Just in case)
            const ghost = document.getElementById('comment-ghost');
            if (ghost) ghost.style.display = 'none';

            // Store Data
            const existing = comments.find(c => c.id === id);
            if (existing) {
                existing.text = content;
            }
        }
    };

    // Double Click (Edit)
    container.ondblclick = (e) => {
        e.stopPropagation();
        textDiv.focus();
        textDiv.style.outline = "2px dashed rgba(255,255,255,0.5)";
        delBtn.style.display = 'none';
    };

    textDiv.onfocus = () => {
        textDiv.style.outline = "2px dashed rgba(255,255,255,0.5)";
        delBtn.style.display = 'none';
        // Hide Ghost
        const ghost = document.getElementById('comment-ghost');
        if (ghost) ghost.style.display = 'none';
    }

    // Drag Logic (Handle Only)
    const startDrag = (e) => {
        // Only allow drag if clicking the Handle
        if (!e.target.closest('.comment-drag-handle')) return;

        draggingCommentId = id;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragStartLeft = parseFloat(container.style.left);
        dragStartTop = parseFloat(container.style.top);

        // Visual Effect on CONTAINER
        container.classList.add('is-dragging');

        // Disable contentEditable during drag (redundant but safe)
        // container.contentEditable = "false"; 

        e.preventDefault();
        e.stopPropagation();
    };

    container.addEventListener('mousedown', startDrag);

    const stopDrag = () => {
        if (draggingCommentId === id) {
            container.classList.remove('is-dragging');
            draggingCommentId = null;

            // Update Data
            const cData = comments.find(c => c.id === id);
            if (cData) {
                cData.x = parseFloat(container.style.left);
                cData.y = parseFloat(container.style.top);
            }
        }
    };

    container.addEventListener('mouseup', stopDrag);

    wrapper.appendChild(container);

    comments.push({
        id, pageIndex, x, y,
        text: "",
        color, size, fontName, opacity, rotation,
        element: container, // Reference Wrapper
        textElement: textDiv, // Reference Text
        canvasWidth, canvasHeight
    });

    // Immediately Focus to Type
    setTimeout(() => {
        textDiv.focus();
        const ghost = document.getElementById('comment-ghost');
        if (ghost) ghost.style.display = 'none';
    }, 10);

    // Ghost Hiding Listeners
    const hideGhost = () => {
        const ghost = document.getElementById('comment-ghost');
        if (ghost) ghost.style.display = 'none';
    };
    textDiv.addEventListener('keydown', hideGhost);
    textDiv.addEventListener('input', hideGhost);
    textDiv.addEventListener('focus', hideGhost);
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

    // Find Element and Restore State
    const comment = comments.find(c => c.id === draggingCommentId);
    if (comment && comment.element) {
        comment.element.classList.remove('is-dragging');
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

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    try {
        const arrayBuffer = await commentFile.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const pages = pdfDoc.getPages();

        // 1. Create a Hidden Helper Container for Snapshotting
        const helper = document.createElement('div');
        helper.style.position = 'absolute';
        helper.style.left = '-9999px';
        helper.style.top = '-9999px';
        helper.style.backgroundColor = 'transparent';
        helper.style.transform = 'translateZ(0)';
        document.body.appendChild(helper);

        for (const c of comments) {
            const page = pages[c.pageIndex - 1];
            const { width, height } = page.getSize();

            // Reset helper
            helper.innerHTML = '';

            // Create element
            const el = document.createElement('div');
            el.innerText = c.text;
            el.style.fontFamily = c.fontName;
            el.style.fontSize = c.size + 'px';
            el.style.color = c.color;
            el.style.opacity = c.opacity;
            el.style.display = 'inline-block';
            el.style.whiteSpace = 'pre-wrap';
            el.style.lineHeight = '1.2';
            el.style.padding = '5px';

            helper.appendChild(el);

            // Wait for render
            await new Promise(r => setTimeout(r, 10));

            // Capture
            const canvas = await html2canvas(el, {
                backgroundColor: null,
                scale: 2,
                logging: false,
                useCORS: true
            });

            // Convert to PNG Blob
            const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const pngBuffer = await pngBlob.arrayBuffer();
            const pngImage = await pdfDoc.embedPng(pngBuffer);

            // Calculate Dimensions
            const imgWidth = pngImage.width;
            const imgHeight = pngImage.height;

            const drawWidth = imgWidth / 2;
            const drawHeight = imgHeight / 2;

            // Coordinate Calculation
            const scaleX = width / (c.canvasWidth || width);
            const scaleY = height / (c.canvasHeight || height);

            const scaledX = c.x * scaleX;
            const scaledY = c.y * scaleY;

            // Center Point
            const cx = scaledX;
            const cy = height - scaledY;

            // Rotation Logic
            const ox = drawWidth / 2;
            const oy = drawHeight / 2;
            const rad = (-c.rotation * Math.PI) / 180;

            const rotatedOx = ox * Math.cos(rad) - oy * Math.sin(rad);
            const rotatedOy = ox * Math.sin(rad) + oy * Math.cos(rad);

            const pdfX = cx - rotatedOx;
            const pdfY = cy - rotatedOy;

            page.drawImage(pngImage, {
                x: pdfX,
                y: pdfY,
                width: drawWidth,
                height: drawHeight,
                rotate: PDFLib.degrees(-c.rotation),
                opacity: parseFloat(c.opacity)
            });
        }

        // Cleanup
        document.body.removeChild(helper);

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
