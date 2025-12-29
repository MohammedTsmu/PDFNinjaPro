document.addEventListener('DOMContentLoaded', function () {
    const currentYear = new Date().getFullYear();
    const copyrightText = `© ${currentYear} PDF Ninja Pro v1.1.4. All rights reserved.`;
    document.getElementById('copyright').innerHTML = copyrightText;
});
