/** @type {import('tailwindcss').Config} */

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class', // or 'media' or 'class
  theme: {
    extend: {
      colors: {
        primary: '#000000',
        secondary: '#111111',
        tertiary: '#222222',
        background: '#333333',
        foreground: '#444444',
        muted: '#555555',
        accent: '#666666',
        destructive: '#777777',
        border: '#888888',
        input: '#999999',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
