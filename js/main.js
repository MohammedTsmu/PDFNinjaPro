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
    const fileInput = document.getElementById('pdf-upload');
    if (fileInput) {
        fileInput.addEventListener('change', function () {
            const file = this.files[0];
            if (file) {
                console.log('File selected:', file.name);
                const fileReader = new FileReader();

                fileReader.onloadstart = function () {
                    document.getElementById('spinner').classList.remove('hidden');
                };

                fileReader.onloadend = function () {
                    const notif = document.getElementById('upload-notification');
                    notif.classList.remove('hidden');
                    setTimeout(() => {
                        notif.classList.add('hidden');
                    }, 3000);
                };

                fileReader.onload = function () {
                    const typedarray = new Uint8Array(this.result);
                    pdfjsLib.getDocument(typedarray).promise.then(function (loadedPdf) {
                        console.log('PDF loaded with', loadedPdf.numPages, 'pages.');
                        pdf = loadedPdf;
                        totalPages = pdf.numPages;
                        displayAllPages();
                        document.getElementById('spinner').classList.add('hidden');
                        document.getElementById('scroll-buttons').style.display = 'flex';
                    }).catch(function (error) {
                        console.error('Error loading PDF:', error);
                        document.getElementById('spinner').classList.add('hidden');
                    });
                };
                fileReader.readAsArrayBuffer(file);
            } else {
                console.log('No file selected.');
            }
        });
    }

    // إعداد أحداث أزرار التمرير
    document.getElementById('scroll-top-btn').addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.getElementById('scroll-bottom-btn').addEventListener('click', function () {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });

    // Reverse Sync: Input -> Visual Selection
    const rangesInput = document.getElementById('page-ranges');
    if (rangesInput) {
        rangesInput.addEventListener('input', function () {
            const val = this.value;
            const newSelected = new Set();

            if (val) {
                const parts = val.split(',');
                parts.forEach(part => {
                    const range = part.trim().split('-');
                    if (range.length === 2) {
                        const start = parseInt(range[0]);
                        const end = parseInt(range[1]);
                        if (!isNaN(start) && !isNaN(end)) {
                            const min = Math.min(start, end);
                            const max = Math.max(start, end);
                            for (let i = min; i <= max; i++) newSelected.add(i);
                        }
                    } else if (range.length === 1) {
                        const page = parseInt(range[0]);
                        if (!isNaN(page)) newSelected.add(page);
                    }
                });
            }

            // Update Global State
            selectedPages = newSelected;

            // Update UI (but don't overwrite input self to avoid cursor jumps!)
            // We duplicate UI update logic here or extract it to updateVisualsOnly() 
            // Simpler: Just copy specific UI update code here
            document.querySelectorAll('.page-container').forEach(container => {
                const num = parseInt(container.getAttribute('data-page-number'));
                if (selectedPages.has(num)) {
                    container.classList.add('selected');
                } else {
                    container.classList.remove('selected');
                }
            });
        });
    }
});

function updateSelectionUI() {
    // Sync UI with selectedPages Set
    document.querySelectorAll('.page-container').forEach(container => {
        const num = parseInt(container.getAttribute('data-page-number'));
        if (selectedPages.has(num)) {
            container.classList.add('selected');
        } else {
            container.classList.remove('selected');
        }
    });

    // Sync Input with Range Formatting
    const rangesInput = document.getElementById('page-ranges');
    if (rangesInput) {
        const sorted = Array.from(selectedPages).sort((a, b) => a - b);
        let ranges = [];
        for (let i = 0; i < sorted.length; i++) {
            const start = sorted[i];
            let end = start;
            while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
                end++;
                i++;
            }
            if (start === end) ranges.push(start);
            else ranges.push(`${start}-${end}`);
        }
        rangesInput.value = ranges.join(', ');
    }
}

document.getElementById('sel-all').addEventListener('click', () => {
    for (let i = 1; i <= totalPages; i++) selectedPages.add(i);
    updateSelectionUI();
});

document.getElementById('sel-none').addEventListener('click', () => {
    selectedPages.clear();
    updateSelectionUI();
});

document.getElementById('sel-inverse').addEventListener('click', () => {
    for (let i = 1; i <= totalPages; i++) {
        if (selectedPages.has(i)) selectedPages.delete(i);
        else selectedPages.add(i);
    }
    updateSelectionUI();
});

document.getElementById('sel-odd').addEventListener('click', () => {
    selectedPages.clear();
    for (let i = 1; i <= totalPages; i += 2) selectedPages.add(i);
    updateSelectionUI();
});

document.getElementById('sel-even').addEventListener('click', () => {
    selectedPages.clear();
    for (let i = 2; i <= totalPages; i += 2) selectedPages.add(i);
    updateSelectionUI();
});

function displayAllPages() {
    const pdfPreview = document.getElementById('pdf-preview');
    pdfPreview.innerHTML = '';

    // Show Toolbar
    document.getElementById('selection-toolbar').classList.remove('hidden');
    document.getElementById('selection-toolbar').style.display = 'flex';

    document.getElementById('spinner').classList.remove('hidden'); // Show spinner
    const loadPage = function (pageNumber) {
        if (pageNumber > totalPages) {
            document.getElementById('spinner').classList.add('hidden'); // Hide spinner when done
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
                    } else {
                        selectedPages.add(pageNumber);
                    }
                    console.log('Selected pages:', Array.from(selectedPages));
                    updateSelectionUI();
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
