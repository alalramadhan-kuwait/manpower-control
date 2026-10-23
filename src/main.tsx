import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { UpdatePrompt } from './app/UpdatePrompt';
import { BusyIndicator } from './app/BusyIndicator';
import { LangProvider } from './i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <LangProvider><App /></LangProvider>
    </BrowserRouter>
    <UpdatePrompt />
    <BusyIndicator />
  </React.StrictMode>
);
