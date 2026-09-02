/**
 * Script de génération des icônes PNG pour le manifest PWA InsTRAM Conducteur.
 *
 * Prérequis : sharp (npm install --save-dev sharp)
 * Usage     : node scripts/generate-icons.js
 *
 * Lit public/icon.svg et génère :
 *  - public/icon-192.png (192×192)
 *  - public/icon-512.png (512×512)
 */

const path = require('path');
const fs = require('fs');

const publicDir = path.join(__dirname, '..', 'public');
const svgPath = path.join(publicDir, 'icon.svg');

async function generateIcons() {
  // Vérifier que sharp est disponible
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.error(
      'sharp non trouvé. Installez-le : npm install --save-dev sharp\n' +
      'Puis relancez : node scripts/generate-icons.js',
    );
    process.exit(1);
  }

  if (!fs.existsSync(svgPath)) {
    console.error('icon.svg introuvable dans public/');
    process.exit(1);
  }

  const sizes = [192, 512];

  for (const size of sizes) {
    const outputPath = path.join(publicDir, `icon-${size}.png`);
    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`Généré : public/icon-${size}.png`);
  }

  console.log('Icônes générées avec succès.');
}

generateIcons().catch((err) => {
  console.error('Erreur lors de la génération :', err.message);
  process.exit(1);
});
