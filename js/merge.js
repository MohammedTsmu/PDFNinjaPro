const mergeZone = document.getElementById('merge-drop-zone');
const mergeInput = document.getElementById('pdf-merge-upload');
const mergeBtn = document.getElementById('merge-btn');
const mergeList = document.getElementById('merge-file-list');

// Enhanced State: { id, file, thumbnail, range: 'all', rotation: 0 }
let mergeState = [];

// Trigger Input
mergeZone?.addEventListener('click', (e) => {
    // Prevent triggering if clicking a child (like if we had internal buttons)
    if (e.target === mergeZone || e.target.closest('.upload-icon-wrapper') || e.target.closest('.upload-title')) {
        mergeInput.click();
    }
});

// Drag & Drop
mergeZone?.addEventListener('dragover', (e) => { e.preventDefault(); mergeZone.classList.add('drag-over'); });
mergeZone?.addEventListener('dragleave', () => mergeZone.classList.remove('drag-over'));
mergeZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    mergeZone.classList.remove('drag-over');
    handleMergeFiles(e.dataTransfer.files);
});

mergeInput?.addEventListener('change', (e) => {
    handleMergeFiles(e.target.files);
});

async function handleMergeFiles(files) {
    if (!files || files.length === 0) return;

    // Show loading state if needed

    const newFiles = Array.from(files).filter(f => f.type === 'application/pdf');

    for (const file of newFiles) {
        const id = Date.now() + Math.random().toString(36).substr(2, 9);
        const item = {
            id: id,
            file: file,
            thumbnail: null, // Loading
            range: '',  // Empty means 'all'
            rotation: 0
        };
        mergeState.push(item);

        // Render immediately with placeholder
        updateMergeUI();

        // Async generate thumbnail
        generateThumbnail(file).then(thumb => {
            const index = mergeState.findIndex(x => x.id === id);
            if (index !== -1) {
                mergeState[index].thumbnail = thumb;
                // Update just this thumbnail or re-render
                updateThumbnailUI(id, thumb);
            }
        });
    }
}

async function generateThumbnail(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        const page = await pdf.getPage(1);

        const scale = 0.5; // Small preview
        const viewport = page.getViewport({ scale: scale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        return canvas.toDataURL();
    } catch (e) {
        console.error('Thumb error', e);
        return null; // Should return a default icon
    }
}

function updateThumbnailUI(id, thumb) {
    const img = document.querySelector(`.merge-card[data-id="${id}"] .merge-thumb img`);
    if (img && thumb) img.src = thumb;
}

function updateMergeUI() {
    mergeList.innerHTML = '';

    if (mergeState.length > 0) {
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'flex-end';
        header.style.marginBottom = '10px';
        header.innerHTML = `<button class="btn btn-sm btn-link text-danger" onclick="clearMergeFiles()" style="text-decoration:none;">Clear All</button>`;
        mergeList.appendChild(header);
    }

    mergeState.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'merge-card';
        card.dataset.id = item.id;

        // Navigation Buttons Logic
        const isFirst = index === 0;
        const isLast = index === mergeState.length - 1;
        const upDisabled = isFirst ? 'disabled style="opacity:0.3"' : '';
        const downDisabled = isLast ? 'disabled style="opacity:0.3"' : '';

        // Thumbnail or placeholder
        const thumbSrc = item.thumbnail || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjOTRhM2I4IiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIGQ9Ik0xNCAySDZhhTIgMiAwIDAgMCAyIDJ2MTZhMiAyIDAgMCAwIDIgMmgyYTIgMiAwIDAgMCAyLTJWMTRsLTUtNXoiLz48cG9seWxpbmUgcG9pbnRzPSIxNCAyIDE0IDggMjAgOCIvPjwvc3ZnPg=='; // PDF Icon

        card.innerHTML = `
            <div class="merge-thumb">
                <img src="${thumbSrc}" alt="Preview">
            </div>
            
            <div class="merge-info">
                <div class="merge-filename" title="${item.file.name}">${item.file.name}</div>
                <div class="merge-controls">
                    <div class="merge-input-group" title="Page Range (e.g. 1-5, 8)">
                        <span class="merge-input-label">Pages:</span>
                        <input type="text" value="${item.range}" placeholder="All" onchange="updateMergeProp('${item.id}', 'range', this.value)">
                    </div>
                    <button class="rotate-btn" onclick="rotateMergeFile('${item.id}')" title="Rotate 90°">
                        <i class="fas fa-sync-alt" style="transform: rotate(${item.rotation}deg); transition: transform 0.3s;"></i>
                    </button>
                    ${item.rotation > 0 ? `<span class="text-muted" style="font-size:0.7em;">${item.rotation}°</span>` : ''}
                </div>
            </div>

            <div class="merge-actions">
                <button class="btn btn-sm btn-icon" ${upDisabled} onclick="moveMergeFile(${index}, -1)">
                    <i class="fas fa-arrow-up"></i>
                </button>
                <button class="btn btn-sm btn-icon" ${downDisabled} onclick="moveMergeFile(${index}, 1)">
                    <i class="fas fa-arrow-down"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="removeMergeFile(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        mergeList.appendChild(card);
    });

    if (mergeState.length > 1) {
        mergeBtn.style.display = 'block';
        mergeBtn.innerHTML = '<i class="fas fa-code-merge"></i> Merge ' + mergeState.length + ' Files';
        mergeBtn.disabled = false;
    } else {
        mergeBtn.style.display = 'none';
        if (mergeState.length === 0) mergeList.innerHTML = '<p class="text-muted text-center">No files selected</p>';
    }
}

// Global helpers
window.updateMergeProp = (id, prop, value) => {
    const item = mergeState.find(x => x.id === id);
    if (item) {
        item[prop] = value;
    }
};

window.rotateMergeFile = (id) => {
    const item = mergeState.find(x => x.id === id);
    if (item) {
        item.rotation = (item.rotation + 90) % 360;
        updateMergeUI(); // Re-render to update icon rotation
    }
};

window.removeMergeFile = (index) => {
    mergeState.splice(index, 1);
    updateMergeUI();
};

window.clearMergeFiles = () => {
    if (confirm('Remove all files?')) {
        mergeState = [];
        updateMergeUI();
    }
};

window.moveMergeFile = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= mergeState.length) return;

    const temp = mergeState[index];
    mergeState[index] = mergeState[newIndex];
    mergeState[newIndex] = temp;
    updateMergeUI();
};

mergeBtn?.addEventListener('click', async function () {
    if (mergeState.length < 2) return;

    mergeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Merging...';
    mergeBtn.disabled = true;

    // Reset Download Link
    const mergeDownloadLink = document.getElementById('merge-download-link');
    if (mergeDownloadLink) {
        mergeDownloadLink.style.display = 'none';
        mergeDownloadLink.href = '#';
    }

    try {
        const pdfLibDoc = await PDFLib.PDFDocument.create();

        for (const item of mergeState) {
            const arrayBuffer = await item.file.arrayBuffer();
            const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
            const totalPages = pdfDoc.getPageCount();

            // 1. Parse Range (e.g. "1-3, 5")
            let indices = [];

            // Helper to parse range
            const rangeStr = item.range.replace(/\s/g, '');
            if (!rangeStr || rangeStr.toLowerCase() === 'all') {
                for (let i = 0; i < totalPages; i++) indices.push(i);
            } else {
                const parts = rangeStr.split(',');
                const set = new Set();
                parts.forEach(p => {
                    const r = p.split('-');
                    if (r.length === 2) {
                        const start = parseInt(r[0]);
                        const end = parseInt(r[1]);
                        if (!isNaN(start) && !isNaN(end)) {
                            const min = Math.min(start, end);
                            const max = Math.max(start, end);
                            for (let k = min; k <= max; k++) set.add(k - 1); // 0-based
                        }
                    } else {
                        const page = parseInt(r[0]);
                        if (!isNaN(page)) set.add(page - 1);
                    }
                });
                indices = Array.from(set).filter(p => p >= 0 && p < totalPages).sort((a, b) => a - b);
            }

            if (indices.length === 0) continue; // Skip empty ranges

            const copiedPages = await pdfLibDoc.copyPages(pdfDoc, indices);

            // 2. Apply Rotation and Add
            copiedPages.forEach(page => {
                const existingRotation = page.getRotation().angle;
                page.setRotation(PDFLib.degrees(existingRotation + item.rotation));
                pdfLibDoc.addPage(page);
            });
        }

        const pdfBytes = await pdfLibDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const mergeDownloadLink = document.getElementById('merge-download-link');
        mergeDownloadLink.href = url;
        mergeDownloadLink.download = `merged_ninja_pro_${Date.now()}.pdf`;
        mergeDownloadLink.style.display = 'inline-block';
        mergeDownloadLink.textContent = 'Download Merged PDF';
        mergeDownloadLink.classList.remove('hidden');

        mergeBtn.innerHTML = '<i class="fas fa-check"></i> Done';

        setTimeout(() => {
            mergeBtn.innerHTML = '<i class="fas fa-code-merge"></i> Merge ' + mergeState.length + ' Files';
            mergeBtn.disabled = false;
        }, 3000);

    } catch (e) {
        console.error(e);
        alert('Merge error. Check console and page ranges.');
        mergeBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
        setTimeout(() => {
            mergeBtn.innerHTML = '<i class="fas fa-code-merge"></i> Merge ' + mergeState.length + ' Files';
            mergeBtn.disabled = false;
        }, 3000);
    }
});

