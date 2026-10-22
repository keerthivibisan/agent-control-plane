import '@xyflow/react/dist/style.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { MotionProvider } from './components/motion';
import { createApiClient } from './lib/api';
import { QueryStore } from './lib/query-store';
import { applyTheme, readThemePreference } from './lib/theme';

// index.html's inline script already set the theme before the first paint; this repeats it in
// case that script did not run (a page served without it).
applyTheme(readThemePreference());

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing #root');

const store = new QueryStore(createApiClient());

createRoot(container).render(
  <StrictMode>
    <MotionProvider>
      <App store={store} />
    </MotionProvider>
  </StrictMode>,
);
