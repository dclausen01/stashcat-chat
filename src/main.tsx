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
import { bootstrapMobileBridge, isMobileBridge } from './lib/mobileBridge';
import { installBbzChatGlobal } from './lib/flutterBridge';

bootstrapMobileBridge();
installBbzChatGlobal();

// PWA-Service-Worker nur im Desktop-/Browser-Betrieb registrieren. Im
// Flutter-WebView (bridge=mobile) darf nie ein SW aktiv sein: ein veralteter
// SW kann nach einem Deploy eine alte precachte index.html ausliefern, deren
// Asset-Hashes auf dem Server nicht mehr existieren → weisser Screen bis zum
// App-Neustart. bootstrapMobileBridge() raeumt bestehende Registrierungen ab.
if (!isMobileBridge() && 'serviceWorker' in navigator) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {});
}

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
