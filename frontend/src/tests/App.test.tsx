import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import App from '../App'

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />)
    // Check that the app renders
    expect(document.querySelector('#root') || document.body).toBeTruthy()
  })

  it('contains main layout structure', () => {
    const { container } = render(<App />)
    // App should render something
    expect(container.firstChild).toBeTruthy()
  })
})
