import { ArweaveWalletKit } from 'arweave-wallet-kit';
import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App.tsx';
import './index.css';
// setup sentry
import './services/sentry.ts';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ArweaveWalletKit
      config={{
        permissions: [
          'ACCESS_ADDRESS',
          'SIGN_TRANSACTION',
          'SIGNATURE',
          'ACCESS_PUBLIC_KEY',
        ],
      }}
    >
      <App />
    </ArweaveWalletKit>
  </React.StrictMode>,
);
