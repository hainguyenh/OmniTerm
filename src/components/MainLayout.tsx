/* eslint-disable react-refresh/only-export-components */
import React from 'react'
import MainLayoutView from './MainLayoutView'
import { useMainLayoutController } from './useMainLayoutController'
import type { MainLayoutProps } from './mainLayoutShared'

export { mintSessionId } from './mainLayoutShared'
export type { Connection, Folder, LocalShell, SessionStatus } from './mainLayoutShared'

const MainLayout: React.FC<MainLayoutProps> = (props) => {
  const model = useMainLayoutController(props)
  return <MainLayoutView model={model} />
}

export default MainLayout
