import { useEffect } from 'react';
import { ToastContainer } from './components/common/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MainLayout } from './components/layout/MainLayout';
import { useSuppressNativeSelectAll } from './hooks/useSuppressNativeSelectAll';
import { useConnectionStore } from './store/connectionStore';
import { useQueryStore } from './store/queryStore';
import { useStartupMark } from './utils/perfMarks';

function App() {
  useStartupMark();

  const activeQueryConnectionId = useQueryStore((state) => {
    const query = state.queries.find((q) => q.id === state.activeQueryId);
    return query?.connectionId ?? null;
  });
  const isProduction = useConnectionStore(
    (state) =>
      state.connections.find((c) => c.id === activeQueryConnectionId)?.isProduction ?? false
  );

  // Apply production mode styling to body
  useEffect(() => {
    if (isProduction) {
      document.body.setAttribute('data-production', 'true');
    } else {
      document.body.removeAttribute('data-production');
    }
  }, [isProduction]);

  useSuppressNativeSelectAll();

  return (
    <ErrorBoundary>
      <MainLayout />
      <ToastContainer />
    </ErrorBoundary>
  );
}

export default App;
