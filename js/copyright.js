document.addEventListener('DOMContentLoaded', function () {
    const currentYear = new Date().getFullYear();
    const copyrightText = `© ${currentYear} PDF Ninja Pro v1.7.1. All rights reserved.`;
    document.getElementById('copyright').innerHTML = copyrightText;
});
