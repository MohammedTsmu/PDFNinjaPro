// تعيين مسار العامل الخاص بـ PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js';

document.getElementById('upload-btn').addEventListener('click', function () {
    const fileInput = document.getElementById('pdf-upload');
    const file = fileInput.files[0];
    if (file) {
        console.log('File selected:', file.name);
        const fileReader = new FileReader();
        fileReader.onload = function () {
            const typedarray = new Uint8Array(this.result);
            document.getElementById('spinner').style.display = 'block';
            pdfjsLib.getDocument(typedarray).promise.then(function (pdf) {
                console.log('PDF loaded with', pdf.numPages, 'pages.');
                const pdfPreview = document.getElementById('pdf-preview');
                pdfPreview.innerHTML = '';
                const numPages = pdf.numPages;
                const loadPage = function (pageNumber) {
                    console.log('Loading page', pageNumber);
                    pdf.getPage(pageNumber).then(function (page) {
                        const scale = 1.5;
                        const viewport = page.getViewport({ scale: scale });
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;

                        page.render({ canvasContext: context, viewport: viewport }).promise.then(function () {
                            const pageContainer = document.createElement('div');
                            pageContainer.classList.add('page-container');
                            const pageNumberDiv = document.createElement('div');
                            pageNumberDiv.classList.add('page-number');
                            pageNumberDiv.textContent = pageNumber;
                            pageContainer.appendChild(canvas);
                            pageContainer.appendChild(pageNumberDiv);
                            pdfPreview.appendChild(pageContainer);
                            console.log('Page', pageNumber, 'loaded.');
                            if (pageNumber < numPages) {
                                loadPage(pageNumber + 1);
                            } else {
                                document.getElementById('spinner').style.display = 'none';
                                console.log('All pages loaded.');
                            }
                        });
                    }).catch(function (error) {
                        console.error('Error loading page', pageNumber, error);
                    });
                };
                loadPage(1);
            }).catch(function (error) {
                console.error('Error loading PDF:', error);
            });
        };
        fileReader.readAsArrayBuffer(file);
    } else {
        console.log('No file selected.');
    }
});

document.getElementById('split-btn').addEventListener('click', async function () {
    const chapterName = document.getElementById('chapter-name').value;
    const startPage = parseInt(document.getElementById('start-page').value);
    const endPage = parseInt(document.getElementById('end-page').value);
    const fileInput = document.getElementById('pdf-upload');
    const file = fileInput.files[0];

    if (chapterName && startPage && endPage && file) {
        console.log('Splitting PDF from page', startPage, 'to page', endPage);
        const fileReader = new FileReader();
        fileReader.onload = async function () {
            const typedarray = new Uint8Array(this.result);
            const pdfDoc = await PDFLib.PDFDocument.load(typedarray);
            const pdfLibDoc = await PDFLib.PDFDocument.create();

            if (startPage > 0 && endPage <= pdfDoc.getPageCount()) {
                const pagesToCopy = await pdfLibDoc.copyPages(pdfDoc, Array.from({ length: endPage - startPage + 1 }, (_, i) => i + startPage - 1));
                pagesToCopy.forEach((page) => {
                    pdfLibDoc.addPage(page);
                });

                const pdfBytes = await pdfLibDoc.save();
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                const downloadLink = document.getElementById('download-link');
                downloadLink.href = url;
                downloadLink.download = `${chapterName}.pdf`;
                downloadLink.style.display = 'inline';

                const notification = document.getElementById('notification');
                notification.innerHTML = `PDF split successfully. Download: ${chapterName}.pdf`;
                notification.style.display = 'block';
                console.log('PDF split and ready for download.');
            } else {
                alert('Invalid page range.');
                console.error('Invalid page range:', startPage, endPage);
            }
        };
        fileReader.readAsArrayBuffer(file);
    } else {
        console.log('Missing input for splitting PDF.');
    }
});
