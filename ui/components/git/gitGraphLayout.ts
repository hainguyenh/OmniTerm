import type { GitCommitSummary } from './gitTypes'

interface GraphEdge {
  path: string
  color: number
}

export interface GraphRow {
  lane: number
  color: number
  edges: GraphEdge[]
}

const laneX = (lane: number) => 16 + lane * 22

/** Route only the parent relationships supplied by Git; separate lanes meet at merge commits. */
export function layoutGraph(commits: GitCommitSummary[]) {
  const lanes: string[] = []
  let width = 1
  let nextColor = 0
  const colors = new Map<string, number>()
  const rows: GraphRow[] = []
  for (const commit of commits) {
    const arriving = lanes.includes(commit.id)
    let lane = lanes.indexOf(commit.id)
    if (lane < 0) {
      lane = lanes.length
      lanes.push(commit.id)
      colors.set(commit.id, nextColor++ % 5)
    }
    const before = [...lanes]
    const color = colors.get(commit.id) ?? 0
    lanes.splice(lane, 1)
    commit.parents.forEach((parent, index) => {
      if (!lanes.includes(parent)) {
        lanes.splice(index === 0 ? Math.min(lane, lanes.length) : lanes.length, 0, parent)
        colors.set(parent, index === 0 ? color : nextColor++ % 5)
      }
    })
    const edges: GraphEdge[] = []
    before.forEach((id, index) => {
      if (id === commit.id) {
        if (arriving) {
          edges.push({ path: `M ${laneX(index)} 0 V 26`, color })
        }
      } else {
        const destination = lanes.indexOf(id)
        edges.push({ path: `M ${laneX(index)} 0 C ${laneX(index)} 26 ${laneX(destination)} 26 ${laneX(destination)} 52`, color: colors.get(id) ?? 0 })
      }
    })
    commit.parents.forEach((parent) => {
      const destination = lanes.indexOf(parent)
      edges.push({ path: `M ${laneX(lane)} 26 C ${laneX(lane)} 42 ${laneX(destination)} 38 ${laneX(destination)} 52`, color: colors.get(parent) ?? color })
    })
    width = Math.max(width, before.length, lanes.length)
    rows.push({ lane, color, edges })
  }
  return { rows, width: width * 22 + 10 }
}

