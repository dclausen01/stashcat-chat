import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { SettingsProvider } from './context/SettingsContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { AnnouncerProvider } from './context/AnnouncerContext';
import { PanelProvider } from './context/PanelContext';
import ErrorBoundary from './components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <SettingsProvider>
          <ConfirmProvider>
            <AnnouncerProvider>
              <AuthProvider>
                <PanelProvider>
                  <App />
                </PanelProvider>
              </AuthProvider>
            </AnnouncerProvider>
          </ConfirmProvider>
        </SettingsProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
