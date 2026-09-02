/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Charte InsTRAM — ne pas modifier sans validation
        brand: {
          DEFAULT: '#205E98', // navigation, boutons principaux
          light: '#4596D7',   // actions secondaires
          dark: '#162E49',    // zones officielles
        },
        // VERT EXCLUSIVEMENT TRANSACTIONNEL : Réserver / Payer / Confirmer
        action: '#9CC43D',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'Cantarell',
          '"Helvetica Neue"',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
