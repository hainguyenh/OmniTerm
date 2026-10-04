import type { GraphRow } from './gitGraphLayout'

const laneX = (lane: number) => 16 + lane * 22

export function GitGraphLanes({ rows, width, selectedIndex, merges }: { rows: GraphRow[]; width: number; selectedIndex: number; merges: boolean[] }) {
  return (
    <svg
      className="git-graph-lanes"
      width={width}
      height={rows.length * 52}
      viewBox={`0 0 ${width} ${rows.length * 52}`}
      aria-hidden="true"
    >
      {rows.map((row, rowIndex) => <g key={rowIndex} transform={`translate(0 ${rowIndex * 52})`}>
        {row.edges.map((edge, index) => <path key={index} d={edge.path} className={`git-lane-${edge.color}`} />)}
        {selectedIndex === rowIndex && <circle cx={laneX(row.lane)} cy="26" r="9" className={`git-graph-halo git-lane-${row.color}`} />}
        <circle
          cx={laneX(row.lane)}
          cy="26"
          r={merges[rowIndex] ? 5.5 : 4}
          className={`git-graph-node git-lane-${row.color}`}
        />
        {merges[rowIndex] && <circle
          cx={laneX(row.lane)}
          cy="26"
          r="1.5"
          className={`git-graph-merge-dot git-lane-${row.color}`}
        />}
      </g>)}
    </svg>
  )
}
