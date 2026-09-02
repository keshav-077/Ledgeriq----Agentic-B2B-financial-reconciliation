'use client'
import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import * as topojson from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'

export type NodeStatus = 'matched' | 'discrepancy' | 'pending'

export interface MapCompany {
  id: string
  name: string
  isOwn: boolean
  status: NodeStatus
  country?: string
}

interface Props {
  companies: MapCompany[]
  onNodeClick: (id: string) => void
}

const COUNTRY_NUM: Record<string, number> = {
  'United States': 840, 'United Kingdom': 826, 'Germany': 276,
  'France': 250, 'Turkey': 792, 'Japan': 392, 'China': 156,
  'India': 356, 'Canada': 124, 'Australia': 36, 'Brazil': 76,
  'Russia': 643, 'South Korea': 410, 'Mexico': 484, 'Italy': 380,
  'Spain': 724, 'Netherlands': 528, 'Switzerland': 756, 'Sweden': 752,
  'Norway': 578, 'Denmark': 208, 'Finland': 246, 'Poland': 616,
  'Austria': 40, 'Belgium': 56, 'Portugal': 620, 'Greece': 300,
  'United Arab Emirates': 784, 'Saudi Arabia': 682, 'Singapore': 702,
  'Hong Kong': 344, 'South Africa': 710, 'Nigeria': 566, 'Egypt': 818,
  'Argentina': 32, 'Chile': 152, 'Colombia': 170, 'Israel': 376,
  'Ukraine': 804, 'Romania': 642, 'Czech Republic': 203, 'Hungary': 348,
  'Thailand': 764, 'Malaysia': 458, 'Indonesia': 360, 'Philippines': 608,
  'New Zealand': 554, 'Ireland': 372, 'Luxembourg': 442,
}

export function CounterpartyMap({ companies, onNodeClick }: Props) {
  const svgRef     = useRef<SVGSVGElement>(null)
  const groupRef   = useRef<SVGGElement | null>(null)
  const [tip,      setTip]   = useState<{ x: number; y: number; text: string; count: number } | null>(null)
  const [ready,    setReady] = useState(false)
  const [scale,    setScale] = useState(1)

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const W = el.clientWidth  || 720
    const H = el.clientHeight || 480

    // ── Build country data ─────────────────────────────────────────────────
    const countryMap = new Map<number, MapCompany[]>()
    companies.forEach(c => {
      const num = c.country ? COUNTRY_NUM[c.country] : undefined
      if (!num) return
      const arr = countryMap.get(num) ?? []
      arr.push(c)
      countryMap.set(num, arr)
    })

    const total    = Math.max(companies.length, 1)
    const maxInOne = Math.max(...Array.from(countryMap.values()).map(a => a.length), 1)

    // Intensity scale: light (#bbf7d0) → dark (#14532d) green
    const greenScale = d3.scaleLinear<string>()
      .domain([0, maxInOne])
      .range(['#bbf7d0', '#14532d'])
      .clamp(true)

    // Amber scale for discrepancy countries
    const amberScale = d3.scaleLinear<string>()
      .domain([0, maxInOne])
      .range(['#fde68a', '#92400e'])
      .clamp(true)

    d3.json<Topology>('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(world => {
        if (!world) return

        const svg = d3.select(el)
        svg.selectAll('*').remove()

        // Clip path
        svg.append('defs').append('clipPath').attr('id', 'map-clip')
          .append('rect').attr('width', W).attr('height', H).attr('rx', 20)

        // Clean white background
        svg.append('rect')
          .attr('width', W).attr('height', H).attr('rx', 20)
          .attr('fill', '#f1f5f9')

        // Map group (zoom target)
        const g = svg.append('g').attr('clip-path', 'url(#map-clip)')
        groupRef.current = g.node()

        const projection = d3.geoNaturalEarth1()
          .scale((W / 6.28) * 1.05)
          .translate([W / 2, H / 2])
        const path = d3.geoPath().projection(projection)

        const countries = topojson.feature(world, world.objects.countries as GeometryCollection)

        // Country fills
        g.selectAll<SVGPathElement, GeoJSON.Feature>('path.country')
          .data((countries as GeoJSON.FeatureCollection).features)
          .enter().append('path')
          .attr('class', 'country')
          .attr('d', path as any)
          .attr('fill', d => {
            const id  = +(d as any).id
            const cps = countryMap.get(id)
            if (!cps) return '#e2e8f0'
            // Always use green scale — dot color already shows discrepancy/own status
            return greenScale(cps.length)
          })
          .attr('stroke', d => {
            const id  = +(d as any).id
            return countryMap.has(id) ? '#fff' : '#d1d5db'
          })
          .attr('stroke-width', d => countryMap.has(+(d as any).id) ? 0.8 : 0.3)
          .style('cursor', d => countryMap.has(+(d as any).id) ? 'pointer' : 'default')
          .on('mousemove', (event: MouseEvent, d) => {
            const id  = +(d as any).id
            const cps = countryMap.get(id)
            if (!cps) return
            const rect = el.getBoundingClientRect()
            setTip({
              x:     event.clientX - rect.left,
              y:     event.clientY - rect.top,
              text:  cps.map(c => c.name + (c.isOwn ? ' ★' : '')).join(' · '),
              count: cps.length,
            })
          })
          .on('mouseleave', () => setTip(null))
          .on('click', (_, d) => {
            const id  = +(d as any).id
            const cps = countryMap.get(id)
            if (!cps) return
            const target = cps.find(c => !c.isOwn) ?? cps[0]
            if (target) onNodeClick(target.id)
          })

        // Country borders
        g.append('path')
          .datum(topojson.mesh(world, world.objects.countries as GeometryCollection, (a, b) => a !== b))
          .attr('d', path as any)
          .attr('fill', 'none').attr('stroke', '#d1d5db').attr('stroke-width', 0.3)

        // Markers — offset companies in same country so they don't overlap
        companies.forEach(c => {
          const num = c.country ? COUNTRY_NUM[c.country] : undefined
          if (!num) return
          const feat = (countries as GeoJSON.FeatureCollection).features.find(
            f => +(f as any).id === num,
          )
          if (!feat) return
          const [baseCx, baseCy] = path.centroid(feat as any)
          if (!baseCx || isNaN(baseCx)) return

          // Offset when multiple companies share the same country
          const siblings    = countryMap.get(num) ?? []
          const myIdx       = siblings.findIndex(s => s.id === c.id)
          const total       = siblings.length
          const spreadAngle = total > 1 ? (myIdx / (total - 1) - 0.5) * Math.PI * 0.8 : 0
          const spreadDist  = total > 1 ? 22 : 0
          const cx = baseCx + Math.sin(spreadAngle) * spreadDist
          const cy = baseCy - Math.abs(Math.cos(spreadAngle)) * spreadDist * 0.3

          const color = c.isOwn ? '#0ea5e9'
            : c.status === 'discrepancy' ? '#f59e0b'
            : c.status === 'matched'     ? '#16a34a'
            : '#6b7280'

          // Pulse
          g.append('circle')
            .attr('cx', cx).attr('cy', cy).attr('r', c.isOwn ? 11 : 9)
            .attr('fill', 'none').attr('stroke', color)
            .attr('stroke-width', 1.5).attr('opacity', 0.4)

          // Dot
          g.append('circle')
            .attr('cx', cx).attr('cy', cy).attr('r', c.isOwn ? 7 : 6)
            .attr('fill', color).attr('stroke', '#fff').attr('stroke-width', 2)
            .attr('filter', 'drop-shadow(0 1px 4px rgba(0,0,0,0.2))')
            .style('cursor', 'pointer')
            .on('click', () => onNodeClick(c.id))
            .on('mousemove', (event: MouseEvent) => {
              const rect = el.getBoundingClientRect()
              setTip({
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
                text: c.name + (c.isOwn ? ' (Your Company)' : ''),
                count: 1,
              })
            })
            .on('mouseleave', () => setTip(null))

          // Label
          g.append('text')
            .attr('x', cx).attr('y', cy - 12)
            .attr('text-anchor', 'middle')
            .attr('font-size', '8.5px').attr('font-weight', '700')
            .attr('fill', color)
            .attr('paint-order', 'stroke').attr('stroke', '#fff').attr('stroke-width', 3)
            .attr('pointer-events', 'none')
            .text(c.name.length > 14 ? c.name.slice(0, 12) + '…' : c.name)
        })

        // ── Zoom ──────────────────────────────────────────────────────────
        const zoom = d3.zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.8, 10])
          .translateExtent([[-W * 0.5, -H * 0.5], [W * 1.5, H * 1.5]])
          .on('zoom', event => {
            g.attr('transform', event.transform)
            setScale(event.transform.k)
          })

        svg.call(zoom).on('dblclick.zoom', null)

        setReady(true)
      })
      .catch(() => setReady(true))
  }, [companies, onNodeClick])

  const handleZoom = (factor: number) => {
    const svg = d3.select(svgRef.current!)
    svg.transition().duration(300).call(
      (d3.zoom<SVGSVGElement, unknown>() as any).__zoomTransform
        ? (z: any) => z.scaleBy(svg, factor)
        : (z: any) => z,
    )
    // simple approach
    const el = svgRef.current
    if (!el || !groupRef.current) return
    const g   = d3.select(groupRef.current)
    const cur = d3.zoomTransform(el)
    d3.select(el)
      .transition().duration(250)
      .call(
        (d3.zoom() as any).transform,
        cur.scale(cur.k * factor),
      )
  }

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-border-subtle shadow-sm bg-surface-container"
      style={{ height: 480 }}>

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center z-10 rounded-2xl bg-surface-container">
          <div className="flex items-center gap-3 text-on-surface-variant">
            <div className="w-5 h-5 rounded-full border-2 border-white/40 border-t-[#ffffff] animate-spin" />
            <span className="text-sm font-medium">Loading world map…</span>
          </div>
        </div>
      )}

      <svg ref={svgRef} width="100%" height="100%" style={{ cursor: 'grab' }} />

      {/* Zoom controls */}
      <div className="absolute top-4 left-4 flex flex-col gap-1">
        {[
          { label: '+', factor: 1.5 },
          { label: '−', factor: 1 / 1.5 },
        ].map(({ label, factor }) => (
          <button key={label}
            onClick={() => {
              const el = svgRef.current
              if (!el || !groupRef.current) return
              const cur = d3.zoomTransform(el)
              const newK = Math.max(0.8, Math.min(10, cur.k * factor))
              const W = el.clientWidth / 2
              const H = el.clientHeight / 2
              d3.select(el).transition().duration(250).call(
                (d3.zoom() as any).transform,
                d3.zoomIdentity.translate(
                  W - newK * (W - cur.x) / cur.k,
                  H - newK * (H - cur.y) / cur.k,
                ).scale(newK),
              )
            }}
            className="w-8 h-8 rounded-lg bg-surface-elevated border border-border-subtle shadow-sm text-on-surface-variant font-bold text-lg hover:bg-surface-container transition-colors flex items-center justify-center"
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => {
            const el = svgRef.current
            if (!el) return
            d3.select(el).transition().duration(400).call(
              (d3.zoom() as any).transform,
              d3.zoomIdentity,
            )
          }}
          className="w-8 h-8 rounded-lg bg-surface-elevated border border-border-subtle shadow-sm text-on-surface-variant text-[10px] font-bold hover:bg-surface-container transition-colors flex items-center justify-center"
          title="Reset zoom"
        >
          ⌂
        </button>
      </div>

      {/* Color intensity legend */}
      <div className="absolute bottom-4 left-4 bg-surface-elevated border border-border-subtle rounded-xl px-3.5 py-2.5 shadow-sm">
        <p className="text-[9px] text-on-surface-variant uppercase tracking-widest mb-2 font-semibold">Company density</p>
        <div className="flex items-center gap-2 mb-2">
          <div className="h-3 w-24 rounded-full"
            style={{ background: 'linear-gradient(to right, #bbf7d0, #14532d)' }} />
          <span className="text-[10px] text-on-surface-variant flex items-center gap-1">
            <span>few</span><span>→</span><span>many</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          {[
            { color: '#0ea5e9', label: 'Your Co.' },
            { color: '#f59e0b', label: 'Discrepancy' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
              <span className="text-[10px] font-medium text-on-surface-variant">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Scale indicator */}
      {scale !== 1 && (
        <div className="absolute top-4 right-4 px-2.5 py-1.5 rounded-xl bg-surface-elevated border border-border-subtle text-[10px] font-mono text-on-surface-variant shadow-sm">
          {scale.toFixed(1)}×
        </div>
      )}

      {/* Tooltip */}
      {tip && (
        <div className="absolute pointer-events-none z-20 px-3 py-2 rounded-xl bg-surface-elevated border border-border-subtle shadow-xl"
          style={{ left: tip.x + 14, top: tip.y - 10, maxWidth: 240 }}>
          <p className="text-xs font-bold text-white">{tip.text}</p>
          {tip.count > 1 && (
            <p className="text-[10px] text-on-surface-variant mt-0.5">{tip.count} companies in this region</p>
          )}
        </div>
      )}
    </div>
  )
}