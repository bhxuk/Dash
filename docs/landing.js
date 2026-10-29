'use strict';
document.getElementById('copyInstall').addEventListener('click',async function(){try{await navigator.clipboard.writeText(document.getElementById('installCommands').textContent);this.textContent='Copied ✓';}catch{this.textContent='Select commands to copy';}});
