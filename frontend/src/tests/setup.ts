import '@testing-library/jest-dom'

// Mock window.invoke for tests
Object.defineProperty(window, 'invoke', {
  value: undefined,
  writable: true,
})

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
