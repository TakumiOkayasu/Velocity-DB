import ReactDOM from 'react-dom/client';
import App from './App';
import { logger } from './utils/logger';
import './styles/global.css';

logger.info(
  `[Build] Frontend source=${__VELOCITYDB_FRONTEND_SOURCE__} mode=${import.meta.env.DEV ? 'development' : 'artifact'}`
);

// Global error handlers - flush logs immediately on crash
window.addEventListener('error', (event) => {
  const msg = `[FATAL] Uncaught error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`;
  logger.error(msg);
  if (event.error?.stack) {
    logger.error(`[FATAL] Stack: ${event.error.stack}`);
  }
  logger.forceFlush();
});

window.addEventListener('unhandledrejection', (event) => {
  const reason =
    event.reason instanceof Error
      ? event.reason.stack || event.reason.message
      : String(event.reason);
  logger.error(`[FATAL] Unhandled promise rejection: ${reason}`);
  logger.forceFlush();
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

// Remove loading screen after React mounts
const removeLoadingScreen = () => {
  const loadingElement = document.getElementById('app-loading');
  if (loadingElement) {
    // Fade out animation
    loadingElement.classList.add('fade-out');
    // Remove from DOM after animation completes
    setTimeout(() => {
      loadingElement.remove();
    }, 300);
  }
};

// Render app (StrictMode disabled for production performance)
ReactDOM.createRoot(rootElement).render(<App />);

// Remove loading screen after first paint
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    removeLoadingScreen();
  });
});
