import React from 'react';
import ReactDOM from 'react-dom/client';
import { InspectProvider } from '@uxerjs/universal-inspector/react';
import { App } from './app/App';
import { ContentErrorBoundary } from './shared/components/ContentErrorBoundary';
import { LocaleProvider } from './shared/i18n/LocaleProvider';

const previewLocale = import.meta.env.DEV && ['/office-preview', '/office-demo'].includes(window.location.pathname) ? 'zh-CN' : undefined;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocaleProvider guestLocale={previewLocale}>
      <ContentErrorBoundary>
        <InspectProvider>
          <App />
        </InspectProvider>
      </ContentErrorBoundary>
    </LocaleProvider>
  </React.StrictMode>,
);
