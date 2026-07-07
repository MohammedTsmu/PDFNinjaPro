
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

// --- Annotation (drawing) state ---
let commentMode = 'text'; // text | highlight | pen | rect | ellipse | arrow
let drawings = [];        // { id, type, pageIndex, color, thickness, opacity, x1,y1,x2,y2, points[] }
let historyStack = [];    // { kind:'text'|'draw', id } — for undo
const pageOverlays = {};  // pageIndex -> overlay canvas
let isDrawing = false;
let drawStart = null;     // {x,y} in overlay-canvas coords
let drawCtxPage = null;   // pageIndex being drawn on
let currentPenPts = null; // points for pen mode

const DRAW_MODES = ['highlight', 'pen', 'rect', 'ellipse', 'arrow'];
function uid() { return Date.now() + '-' + Math.random().toString(36).slice(2); }

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

    // Global Drawing Listeners
    window.addEventListener('mousemove', handleDrawMove);
    window.addEventListener('mouseup', handleDrawEnd);

    // Tool-mode switching
    const hint = document.getElementById('comment-hint');
    const thicknessGroup = document.getElementById('comment-thickness-group');
    const HINTS = {
        text: 'Click anywhere to type…',
        highlight: 'Drag across text to highlight',
        pen: 'Draw freehand on the page',
        rect: 'Drag to draw a rectangle',
        ellipse: 'Drag to draw an ellipse',
        arrow: 'Drag to draw an arrow'
    };
    document.querySelectorAll('.comment-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            commentMode = btn.dataset.mode;
            document.querySelectorAll('.comment-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
            if (hint) hint.textContent = HINTS[commentMode] || '';
            // Thickness only matters for drawing modes.
            if (thicknessGroup) thicknessGroup.style.opacity = (commentMode === 'text' || commentMode === 'highlight') ? '0.5' : '1';
            // Drawing modes: the workspace shows a crosshair.
            const ws = document.getElementById('comment-workspace');
            if (ws) ws.style.cursor = DRAW_MODES.includes(commentMode) ? 'crosshair' : '';
        });
    });

    const undoBtn = document.getElementById('comment-undo-btn');
    const clearBtn = document.getElementById('comment-clear-btn');
    if (undoBtn) undoBtn.addEventListener('click', undoLast);
    if (clearBtn) clearBtn.addEventListener('click', clearAllAnnotations);

    // Undo shortcut (only while the Comment tool is active and not typing)
    window.addEventListener('keydown', (e) => {
        const commentPanel = document.getElementById('comment');
        if (!commentPanel || commentPanel.classList.contains('hidden')) return;
        if (document.activeElement && document.activeElement.isContentEditable) return;
        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            undoLast();
        }
    });

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
        // Only the Text tool uses the "type here" ghost.
        if (commentMode !== 'text') { ghost.style.display = 'none'; return; }
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
    drawings = [];
    historyStack = [];
    for (const k in pageOverlays) delete pageOverlays[k];

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
    drawings = [];
    historyStack = [];
    for (const k in pageOverlays) delete pageOverlays[k];
    document.getElementById('comment-workspace').innerHTML = '';

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

    workspace.innerHTML = ''; // Clear any prior render

    // Build every page container + its overlay canvas up front. This pass only
    // calls getPage() (light — parses page metadata), NOT page.render(), so the
    // whole document gets correct scroll height and the drawing engine has all
    // its overlays ready without the memory-heavy freeze of rasterizing every
    // page. The actual pdf canvas is rendered lazily as pages scroll into view
    // (see renderObserver below), mirroring the Rotate/Reorder/Background tools.
    for (let i = 1; i <= commentPdfDoc.numPages; i++) {
        const page = await commentPdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });

        const container = document.createElement('div');
        container.className = 'comment-page-container';
        container.id = 'comment-page-' + i; // ID for scrolling
        container.dataset.pageIndex = i;
        container.dataset.pIndex = i; // Used by the scroll-tracking observer

        const wrapper = document.createElement('div');
        wrapper.className = 'comment-canvas-wrapper';
        wrapper.dataset.pageIndex = i;
        wrapper.style.width = viewport.width + 'px';
        wrapper.style.height = viewport.height + 'px';
        wrapper.style.background = '#fff'; // Placeholder page colour until rendered

        // The page canvas is sized now but painted lazily by renderCommentPage().
        const canvas = document.createElement('canvas');
        canvas.className = 'comment-page-canvas';
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        wrapper.appendChild(canvas);

        // Spinner shown until this page is lazily rendered.
        const spinner = document.createElement('div');
        spinner.className = 'comment-page-spinner';
        spinner.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        wrapper.appendChild(spinner);

        // Transparent overlay canvas for highlight / pen / shapes. Its width/height
        // MUST equal the scale-1.0 viewport dims — saveCommentedPDF divides the
        // page size by overlay.width to map annotations back onto the PDF.
        const overlay = document.createElement('canvas');
        overlay.className = 'comment-draw-canvas';
        overlay.width = viewport.width;
        overlay.height = viewport.height;
        overlay.style.position = 'absolute';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.pointerEvents = 'none';
        wrapper.appendChild(overlay);
        pageOverlays[i] = overlay;

        container.appendChild(wrapper);
        workspace.appendChild(container);

        // Text mode: click to add a text comment.
        wrapper.addEventListener('click', (e) => {
            if (commentMode !== 'text') return;
            if (draggingCommentId || e.target.closest('.comment-overlay')) return;
            addComment(i, e.offsetX, e.offsetY, wrapper, viewport.width, viewport.height);
        });

        // Drawing modes: press to start a shape/stroke on this page.
        wrapper.addEventListener('mousedown', (e) => {
            if (!DRAW_MODES.includes(commentMode)) return;
            if (e.target.closest('.comment-overlay')) return; // don't start over a text comment
            const rect = overlay.getBoundingClientRect();
            drawStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            drawCtxPage = i;
            isDrawing = true;
            currentPenPts = commentMode === 'pen' ? [{ x: drawStart.x, y: drawStart.y }] : null;
            e.preventDefault();
        });
    }

    // Reset overlay canvases to current drawings after (re)build.
    for (let p = 1; p <= commentPdfDoc.numPages; p++) redrawOverlay(p);

    // Lazily paint each page's pdf canvas as it nears the viewport.
    const renderObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                renderCommentPage(parseInt(entry.target.dataset.pageIndex, 10));
                renderObserver.unobserve(entry.target);
            }
        });
    }, { root: null, rootMargin: '300px', threshold: 0 });

    // Intersection Observer to update the page input on scroll.
    const navObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && entry.intersectionRatio > 0.3) {
                const index = entry.target.dataset.pIndex;
                if (document.activeElement !== pageInput) {
                    pageInput.value = index;
                }
            }
        });
    }, { threshold: [0.3] });

    document.querySelectorAll('.comment-page-container').forEach((el) => {
        renderObserver.observe(el);
        navObserver.observe(el);
    });
}

// Paint a single page's pdf canvas on demand. Idempotent per page via the
// container's `rendered` flag (auto-reset when the workspace is rebuilt).
async function renderCommentPage(pageIndex) {
    const container = document.getElementById('comment-page-' + pageIndex);
    if (!container || container.dataset.rendered === '1') return;
    container.dataset.rendered = '1';

    const canvas = container.querySelector('.comment-page-canvas');
    if (!canvas) return;

    try {
        const page = await commentPdfDoc.getPage(pageIndex);
        const viewport = page.getViewport({ scale: 1.0 });
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        const spinner = container.querySelector('.comment-page-spinner');
        if (spinner) spinner.remove();

        // Re-apply any annotations that already belong to this page.
        redrawOverlay(pageIndex);
    } catch (e) {
        console.error('Error rendering comment page', pageIndex, e);
        container.dataset.rendered = ''; // Allow a retry on the next intersection
    }
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
    historyStack.push({ kind: 'text', id });

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
    historyStack = historyStack.filter(h => h.id !== id);
}

// ---------- Drawing engine (highlight / pen / shapes) ----------

function handleDrawMove(e) {
    if (!isDrawing || drawCtxPage == null) return;
    const overlay = pageOverlays[drawCtxPage];
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (commentMode === 'pen') currentPenPts.push({ x, y });
    redrawOverlay(drawCtxPage, { x, y });
}

function handleDrawEnd(e) {
    if (!isDrawing || drawCtxPage == null) return;
    const overlay = pageOverlays[drawCtxPage];
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    commitDrawing(drawCtxPage, x, y);
    isDrawing = false;
    drawStart = null;
    currentPenPts = null;
    const page = drawCtxPage;
    drawCtxPage = null;
    redrawOverlay(page);
}

function commitDrawing(pageIndex, endX, endY) {
    const color = document.getElementById('comment-color').value;
    const thickness = parseInt(document.getElementById('comment-thickness').value, 10) || 3;

    if (commentMode === 'pen') {
        if (!currentPenPts || currentPenPts.length < 2) return;
        drawings.push({ id: uid(), type: 'pen', pageIndex, color, thickness, opacity: 1, points: currentPenPts.slice() });
    } else {
        // Ignore tiny click-only gestures.
        if (Math.abs(endX - drawStart.x) < 3 && Math.abs(endY - drawStart.y) < 3) return;
        drawings.push({
            id: uid(), type: commentMode, pageIndex, color, thickness,
            opacity: commentMode === 'highlight' ? 0.35 : 1,
            x1: drawStart.x, y1: drawStart.y, x2: endX, y2: endY
        });
    }
    historyStack.push({ kind: 'draw', id: drawings[drawings.length - 1].id });
}

function drawAnnotation(ctx, d) {
    ctx.save();
    ctx.globalAlpha = d.opacity != null ? d.opacity : 1;
    ctx.strokeStyle = d.color;
    ctx.fillStyle = d.color;
    ctx.lineWidth = d.thickness || 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (d.type === 'highlight') {
        ctx.fillRect(Math.min(d.x1, d.x2), Math.min(d.y1, d.y2), Math.abs(d.x2 - d.x1), Math.abs(d.y2 - d.y1));
    } else if (d.type === 'rect') {
        ctx.strokeRect(Math.min(d.x1, d.x2), Math.min(d.y1, d.y2), Math.abs(d.x2 - d.x1), Math.abs(d.y2 - d.y1));
    } else if (d.type === 'ellipse') {
        const cx = (d.x1 + d.x2) / 2, cy = (d.y1 + d.y2) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(d.x2 - d.x1) / 2, Math.abs(d.y2 - d.y1) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
    } else if (d.type === 'arrow') {
        drawArrow(ctx, d.x1, d.y1, d.x2, d.y2, d.thickness || 3);
    } else if (d.type === 'pen') {
        ctx.beginPath();
        d.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.stroke();
    }
    ctx.restore();
}

function drawArrow(ctx, x1, y1, x2, y2, thickness) {
    const head = Math.max(8, thickness * 3);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
    ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
}

function redrawOverlay(pageIndex, preview) {
    const overlay = pageOverlays[pageIndex];
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    drawings.filter(d => d.pageIndex === pageIndex).forEach(d => drawAnnotation(ctx, d));

    // In-progress preview.
    if (preview && isDrawing && drawStart) {
        const color = document.getElementById('comment-color').value;
        const thickness = parseInt(document.getElementById('comment-thickness').value, 10) || 3;
        if (commentMode === 'pen') {
            drawAnnotation(ctx, { type: 'pen', color, thickness, opacity: 1, points: currentPenPts });
        } else {
            drawAnnotation(ctx, {
                type: commentMode, color, thickness,
                opacity: commentMode === 'highlight' ? 0.35 : 1,
                x1: drawStart.x, y1: drawStart.y, x2: preview.x, y2: preview.y
            });
        }
    }
}

function undoLast() {
    const last = historyStack.pop();
    if (!last) return;
    if (last.kind === 'text') {
        removeComment(last.id);
    } else {
        const idx = drawings.findIndex(d => d.id === last.id);
        if (idx !== -1) {
            const page = drawings[idx].pageIndex;
            drawings.splice(idx, 1);
            redrawOverlay(page);
        }
    }
}

function clearAllAnnotations() {
    if (!comments.length && !drawings.length) return;
    if (!confirm('Remove all annotations on this document?')) return;
    comments.slice().forEach(c => removeComment(c.id));
    const pages = [...new Set(drawings.map(d => d.pageIndex))];
    drawings = [];
    pages.forEach(redrawOverlay);
    historyStack = [];
}

async function saveCommentedPDF() {
    if (!commentFile) return;
    const btn = document.getElementById('download-commented-btn');

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    try {
        const arrayBuffer = await commentFile.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
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

        // Cleanup text helper
        document.body.removeChild(helper);

        // 2. Render vector drawings (highlight / pen / shapes) natively.
        for (const d of drawings) {
            const page = pages[d.pageIndex - 1];
            const { width: pw, height: ph } = page.getSize();
            const overlay = pageOverlays[d.pageIndex];
            const cw = overlay ? overlay.width : pw;
            const chh = overlay ? overlay.height : ph;
            const sx = pw / cw, sy = ph / chh;
            const rgb = hexToRgb(d.color);
            const col = PDFLib.rgb(rgb.r / 255, rgb.g / 255, rgb.b / 255);
            const th = (d.thickness || 3) * sx;
            const toPdf = (x, y) => ({ x: x * sx, y: ph - y * sy });

            if (d.type === 'highlight') {
                page.drawRectangle({
                    x: Math.min(d.x1, d.x2) * sx, y: ph - Math.max(d.y1, d.y2) * sy,
                    width: Math.abs(d.x2 - d.x1) * sx, height: Math.abs(d.y2 - d.y1) * sy,
                    color: col, opacity: 0.35
                });
            } else if (d.type === 'rect') {
                page.drawRectangle({
                    x: Math.min(d.x1, d.x2) * sx, y: ph - Math.max(d.y1, d.y2) * sy,
                    width: Math.abs(d.x2 - d.x1) * sx, height: Math.abs(d.y2 - d.y1) * sy,
                    borderColor: col, borderWidth: th
                });
            } else if (d.type === 'ellipse') {
                const cx = (d.x1 + d.x2) / 2, cy = (d.y1 + d.y2) / 2;
                page.drawEllipse({
                    x: cx * sx, y: ph - cy * sy,
                    xScale: Math.abs(d.x2 - d.x1) / 2 * sx, yScale: Math.abs(d.y2 - d.y1) / 2 * sy,
                    borderColor: col, borderWidth: th
                });
            } else if (d.type === 'arrow') {
                const start = toPdf(d.x1, d.y1), end = toPdf(d.x2, d.y2);
                page.drawLine({ start, end, thickness: th, color: col });
                const head = Math.max(8, (d.thickness || 3) * 3) * sx;
                const ang = Math.atan2(end.y - start.y, end.x - start.x);
                page.drawLine({ start: end, end: { x: end.x - head * Math.cos(ang - Math.PI / 6), y: end.y - head * Math.sin(ang - Math.PI / 6) }, thickness: th, color: col });
                page.drawLine({ start: end, end: { x: end.x - head * Math.cos(ang + Math.PI / 6), y: end.y - head * Math.sin(ang + Math.PI / 6) }, thickness: th, color: col });
            } else if (d.type === 'pen') {
                for (let i = 1; i < d.points.length; i++) {
                    page.drawLine({ start: toPdf(d.points[i - 1].x, d.points[i - 1].y), end: toPdf(d.points[i].x, d.points[i].y), thickness: th, color: col });
                }
            }
        }

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
