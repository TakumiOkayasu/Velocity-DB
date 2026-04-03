import '@testing-library/jest-dom';

// Mock window.invoke for tests
Object.defineProperty(window, 'invoke', {
  value: undefined,
  writable: true,
});

// Mock ResizeObserver
Object.defineProperty(globalThis, 'ResizeObserver', {
  value: class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  writable: true,
});
