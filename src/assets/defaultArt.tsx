import React from 'react'

import React from 'react'

export const DefaultIdleArt: React.FC<{ dark: boolean }> = ({ dark }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="w-full h-full opacity-30"
    aria-hidden="true"
  >
    <path d="M4 17L10 11L4 5" stroke={dark ? '#e2e8f0' : '#1e293b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 19H20" stroke={dark ? '#e2e8f0' : '#1e293b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export const DefaultLoadingArt: React.FC<{ dark: boolean }> = ({ dark }) => {
  const accentColor = dark ? '#818cf8' : '#6366f1'

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <svg className="animate-spin h-12 w-12" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" style={{ color: dark ? '#e2e8f0' : '#1e293b' }}></circle>
        <path className="opacity-75" fill={accentColor} d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    </div>
  )
}
