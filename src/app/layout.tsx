import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from 'react-hot-toast'
import AuthProvider from '@/components/providers/AuthProvider'

export const metadata: Metadata = {
  title: 'SpeedTest – Speed Innovation',
  description: 'Candidate Assessment Platform by Speed Innovation',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                borderRadius: '10px',
                background: '#333',
                color: '#fff',
              },
              success: { style: { background: '#3B1F8C' } },
              error: { style: { background: '#DC2626' } },
            }}
          />
        </AuthProvider>
      </body>
    </html>
  )
}
