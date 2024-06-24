importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.min.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js';

self.onmessage = async function (e) {
    const { action, data } = e.data;
    if (action === 'loadPdf') {
        const loadingTask = pdfjsLib.getDocument(data);
        const pdf = await loadingTask.promise;
        self.postMessage({ action: 'pdfLoaded', numPages: pdf.numPages });
    } else if (action === 'loadPage') {
        const { pdfData, pageNumber, scale } = data;
        const loadingTask = pdfjsLib.getDocument(pdfData);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: scale });
        const canvas = new OffscreenCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        const imageBitmap = canvas.transferToImageBitmap();

        self.postMessage({ action: 'pageRendered', pageNumber, imageBitmap }, [imageBitmap]);
    }
};
