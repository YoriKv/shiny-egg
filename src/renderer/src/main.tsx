import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { EditSessionProvider } from './edit-session/EditSession'
import './App.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditSessionProvider>
      <App />
    </EditSessionProvider>
  </StrictMode>
)
