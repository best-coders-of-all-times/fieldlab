import React from 'react';
import ReactDOM from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles/index.css';
import App from './app/App';
import { AppErrorBoundary } from './ui/AppErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(<AppErrorBoundary><App /></AppErrorBoundary>);
