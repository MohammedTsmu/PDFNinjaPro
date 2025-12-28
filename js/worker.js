// Import PDF.js
importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.min.js');

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js';

let doc = null;
let totalPages = 0;

// Message Handler
self.onmessage = async function (e) {
    const { type, data, config } = e.data;

    if (type === 'init') {
        try {
            // Load PDF Document
            const loadingTask = pdfjsLib.getDocument({ data: data });
            doc = await loadingTask.promise;
            totalPages = doc.numPages;

            // Send metadata back
            self.postMessage({
                type: 'meta',
                totalPages: totalPages,
                outline: await doc.getOutline()
            });

            // Start Rendering Queue
            startRenderQueue();

        } catch (error) {
            self.postMessage({ type: 'error', message: error.message });
        }
    }
};

// Queue Logic
const MAX_CONCURRENT = 4;
let nextPageIndex = 1;

async function startRenderQueue() {
    // Fill the queue
    const workers = [];
    for (let i = 0; i < MAX_CONCURRENT; i++) {
        if (nextPageIndex <= totalPages) {
            workers.push(processNextPage());
        }
    }
    await Promise.all(workers);
}

async function processNextPage() {
    while (nextPageIndex <= totalPages) {
        const pageNum = nextPageIndex++;
        try {
            await renderPage(pageNum);
            self.postMessage({ type: 'progress', loaded: pageNum, total: totalPages });
        } catch (err) {
            console.error(`Error rendering page ${pageNum}:`, err);
            // Report error but keep going
            self.postMessage({ type: 'page-error', page: pageNum });
        }
    }

    // Check if fully complete (might be race condition in concurrent, but main thread tracks progress too)
    if (nextPageIndex > totalPages) {
        self.postMessage({ type: 'complete' });
    }
}

async function renderPage(pageNum) {
    const page = await doc.getPage(pageNum);

    // Scale 0.3 (Memory safe thumbnail)
    const scale = 0.3;
    const viewport = page.getViewport({ scale: scale });

    // Use OffscreenCanvas
    const canvas = new OffscreenCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;

    // Convert to ImageBitmap for transfer
    const bitmap = canvas.transferToImageBitmap();

    // Send back to main thread
    self.postMessage({
        type: 'page-rendered',
        pageNumber: pageNum,
        bitmap: bitmap,
        width: viewport.width,
        height: viewport.height
    }, [bitmap]); // Transfer ownership

    page.cleanup();
}
