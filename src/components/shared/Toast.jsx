import { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext()

export function ToastProvider({ children }) {
  const [message, setMessage] = useState('')
  const [visible, setVisible] = useState(false)

  const showToast = useCallback((msg) => {
    setMessage(msg)
    setVisible(true)
    setTimeout(() => setVisible(false), 2500)
  }, [])

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className={`toast ${visible ? 'show' : ''}`}>{message}</div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
