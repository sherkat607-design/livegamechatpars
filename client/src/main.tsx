import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import { ConfirmHost, Toaster } from './components/ui';
import { applyTheme } from './components/settings/Settings';
import { AppPage } from './pages/AppPage';
import { AuthPage } from './pages/AuthPage';
import { InvitePage } from './pages/InvitePage';

applyTheme();
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme());

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/invite/:code" element={<InvitePage />} />
        <Route path="*" element={<AppPage />} />
      </Routes>
      <Toaster />
      <ConfirmHost />
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
