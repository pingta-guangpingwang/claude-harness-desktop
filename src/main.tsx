import React from 'react'
import ReactDOM from 'react-dom/client'
import { I18nProvider } from './i18n'
import { HFProvider } from './context/HFContext'
import { ChatProvider } from './context/ChatContext'
import { ThemeProvider } from './context/ThemeContext'
import { RoleProvider } from './context/RoleContext'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <HFProvider>
          <ChatProvider>
            <RoleProvider>
              <App />
            </RoleProvider>
          </ChatProvider>
        </HFProvider>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>
)
