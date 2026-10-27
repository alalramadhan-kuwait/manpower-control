import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { UpdatePrompt } from './app/UpdatePrompt';
import { BusyIndicator } from './app/BusyIndicator';
import { OfflineBanner } from './app/OfflineBanner';
import { LangProvider } from './i18n';
import { applyCachedRules } from './data/rulesClient';
import './index.css';

// the organization rules last seen on this device, before anything computes (the database's follow at sign-in)
applyCachedRules();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <LangProvider><App /></LangProvider>
    </BrowserRouter>
    <UpdatePrompt />
    <BusyIndicator />
    <OfflineBanner />
  </React.StrictMode>
);
