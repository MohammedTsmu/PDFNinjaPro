
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
        ghost.style.fontSize = document.getElementById('comment-size').value + 'px';
        ghost.style.color = document.getElementById('comment-color').value;
        ghost.style.fontFamily = document.getElementById('comment-font').value;
        ghost.style.opacity = document.getElementById('comment-opacity').value;
        ghost.style.transform = `translate(-50%, -50%) rotate(${document.getElementById('comment-rotation').value}deg)`;
    };

    // Update ghost when inputs change
    ['comment-size', 'comment-color', 'comment-font', 'comment-opacity', 'comment-rotation'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateGhostStyle);
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
        if (e.target.closest('.comment-overlay')) {
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

} // END DOMContentLoaded 

function addComment(pageIndex, x, y, wrapper, canvasWidth, canvasHeight) {
    // Current Settings
    const colorInput = document.getElementById('comment-color');
    const sizeInput = document.getElementById('comment-size');
    const fontInput = document.getElementById('comment-font');
    const opacityInput = document.getElementById('comment-opacity');
    const rotationInput = document.getElementById('comment-rotation');

    // No initial text
    const text = "";

    const color = colorInput.value;
    const size = parseInt(sizeInput.value);
    const fontName = fontInput.value;
    const opacity = parseFloat(opacityInput.value);
    const rotation = parseInt(rotationInput.value);

    const id = Date.now() + Math.random().toString();

    const commentEl = document.createElement('div');
    commentEl.className = 'comment-overlay';
    commentEl.dataset.id = id;
    commentEl.contentEditable = "true"; // Click to Type!

    // Initial content (placeholder-like behavior handled by CSS or just focus)
    commentEl.innerText = "";

    // Styling
    commentEl.style.color = color;
    commentEl.style.fontSize = size + 'px';
    commentEl.style.fontFamily = fontName === 'TimesRoman' ? 'Times New Roman, serif' :
        fontName === 'Courier' ? 'Courier New, monospace' :
            'Helvetica, Arial, sans-serif';
    commentEl.style.opacity = opacity;
    commentEl.style.whiteSpace = "nowrap"; // Keep it one line initially, or "pre-wrap"
    commentEl.style.minWidth = "20px";
    commentEl.style.minHeight = "1em";
    commentEl.style.outline = "2px dashed rgba(255,255,255,0.5)"; // Outline when editing
    commentEl.style.padding = "2px";
    commentEl.style.cursor = "text";

    // Position & Rotation
    commentEl.style.left = x + 'px';
    commentEl.style.top = y + 'px';
    // Translate -50% -50% centering
    // BUT for typing, user expects top-left or centered?
    // Let's keep centered as it is the current logic, but typing expands outwards.
    // To make left-align typing easier, we might want translate(0, -50%)?
    // Let's stick to center for now.
    commentEl.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;

    // Delete Button (Hidden while editing)
    const delBtn = document.createElement('div');
    delBtn.className = 'comment-delete-btn';
    delBtn.innerHTML = '<i class="fas fa-times"></i>';
    delBtn.style.display = 'none'; // Initially hidden
    delBtn.onclick = (e) => {
        e.stopPropagation();
        removeComment(id);
    };
    commentEl.appendChild(delBtn);

    // Event: Lose Focus (Save or Delete)
    commentEl.onblur = () => {
        const content = commentEl.innerText.trim();
        if (!content) {
            // Remove if empty
            removeComment(id);
        } else {
            // Save Valid Comment
            commentEl.contentEditable = "false";
            commentEl.style.outline = "none";
            commentEl.style.cursor = "move";
            delBtn.style.display = 'flex';

            // Update Array
            const existing = comments.find(c => c.id === id);
            if (existing) {
                existing.text = content;
            }
        }
    };

    // Event: Keydown (Enter to finish?) 
    commentEl.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commentEl.blur(); // Trigger blur to save
        }
    };

    // Event: Double Click (Edit)
    commentEl.ondblclick = (e) => {
        e.stopPropagation();
        commentEl.contentEditable = "true";
        commentEl.focus();
        commentEl.style.outline = "2px dashed rgba(255,255,255,0.5)";
        commentEl.style.cursor = "text";
        delBtn.style.display = 'none';

        // Select all text for easy replacement? Or just caret?
        // Let's just focus.
    };

    // Drag Logic (Revised for ContentEditable)
    const startDrag = (e) => {
        if (e.target !== commentEl) return; // Allow text selection inside
        draggingCommentId = id;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragStartLeft = parseFloat(commentEl.style.left);
        dragStartTop = parseFloat(commentEl.style.top);

        // Visual Effect
        commentEl.classList.add('is-dragging');

        // Disable contentEditable during drag prevents cursor jumping
        commentEl.contentEditable = "false";

        e.preventDefault();
    };

    commentEl.addEventListener('mousedown', startDrag);

    const stopDrag = () => {
        if (draggingCommentId === id) {
            commentEl.classList.remove('is-dragging');
            commentEl.contentEditable = "true";
            draggingCommentId = null;

            // Update Data
            const cData = comments.find(c => c.id === id);
            if (cData) {
                cData.x = parseFloat(commentEl.style.left);
                cData.y = parseFloat(commentEl.style.top);
            }
        }
    };

    // window mouseup is needed to catch drops outside element, handled by Global Listener
    commentEl.addEventListener('mouseup', stopDrag);

    wrapper.appendChild(commentEl);

    comments.push({
        id, pageIndex, x, y,
        text: "", // Placeholder, updated on blur
        color, size, fontName, opacity, rotation,
        element: commentEl, canvasWidth, canvasHeight
    });

    // Immediately Focus to Type
    setTimeout(() => {
        commentEl.focus();
        const ghost = document.getElementById('comment-ghost');
        if (ghost) ghost.style.display = 'none';
    }, 10);

    // Ensure ghost stays hidden while typing
    const hideGhost = () => {
        const ghost = document.getElementById('comment-ghost');
        if (ghost) ghost.style.display = 'none';
    };
    commentEl.addEventListener('keydown', hideGhost);
    commentEl.addEventListener('input', hideGhost);
    commentEl.addEventListener('focus', hideGhost);
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
        comment.element.contentEditable = "true";
        comment.element.classList.remove('selected'); // Keep existing selected class removal
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

// Helper to check for Arabic characters - Removed
// function isArabic(text) { ... }

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
        // We will render each comment here, "cleanly" (without external scaling/zoom interference),
        // take a snapshot, and then embed it.
        const helper = document.createElement('div');
        helper.style.position = 'absolute';
        helper.style.left = '-9999px';
        helper.style.top = '-9999px';
        helper.style.backgroundColor = 'transparent';
        // Ensure browser renders it with high quality
        helper.style.transform = 'translateZ(0)';
        document.body.appendChild(helper);

        for (const c of comments) {
            const page = pages[c.pageIndex - 1];
            const { width, height } = page.getSize();

            // Logic:
            // 1. Render text into helper.
            // 2. Capture with html2canvas (transparent bg).
            // 3. Embed PNG.
            // 4. Draw Image.

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
            el.style.whiteSpace = 'pre-wrap'; // Preserve lines
            el.style.lineHeight = '1.2';      // Normal line height

            // Padding/Margins might be needed if html2canvas clips?
            // "padding: 5px" helps avoid clipping edges of fancy fonts
            el.style.padding = '5px';

            helper.appendChild(el);

            // Wait for render
            await new Promise(r => setTimeout(r, 10));

            // Capture
            const canvas = await html2canvas(el, {
                backgroundColor: null, // Transparent
                scale: 2, // 2x scale for higher quality (Retina-like) 
                logging: false,
                useCORS: true
            });

            // Convert to PNG Blob
            const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const pngBuffer = await pngBlob.arrayBuffer();
            const pngImage = await pdfDoc.embedPng(pngBuffer);

            // Calculate Dimensions
            // The canvas is scaled by 2 (or whatever 'scale' opt is).
            // We need to draw it at the original "visual" size on PDF.
            // Provide a slight offset for the padding we added.

            const imgWidth = pngImage.width;
            const imgHeight = pngImage.height;

            // Targeted PDF Width/Height (undoing the 2x capture scale)
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
