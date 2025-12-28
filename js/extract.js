
// Extract Text Tool Logic

let extractFile = null;
let extractPdfDoc = null;
let extractedTextFull = "";

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('extract-drop-zone');
    const fileInput = document.getElementById('extract-upload');
    const startBtn = document.getElementById('start-extract-btn');
    const resetBtn = document.getElementById('extract-reset-btn');

    // Actions
    const copyBtn = document.getElementById('extract-copy-btn');
    const dlBtn = document.getElementById('extract-download-btn');

    // Drag & Drop
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
        });

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') handleExtractFile(files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleExtractFile(e.target.files[0]);
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetExtractUI);
    if (startBtn) startBtn.addEventListener('click', startExtraction);

    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            if (!extractedTextFull) return;
            navigator.clipboard.writeText(extractedTextFull).then(() => {
                const original = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                setTimeout(() => copyBtn.innerHTML = original, 2000);
            });
        });
    }

    if (dlBtn) {
        dlBtn.addEventListener('click', () => {
            if (!extractedTextFull) return;
            const blob = new Blob([extractedTextFull], { type: "text/plain;charset=utf-8" });
            saveAs(blob, (extractFile ? extractFile.name.replace('.pdf', '') : 'extracted') + ".txt");
        });
    }
});

async function handleExtractFile(file) {
    extractFile = file;

    // UI Update
    document.getElementById('extract-drop-zone').classList.add('hidden');
    document.getElementById('extract-file-info').classList.remove('hidden');
    document.getElementById('start-extract-btn').classList.remove('hidden');

    document.getElementById('extract-filename').textContent = file.name;
    document.getElementById('extract-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + " MB";

    try {
        const arrayBuffer = await file.arrayBuffer();
        extractPdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
    } catch (e) {
        console.error(e);
        alert("Invalid PDF file.");
        resetExtractUI();
    }
}

function resetExtractUI() {
    extractFile = null;
    extractPdfDoc = null;
    extractedTextFull = "";

    document.getElementById('extract-drop-zone').classList.remove('hidden');
    document.getElementById('extract-file-info').classList.add('hidden');
    document.getElementById('start-extract-btn').classList.add('hidden');
    document.getElementById('extract-actions').classList.add('hidden');
    document.getElementById('extract-result').classList.add('hidden');
    document.getElementById('extract-upload').value = '';
    document.getElementById('extract-result').value = '';
}

async function startExtraction() {
    if (!extractPdfDoc) return;

    const startBtn = document.getElementById('start-extract-btn');
    const resultArea = document.getElementById('extract-result');
    const actions = document.getElementById('extract-actions');
    const status = document.getElementById('extract-status');

    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Extracting...';

    resultArea.classList.remove('hidden');
    resultArea.value = "Extracting text... please wait.";
    actions.classList.remove('hidden');

    const totalPages = extractPdfDoc.numPages;
    let fullText = "";

    try {
        for (let i = 1; i <= totalPages; i++) {
            status.textContent = `Processing page ${i} of ${totalPages}...`;

            const page = await extractPdfDoc.getPage(i);
            const content = await page.getTextContent();

            // Simple concatenation strategy
            // items have .str, .transform (position)
            // We'll just join strings. Improving layout is hard without advanced logic.
            const pageText = content.items.map(item => item.str).join(' ');

            fullText += `--- Page ${i} ---\n\n${pageText}\n\n`;

            // Update UI periodically
            if (i % 5 === 0) {
                resultArea.value = fullText;
                resultArea.scrollTop = resultArea.scrollHeight;
                await new Promise(r => setTimeout(r, 10)); // Breathe
            }
        }

        extractedTextFull = fullText;
        resultArea.value = fullText;
        status.textContent = `Extraction complete (${totalPages} pages).`;

        startBtn.innerHTML = '<i class="fas fa-check"></i> Done';
        startBtn.className = 'btn btn-success';

        setTimeout(() => {
            startBtn.classList.add('hidden'); // Hide button after done? Or keep for re-run? 
            // Better to hide it to focus on result.
        }, 1000);

    } catch (e) {
        console.error(e);
        resultArea.value = "Error extracting text: " + e.message;
        startBtn.disabled = false;
        startBtn.innerHTML = 'Try Again';
    }
}
