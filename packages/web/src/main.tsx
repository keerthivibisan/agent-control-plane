import '@xyflow/react/dist/style.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createApiClient } from './lib/api';
import { QueryStore } from './lib/query-store';
import { applyTheme, readThemePreference } from './lib/theme';

// Apply the theme before the first paint to avoid a light flash in dark mode.
applyTheme(readThemePreference());

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing #root');

const store = new QueryStore(createApiClient());

createRoot(container).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
