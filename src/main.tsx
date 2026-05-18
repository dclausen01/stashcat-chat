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
import { ConfigProvider } from './context/ConfigContext';
import ErrorBoundary from './components/ErrorBoundary';
import { bootstrapMobileBridge } from './lib/mobileBridge';
import { installBbzChatGlobal } from './lib/flutterBridge';

bootstrapMobileBridge();
installBbzChatGlobal();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ConfigProvider>
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
      </ConfigProvider>
    </ErrorBoundary>
  </StrictMode>,
);
