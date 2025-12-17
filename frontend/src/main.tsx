import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

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
