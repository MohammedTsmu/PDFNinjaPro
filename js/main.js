// تعيين مسار العامل الخاص بـ PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js';

let selectedPages = new Set();
let pdf = null;
let currentPage = 1;
let totalPages = 0;
let viewMode = 'whole'; // تغيير القيمة الافتراضية إلى 'whole'

document.addEventListener('DOMContentLoaded', function () {
    // إزالة أزرار التبديل بين طرق العرض
    const viewPaginationBtn = document.getElementById('view-pagination');
    const viewWholeBtn = document.getElementById('view-whole');
    if (viewPaginationBtn) viewPaginationBtn.remove();
    if (viewWholeBtn) viewWholeBtn.remove();

    // إعداد حدث التحميل للملف
    document.getElementById('upload-btn').addEventListener('click', function () {
        const fileInput = document.getElementById('pdf-upload');
        const file = fileInput.files[0];
        if (file) {
            console.log('File selected:', file.name);
            const fileReader = new FileReader();

            fileReader.onloadstart = function () {
                document.getElementById('spinner').style.display = 'block';
            };

            fileReader.onloadend = function () {
                document.getElementById('upload-notification').style.display = 'block';
                setTimeout(() => {
                    document.getElementById('upload-notification').style.display = 'none';
                }, 3000);
            };

            fileReader.onload = function () {
                const typedarray = new Uint8Array(this.result);
                pdfjsLib.getDocument(typedarray).promise.then(function (loadedPdf) {
                    console.log('PDF loaded with', loadedPdf.numPages, 'pages.');
                    pdf = loadedPdf;
                    totalPages = pdf.numPages;
                    displayAllPages();
                    document.getElementById('spinner').style.display = 'none';
                    document.getElementById('scroll-buttons').style.display = 'block';
                }).catch(function (error) {
                    console.error('Error loading PDF:', error);
                    document.getElementById('spinner').style.display = 'none';
                });
            };
            fileReader.readAsArrayBuffer(file);
        } else {
            console.log('No file selected.');
        }
    });

    // إعداد أحداث أزرار التمرير
    document.getElementById('scroll-top-btn').addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.getElementById('scroll-bottom-btn').addEventListener('click', function () {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
});

function displayAllPages() {
    const pdfPreview = document.getElementById('pdf-preview');
    pdfPreview.innerHTML = '';
    document.getElementById('spinner').style.display = 'block'; // Show spinner
    const loadPage = function (pageNumber) {
        if (pageNumber > totalPages) {
            document.getElementById('spinner').style.display = 'none'; // Hide spinner when done
            return;
        }
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
                pageContainer.setAttribute('data-page-number', pageNumber);
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
                loadPage(pageNumber + 1);
            });
        }).catch(function (error) {
            console.error('Error loading page', pageNumber, error);
            loadPage(pageNumber + 1);
        });
    };
    loadPage(1);
}
