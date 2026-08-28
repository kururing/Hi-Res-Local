import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { loadAppFont } from './loadAppFonts';
import { getAppFontStacks } from './services/fonts';
import { Storage } from './services/storage';
import './index.css';

const initialFont = Storage.getSettings().font_family;

void loadAppFont(initialFont)
  .then(() => {
    const stacks = getAppFontStacks(initialFont);
    document.documentElement.style.setProperty('--font-ui', stacks.ui);
    document.documentElement.style.setProperty('--font-display', stacks.display);
  })
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
