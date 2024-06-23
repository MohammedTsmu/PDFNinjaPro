// تعيين مسار العامل الخاص بـ PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js';

let selectedPages = new Set();

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
                            pageContainer.setAttribute('data-page-number', pageNumber); // تعيين رقم الصفحة
                            const pageNumberDiv = document.createElement('div');
                            pageNumberDiv.classList.add('page-number');
                            pageNumberDiv.textContent = pageNumber;
                            pageContainer.appendChild(canvas);
                            pageContainer.appendChild(pageNumberDiv);
                            pageContainer.addEventListener('click', function () {
                                if (selectedPages.has(pageNumber)) {
                                    selectedPages.delete(pageNumber);
                                    pageContainer.classList.remove('selected');
                                } else {
                                    selectedPages.add(pageNumber);
                                    pageContainer.classList.add('selected');
                                }
                                console.log('Selected pages:', Array.from(selectedPages));
                                document.getElementById('start-page').value = Math.min(...selectedPages) || '';
                                document.getElementById('end-page').value = Math.max(...selectedPages) || '';
                            });
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
