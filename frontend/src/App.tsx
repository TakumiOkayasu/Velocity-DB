import { useEffect } from 'react';
import { MainLayout } from './components/layout/MainLayout';
import { useIsProductionMode } from './store/connectionStore';

function App() {
  const isProduction = useIsProductionMode();

  // Apply production mode styling to body
  useEffect(() => {
    if (isProduction) {
      document.body.setAttribute('data-production', 'true');
    } else {
      document.body.removeAttribute('data-production');
    }
  }, [isProduction]);

  return <MainLayout />;
}

export default App;
