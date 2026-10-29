import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './lib/install';
import { trackSessionStart } from './lib/telemetry';
import { AuthProvider } from './lib/auth';
import App from './App';
import './styles.css';

registerSW({ immediate: true });
trackSessionStart(); // no-op until the user has agreed to the Privacy Policy

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
