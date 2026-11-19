import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';
import UpdateNotice from './UpdateNotice';
import '../index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <>
      <App />
      <UpdateNotice />
    </>
  </React.StrictMode>,
);
