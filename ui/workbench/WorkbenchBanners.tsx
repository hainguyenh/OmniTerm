import { useContributions } from '../ide/workbench/contributions'

/** Every registered workbench banner, in registration order, between the title bar and the tool windows. */
export function WorkbenchBanners() {
  const banners = useContributions((s) => s.workbenchBanners)
  return (
    <>
      {[...banners.values()].map(({ id, component: Banner }) => (
        <Banner key={id} />
      ))}
    </>
  )
}
