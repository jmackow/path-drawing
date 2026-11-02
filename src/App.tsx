import { useState, useRef, useEffect, useCallback } from "react";

const POINT_R = 7, HANDLE_R = 5, SEGMENTS = 300;

type Point = { x: number; y: number };
type GradientStop = { id: number; color: string; pos: number };
type NodeType = 'symmetric' | 'asymmetric' | 'sharp';
type PathNode = {
  x: number; y: number;
  cp1x: number; cp1y: number;
  cp2x: number; cp2y: number;
  type: NodeType;
};
type Selected = { type: 'anchor' | 'cp1' | 'cp2'; idx: number };



function gaussianSmooth(pts: Point[], passes = 4): Point[] {
  let r = pts;
  for (let p = 0; p < passes; p++) {
    r = r.map((pt, i) => {
      if (i === 0 || i === r.length - 1) return pt;
      return {
        x: (r[i-1].x + pt.x * 2 + r[i+1].x) / 4,
        y: (r[i-1].y + pt.y * 2 + r[i+1].y) / 4,
      };
    });
  }
  return r;
}

function smoothPath(pts: Point[], tension = 0.38): PathNode[] {
  if (pts.length < 2) return [];
  return pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    return {
      x: p.x, y: p.y,
      cp1x: p.x - (next.x - prev.x) * tension,
      cp1y: p.y - (next.y - prev.y) * tension,
      cp2x: p.x + (next.x - prev.x) * tension,
      cp2y: p.y + (next.y - prev.y) * tension,
      type: 'symmetric' as NodeType,
    };
  });
}

function bezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
    y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
  };
}

function samplePath(nodes: PathNode[], n: number): Point[] {
  if (nodes.length < 2) return [];
  const pts: Point[] = [];
  const segs = nodes.length - 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const seg = Math.min(Math.floor(t * segs), segs - 1);
    const lt = t * segs - seg;
    const p0 = nodes[seg], p3 = nodes[seg + 1];
    const cp0 = (p0.type === 'sharp' || p3.type === 'sharp') ? p0 : { x: p0.cp2x, y: p0.cp2y };
    const cp1 = (p0.type === 'sharp' || p3.type === 'sharp') ? p3 : { x: p3.cp1x, y: p3.cp1y };
    pts.push(bezierPoint(p0, cp0, cp1, p3, lt));
  }
  return pts;
}

function pathLength(samples: Point[]): number {
  let len = 0;
  for (let i = 1; i < samples.length; i++)
    len += Math.hypot(samples[i].x - samples[i-1].x, samples[i].y - samples[i-1].y);
  return len;
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r,g,b].map(v => Math.round(v).toString(16).padStart(2,'0')).join('');
}
function lerpColor(c1: string, c2: string, t: number): string {
  const [r1,g1,b1] = hexToRgb(c1), [r2,g2,b2] = hexToRgb(c2);
  return rgbToHex(r1+(r2-r1)*t, g1+(g2-g1)*t, b1+(b2-b1)*t);
}
function gradientColor(stops: GradientStop[], t: number): string {
  const s = [...stops].sort((a,b) => a.pos - b.pos);
  if (t <= s[0].pos) return s[0].color;
  if (t >= s[s.length-1].pos) return s[s.length-1].color;
  for (let i = 0; i < s.length-1; i++) {
    if (t >= s[i].pos && t <= s[i+1].pos) {
      const lt = (t - s[i].pos) / (s[i+1].pos - s[i].pos);
      return lerpColor(s[i].color, s[i+1].color, lt);
    }
  }
  return s[0].color;
}

const EASINGS_FN: Record<string, (t: number) => number> = {
  'Linear':      t => t,
  'Ease In':     t => t * t,
  'Ease Out':    t => t * (2 - t),
  'Ease In Out': t => t < 0.5 ? 2*t*t : -1+(4-2*t)*t,
  'Bounce Out':  t => { const c4 = (2*Math.PI)/3; return t===0?0:t===1?1:Math.pow(2,-10*t)*Math.sin((t*10-0.75)*c4)+1; },
  'Anticipate':  t => { const c1=1.70158,c3=c1+1; return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2); },
};

const ANCHOR_TYPES: { key: NodeType; label: string; desc: string }[] = [
  { key: 'symmetric',  label: 'Symmetric',  desc: 'Handles mirror angle & length' },
  { key: 'asymmetric', label: 'Asymmetric', desc: 'Handles mirror angle only' },
  { key: 'sharp',      label: 'Sharp',      desc: 'Hard corner, no curve' },
];

const DEFAULT_STOPS: GradientStop[] = [
  { id: 1, color: '#238403', pos: 0 },
  { id: 2, color: '#B6F601', pos: 0.5 },
  { id: 3, color: '#FBFFF0', pos: 1 },
];


const label: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 400,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#888888',
  marginBottom: 10,
  display: 'block',
};

const divider: React.CSSProperties = {
  borderBottom: '1px solid #e8e8e8',
  padding: '16px 20px',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={label}>{children}</div>;
}

export default function App() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const animRef     = useRef<number>(0);
  const panStart    = useRef<Point | null>(null);
  const nextStopId  = useRef(4);
  const importRef   = useRef<HTMLInputElement>(null);

  const [canvasW, setCanvasW]         = useState(400);
  const [canvasH, setCanvasH]         = useState(400);
  const [canvasInput, setCanvasInput] = useState({ w: '400', h: '400' });
  const [mode, setMode]               = useState<'draw' | 'edit' | 'pan'>('draw');
  const [nodes, setNodes]             = useState<PathNode[]>([]);
  const [rawPts, setRawPts]           = useState<Point[]>([]);
  const [isDrawing, setIsDrawing]     = useState(false);
  const [isPanning, setIsPanning]     = useState(false);
  const [stops, setStops]             = useState<GradientStop[]>(DEFAULT_STOPS);
  const [strokeWidth, setStrokeWidth] = useState(24);
  const [animating, setAnimating]     = useState(false);
  const [animProgress, setAnimProgress] = useState(1);
  const [animDuration, setAnimDuration] = useState(1.5);
  const [animEasing, setAnimEasing]   = useState('Ease In Out');
  const [animReverse, setAnimReverse] = useState(false);
  const [selected, setSelected]       = useState<Selected | null>(null);
  const [dragging, setDragging]       = useState<Selected | null>(null);

  const getPos = (e: React.MouseEvent | React.TouchEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = canvasW / rect.width, sy = canvasH / rect.height;
    const src = 'touches' in e ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * sx, y: (src.clientY - rect.top) * sy };
  };

  const samples = nodes.length >= 2 ? samplePath(nodes, SEGMENTS) : [];

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);
    if (samples.length < 2) return;

    const easeFn = EASINGS_FN[animEasing] ?? EASINGS_FN['Ease In Out'];
    const eased = Math.max(0, Math.min(1, easeFn(animProgress)));
    const visibleCount = Math.round(eased * (samples.length - 1));
    const drawFrom = animReverse ? Math.max(1, samples.length - 1 - visibleCount) : 1;
    const drawTo   = animReverse ? samples.length - 1 : visibleCount;

    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = strokeWidth;
    for (let i = drawFrom; i <= drawTo; i++) {
      const t0 = (i-1)/(samples.length-1), t1 = i/(samples.length-1);
      const c0 = gradientColor(stops, t0), c1 = gradientColor(stops, t1);
      const grad = ctx.createLinearGradient(samples[i-1].x, samples[i-1].y, samples[i].x, samples[i].y);
      grad.addColorStop(0, c0); grad.addColorStop(1, c1);
      ctx.beginPath(); ctx.strokeStyle = grad;
      ctx.moveTo(samples[i-1].x, samples[i-1].y);
      ctx.lineTo(samples[i].x, samples[i].y);
      ctx.stroke();
    }

    if (mode === 'edit' && nodes.length) {
      nodes.forEach((n, i) => {
        const isSharp = n.type === 'sharp';
        if (i > 0 && !isSharp && nodes[i-1].type !== 'sharp') {
          ctx.beginPath(); ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1;
          ctx.setLineDash([3,3]); ctx.moveTo(n.x, n.y); ctx.lineTo(n.cp1x, n.cp1y); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath();
          ctx.fillStyle = selected?.type === 'cp1' && selected.idx === i ? '#111111' : '#ffffff';
          ctx.strokeStyle = '#111111'; ctx.lineWidth = 1;
          ctx.arc(n.cp1x, n.cp1y, HANDLE_R, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        }
        if (i < nodes.length-1 && !isSharp && nodes[i+1]?.type !== 'sharp') {
          ctx.beginPath(); ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1;
          ctx.setLineDash([3,3]); ctx.moveTo(n.x, n.y); ctx.lineTo(n.cp2x, n.cp2y); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath();
          ctx.fillStyle = selected?.type === 'cp2' && selected.idx === i ? '#111111' : '#ffffff';
          ctx.strokeStyle = '#111111'; ctx.lineWidth = 1;
          ctx.arc(n.cp2x, n.cp2y, HANDLE_R, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        }
        const selAnchor = selected?.idx === i && selected.type === 'anchor';
        ctx.beginPath();
        ctx.fillStyle = selAnchor ? '#111111' : '#ffffff';
        ctx.strokeStyle = '#111111'; ctx.lineWidth = 1.5;
        if (isSharp) ctx.rect(n.x - POINT_R, n.y - POINT_R, POINT_R*2, POINT_R*2);
        else ctx.arc(n.x, n.y, POINT_R, 0, Math.PI*2);
        ctx.fill(); ctx.stroke();
      });
    }
  }, [nodes, samples, stops, strokeWidth, mode, selected, animProgress, animEasing, animReverse, canvasW, canvasH]);

  useEffect(() => { render(); }, [render]);

  useEffect(() => {
    if (!animating) return;
    const start = performance.now();
    setAnimProgress(0);
    const tick = (now: number) => {
      const t = Math.min((now - start) / (animDuration * 1000), 1);
      setAnimProgress(t);
      if (t < 1) animRef.current = requestAnimationFrame(tick);
      else { setAnimating(false); setAnimProgress(1); }
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [animating, animDuration]);

  useEffect(() => {
    if (!isDrawing || rawPts.length < 2) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.beginPath(); ctx.strokeStyle = '#cccccc'; ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    rawPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
  }, [rawPts, isDrawing, canvasW, canvasH, strokeWidth]);

  const onMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const pos = getPos(e);
    if (mode === 'draw') {
      setIsDrawing(true); setRawPts([pos]); setNodes([]); setAnimProgress(1); setAnimating(false);
    } else if (mode === 'edit') {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (Math.hypot(pos.x-n.x, pos.y-n.y) < POINT_R+4) {
          setSelected({ type:'anchor', idx:i }); setDragging({ type:'anchor', idx:i }); return;
        }
        if (i > 0 && n.type !== 'sharp' && Math.hypot(pos.x-n.cp1x, pos.y-n.cp1y) < HANDLE_R+4) {
          setSelected({ type:'cp1', idx:i }); setDragging({ type:'cp1', idx:i }); return;
        }
        if (i < nodes.length-1 && n.type !== 'sharp' && Math.hypot(pos.x-n.cp2x, pos.y-n.cp2y) < HANDLE_R+4) {
          setSelected({ type:'cp2', idx:i }); setDragging({ type:'cp2', idx:i }); return;
        }
      }
      setSelected(null);
      addPointOnPath(pos);
    } else if (mode === 'pan') {
      setIsPanning(true);
      panStart.current = pos;
    }
  };

  const onMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const pos = getPos(e);
    if (mode === 'draw' && isDrawing) {
      setRawPts(prev => {
        const last = prev[prev.length - 1];
        if (last && Math.hypot(pos.x - last.x, pos.y - last.y) < 8) return prev;
        return [...prev, pos];
      });
    } else if (mode === 'edit' && dragging) {
      setNodes(prev => {
        const next = prev.map(n => ({ ...n }));
        const { type, idx } = dragging;
        const n = next[idx];
        if (type === 'anchor') {
          const dx = pos.x-n.x, dy = pos.y-n.y;
          n.x=pos.x; n.y=pos.y; n.cp1x+=dx; n.cp1y+=dy; n.cp2x+=dx; n.cp2y+=dy;
        } else if (type === 'cp1') {
          n.cp1x=pos.x; n.cp1y=pos.y;
          if (n.type === 'symmetric') {
            const dx=n.x-pos.x, dy=n.y-pos.y, d=Math.hypot(dx,dy);
            const len=Math.hypot(n.cp2x-n.x, n.cp2y-n.y);
            if (d>0) { n.cp2x=n.x+dx/d*len; n.cp2y=n.y+dy/d*len; }
          } else if (n.type === 'asymmetric') {
            const dx=n.x-pos.x, dy=n.y-pos.y, d=Math.hypot(dx,dy);
            const len=Math.hypot(n.cp2x-n.x, n.cp2y-n.y);
            if (d>0) { n.cp2x=n.x+dx/d*len; n.cp2y=n.y+dy/d*len; }
          }
        } else if (type === 'cp2') {
          n.cp2x=pos.x; n.cp2y=pos.y;
          if (n.type === 'symmetric') {
            const dx=n.x-pos.x, dy=n.y-pos.y, d=Math.hypot(dx,dy);
            const len=Math.hypot(n.cp1x-n.x, n.cp1y-n.y);
            if (d>0) { n.cp1x=n.x+dx/d*len; n.cp1y=n.y+dy/d*len; }
          } else if (n.type === 'asymmetric') {
            const dx=n.x-pos.x, dy=n.y-pos.y, d=Math.hypot(dx,dy);
            const len=Math.hypot(n.cp1x-n.x, n.cp1y-n.y);
            if (d>0) { n.cp1x=n.x+dx/d*len; n.cp1y=n.y+dy/d*len; }
          }
        }
        return next;
      });
    } else if (mode === 'pan' && isPanning && panStart.current) {
      const dx = pos.x - panStart.current.x, dy = pos.y - panStart.current.y;
      setNodes(prev => prev.map(n => ({
        ...n,
        x: n.x+dx, y: n.y+dy,
        cp1x: n.cp1x+dx, cp1y: n.cp1y+dy,
        cp2x: n.cp2x+dx, cp2y: n.cp2y+dy,
      })));
      panStart.current = { x: panStart.current.x+dx, y: panStart.current.y+dy };
    }
  };

  const onMouseUp = () => {
    if (mode === 'draw' && isDrawing) {
      setIsDrawing(false);
      if (rawPts.length < 2) return;
      setNodes(smoothPath(gaussianSmooth(rawPts, 2), 0.3));
      setRawPts([]);
    }
    setDragging(null);
    setIsPanning(false);
  };

  const setAnchorType = (type: NodeType) => {
    if (!selected || selected.type !== 'anchor') return;
    setNodes(prev => prev.map((n, i) => i === selected.idx ? { ...n, type } : n));
  };

  const deleteSelected = () => {
    if (!selected || selected.type !== 'anchor') return;
    if (nodes.length <= 2) { setNodes([]); setSelected(null); return; }
    setNodes(prev => prev.filter((_, i) => i !== selected.idx));
    setSelected(null);
  };

  const addPointOnPath = (pos: Point) => {
    if (nodes.length < 2) return;
    const samps = samplePath(nodes, SEGMENTS);
    let minD = Infinity, minI = 0;
    samps.forEach((s, i) => { const d = Math.hypot(s.x-pos.x, s.y-pos.y); if (d < minD) { minD = d; minI = i; } });
    if (minD > 20) return;
    const t = minI / SEGMENTS;
    const segs = nodes.length - 1;
    const segIdx = Math.min(Math.floor(t * segs), segs - 1);
    const lt = t * segs - segIdx;
    const p0 = nodes[segIdx], p3 = nodes[segIdx+1];
    const cp0 = { x: p0.cp2x, y: p0.cp2y }, cp1 = { x: p3.cp1x, y: p3.cp1y };
    const m01x=p0.x+(cp0.x-p0.x)*lt, m01y=p0.y+(cp0.y-p0.y)*lt;
    const m12x=cp0.x+(cp1.x-cp0.x)*lt, m12y=cp0.y+(cp1.y-cp0.y)*lt;
    const m23x=cp1.x+(p3.x-cp1.x)*lt, m23y=cp1.y+(p3.y-cp1.y)*lt;
    const m012x=m01x+(m12x-m01x)*lt, m012y=m01y+(m12y-m01y)*lt;
    const m123x=m12x+(m23x-m12x)*lt, m123y=m12y+(m23y-m12y)*lt;
    const mx=m012x+(m123x-m012x)*lt, my=m012y+(m123y-m012y)*lt;
    const newNode: PathNode = { x:mx, y:my, cp1x:m012x, cp1y:m012y, cp2x:m123x, cp2y:m123y, type:'symmetric' };
    setNodes(prev => {
      const next = [...prev];
      next[segIdx] = { ...next[segIdx], cp2x: m01x, cp2y: m01y };
      next[segIdx+1] = { ...next[segIdx+1], cp1x: m23x, cp1y: m23y };
      next.splice(segIdx+1, 0, newNode);
      return next;
    });
    setSelected({ type: 'anchor', idx: segIdx+1 });
  };

  const addStop = () => {
    const id = nextStopId.current++;
    setStops(s => [...s, { id, color: '#a855f7', pos: 0.5 }]);
  };
  const removeStop = (id: number) => setStops(s => s.length > 2 ? s.filter(x => x.id !== id) : s);
  const updateStop = (id: number, key: keyof GradientStop, val: string | number) =>
    setStops(s => s.map(x => x.id === id ? { ...x, [key]: val } : x));
  const sortedStops = [...stops].sort((a, b) => a.pos - b.pos);

  const parseSVGPath = (svgText: string): PathNode[] | null => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const pathEl = doc.querySelector('path');
    if (!pathEl) return null;
    const d = pathEl.getAttribute('d');
    if (!d) return null;
    const svgEl = doc.querySelector('svg');
    let vbW = canvasW, vbH = canvasH;
    const vb = svgEl?.getAttribute('viewBox');
    if (vb) {
      const parts = vb.trim().split(/[\s,]+/);
      if (parts.length === 4) { vbW = parseFloat(parts[2]); vbH = parseFloat(parts[3]); }
    } else {
      const wa = svgEl?.getAttribute('width'), ha = svgEl?.getAttribute('height');
      if (wa) vbW = parseFloat(wa);
      if (ha) vbH = parseFloat(ha);
    }
    const scaleX = canvasW / vbW, scaleY = canvasH / vbH;
    const ns = 'http://www.w3.org/2000/svg';
    const tmpSvg = document.createElementNS(ns, 'svg');
    tmpSvg.style.cssText = 'position:absolute;opacity:0;pointer-events:none';
    document.body.appendChild(tmpSvg);
    const tmpPath = document.createElementNS(ns, 'path');
    tmpPath.setAttribute('d', d);
    tmpSvg.appendChild(tmpPath);
    const totalLen = tmpPath.getTotalLength();
    const numSamples = Math.max(20, Math.min(120, Math.round(totalLen / 8)));
    const pts: Point[] = [];
    for (let i = 0; i <= numSamples; i++) {
      const pt = tmpPath.getPointAtLength((i / numSamples) * totalLen);
      pts.push({ x: pt.x * scaleX, y: pt.y * scaleY });
    }
    document.body.removeChild(tmpSvg);
    return smoothPath(pts, 0.3);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = parseSVGPath(ev.target!.result as string);
      if (result) { setNodes(result); setSelected(null); setAnimProgress(1); setAnimating(false); }
      else alert('No <path> element found in this SVG file.');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const applySize = (w: string, h: string) => {
    const nw = Math.max(10, parseInt(w) || 400), nh = Math.max(10, parseInt(h) || 400);
    setCanvasW(nw); setCanvasH(nh);
    setCanvasInput({ w: String(nw), h: String(nh) });
  };

  const buildSVG = (animated: boolean): string | null => {
    if (nodes.length < 2) return null;
    const samps = samplePath(nodes, SEGMENTS);
    const totalLen = pathLength(samps);
    const n = samps.length - 1;
    if (!animated) {
      let segs = '';
      for (let i = 1; i <= n; i++) {
        const t0=(i-1)/n, t1=i/n;
        const c = lerpColor(gradientColor(stops, t0), gradientColor(stops, t1), 0.5);
        const p0=samps[i-1], p1=samps[i];
        segs += `\n    <line x1="${p0.x.toFixed(2)}" y1="${p0.y.toFixed(2)}" x2="${p1.x.toFixed(2)}" y2="${p1.y.toFixed(2)}" stroke="${c}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`;
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">\n  <g>${segs}\n  </g>\n</svg>`;
    }
    const easeFn = EASINGS_FN[animEasing] ?? EASINGS_FN['Ease In Out'];
    function invertEase(fn: (t: number) => number, target: number, iter = 20) {
      let lo = 0, hi = 1;
      for (let i = 0; i < iter; i++) { const mid = (lo+hi)/2; if (fn(mid) < target) lo = mid; else hi = mid; }
      return (lo+hi)/2;
    }
    let cumL = 0;
    const cumLengths = [0];
    for (let i = 1; i <= n; i++) {
      cumL += Math.hypot(samps[i].x-samps[i-1].x, samps[i].y-samps[i-1].y);
      cumLengths.push(cumL);
    }
    let animSegs = '';
    for (let i = 1; i <= n; i++) {
      const t0=(i-1)/n, t1=i/n;
      const c = lerpColor(gradientColor(stops, t0), gradientColor(stops, t1), 0.5);
      const p0=samps[i-1], p1=samps[i];
      const segFrac = animReverse
        ? (totalLen - cumLengths[i]) / totalLen
        : cumLengths[i-1] / totalLen;
      const rawT = invertEase(easeFn, segFrac);
      const beginTime = (rawT * animDuration).toFixed(3);
      animSegs += `\n  <line x1="${p0.x.toFixed(2)}" y1="${p0.y.toFixed(2)}" x2="${p1.x.toFixed(2)}" y2="${p1.y.toFixed(2)}" stroke="${c}" stroke-width="${strokeWidth}" stroke-linecap="round" visibility="hidden">\n    <set attributeName="visibility" to="visible" begin="${beginTime}s" fill="freeze"/>\n  </line>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">${animSegs}\n</svg>`;
  };

  const downloadSVG = (animated: boolean) => {
    const svg = buildSVG(animated);
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = animated ? 'path-animated.svg' : 'path-static.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearAll = () => { setNodes([]); setAnimProgress(1); setSelected(null); setAnimating(false); };

  const canExport = nodes.length >= 2;
  const selectedNode = selected?.type === 'anchor' ? nodes[selected.idx] : null;

  const hintText = mode === 'draw'
    ? 'Drag to draw — smooths on release'
    : mode === 'pan'
    ? 'Drag to move the entire path'
    : 'Drag anchors / handles · Click path to add point · Select anchor to edit or delete';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#ffffff' }}>

      {/* Toolbar */}
      <div style={{ height: 48, flexShrink: 0, background: '#ffffff', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 0 }}>
        {/* Left */}
        <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#111111', flex: 1 }}>
          Path Draw
        </span>
        {/* Centre — canvas size */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          <input
            className="input-text"
            value={canvasInput.w}
            onChange={e => setCanvasInput(p => ({ ...p, w: e.target.value }))}
            onBlur={() => applySize(canvasInput.w, canvasInput.h)}
            onKeyDown={e => e.key === 'Enter' && applySize(canvasInput.w, canvasInput.h)}
            placeholder="W"
            style={{ width: 56 }}
          />
          <span style={{ padding: '0 6px', color: '#aaaaaa', fontSize: 11, flexShrink: 0 }}>×</span>
          <input
            className="input-text"
            value={canvasInput.h}
            onChange={e => setCanvasInput(p => ({ ...p, h: e.target.value }))}
            onBlur={() => applySize(canvasInput.w, canvasInput.h)}
            onKeyDown={e => e.key === 'Enter' && applySize(canvasInput.w, canvasInput.h)}
            placeholder="H"
            style={{ width: 56 }}
          />
        </div>
        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
          {/* Mode */}
          <div style={{ display: 'flex' }}>
            {([['draw','Draw'],['edit','Edit'],['pan','Move']] as const).map(([key, lbl], i) => (
              <button
                key={key}
                className={`btn${mode === key ? ' active' : ''}`}
                onClick={() => setMode(key)}
                style={{ marginLeft: i > 0 ? -1 : 0, position: 'relative', zIndex: mode === key ? 1 : 0 }}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 20, background: '#e8e8e8', flexShrink: 0 }} />
          {/* Import */}
          <input ref={importRef} type="file" accept=".svg,image/svg+xml" onChange={handleImport} style={{ display: 'none' }} />
          <button className="btn" onClick={() => importRef.current?.click()}>Load SVG</button>
          {/* Clear */}
          {nodes.length > 0 && (
            <button className="btn" onClick={clearAll}>Clear</button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, background: '#f6f6f4', overflow: 'hidden', display: 'flex' }}>

        {/* Sidebar */}
        <div style={{ width: 220, flexShrink: 0, background: '#ffffff', borderRight: '1px solid #e8e8e8', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>


          {/* Anchor type (conditional) */}
          {mode === 'edit' && selectedNode && (
            <div style={divider}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <SectionLabel>Anchor</SectionLabel>
                <button className="btn" onClick={deleteSelected} style={{ fontSize: 10, padding: '3px 8px', borderColor: '#e8e8e8', color: '#888888' }}>
                  Delete
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {ANCHOR_TYPES.map((at, i) => (
                  <button
                    key={at.key}
                    className={`btn${selectedNode.type === at.key ? ' active' : ''}`}
                    onClick={() => setAnchorType(at.key)}
                    style={{ textAlign: 'left', padding: '6px 10px', marginTop: i > 0 ? -1 : 0, position: 'relative', zIndex: selectedNode.type === at.key ? 1 : 0 }}
                  >
                    <div style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 }}>{at.label}</div>
                    <div style={{ fontSize: 9, color: selectedNode.type === at.key ? 'rgba(255,255,255,0.6)' : '#aaaaaa', marginTop: 2, textTransform: 'none', letterSpacing: 0 }}>{at.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Line width */}
          <div style={divider}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <SectionLabel>Line Width</SectionLabel>
              <span style={{ fontSize: 11, color: '#111111', fontWeight: 500 }}>{strokeWidth}</span>
            </div>
            <input type="range" min={1} max={200} value={strokeWidth} onChange={e => setStrokeWidth(+e.target.value)} style={{ marginBottom: 10 }} />
            <div style={{ display: 'flex' }}>
              {[2, 12, 24, 60, 200].map((v, i) => (
                <button
                  key={v}
                  className={`btn${strokeWidth === v ? ' active' : ''}`}
                  onClick={() => setStrokeWidth(v)}
                  style={{ flex: 1, marginLeft: i > 0 ? -1 : 0, padding: '4px 0', position: 'relative', zIndex: strokeWidth === v ? 1 : 0 }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Gradient */}
          <div style={divider}>
            <SectionLabel>Gradient</SectionLabel>
            <div style={{ height: 3, marginBottom: 14, background: `linear-gradient(to right,${sortedStops.map(s => `${s.color} ${s.pos*100}%`).join(',')})` }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sortedStops.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="color" value={s.color} onChange={e => updateStop(s.id, 'color', e.target.value)} />
                  <input type="range" min={0} max={1} step={0.01} value={s.pos} onChange={e => updateStop(s.id, 'pos', +e.target.value)} style={{ flex: 1 }} />
                  <button
                    onClick={() => removeStop(s.id)}
                    style={{ width: 18, height: 18, border: '1px solid #e8e8e8', background: 'none', cursor: 'pointer', fontSize: 12, color: '#aaaaaa', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 1 }}
                  >×</button>
                </div>
              ))}
            </div>
            <button className="btn" onClick={addStop} style={{ width: '100%', marginTop: 10 }}>
              + Add Stop
            </button>
          </div>

          {/* Animation */}
          <div style={divider}>
            <SectionLabel>Animation</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 10, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>Duration</span>
              <input type="range" min={0.3} max={6} step={0.1} value={animDuration} onChange={e => setAnimDuration(+e.target.value)} style={{ flex: 1 }} />
              <span style={{ fontSize: 11, fontWeight: 500, color: '#111111', minWidth: 28, textAlign: 'right', flexShrink: 0 }}>{animDuration}s</span>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...label, marginBottom: 8 }}>Easing</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
                {Object.keys(EASINGS_FN).map((e, i) => (
                  <button
                    key={e}
                    className={`btn${animEasing === e ? ' active' : ''}`}
                    onClick={() => setAnimEasing(e)}
                    style={{ marginLeft: i > 0 ? -1 : 0, marginTop: i > 2 ? -1 : 0, position: 'relative', zIndex: animEasing === e ? 1 : 0, padding: '4px 8px', flex: '1 1 auto' }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 0 }}>
              <button
                className="btn"
                onClick={() => { setAnimating(false); setTimeout(() => setAnimating(true), 50); }}
                disabled={!canExport}
                style={{ flex: 1 }}
              >
                Preview
              </button>
              <button
                className={`btn${animReverse ? ' active' : ''}`}
                onClick={() => setAnimReverse(r => !r)}
                style={{ marginLeft: -1, padding: '5px 10px' }}
                title={animReverse ? 'Finish to start' : 'Start to finish'}
              >
                {animReverse ? '←' : '→'}
              </button>
            </div>
          </div>

          {/* Export */}
          <div style={{ ...divider, marginTop: 'auto', borderBottom: 'none' }}>
            <SectionLabel>Export</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <button className="btn" onClick={() => downloadSVG(false)} disabled={!canExport} style={{ width: '100%' }}>
                Static SVG
              </button>
              <button className="btn" onClick={() => downloadSVG(true)} disabled={!canExport} style={{ width: '100%', marginTop: -1 }}>
                Animated SVG
              </button>
            </div>
          </div>

        </div>

        {/* Canvas area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <div style={{ fontSize: 10, color: '#aaaaaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {hintText}
          </div>
          <div style={{ border: '1px solid #e8e8e8' }}>
            <canvas
              ref={canvasRef}
              width={canvasW}
              height={canvasH}
              style={{ display: 'block', maxWidth: 'calc(100vw - 260px)', maxHeight: 'calc(100vh - 120px)', cursor: mode === 'draw' ? 'crosshair' : mode === 'pan' ? 'grab' : 'default' }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              onTouchStart={onMouseDown}
              onTouchMove={onMouseMove}
              onTouchEnd={onMouseUp}
            />
          </div>
        </div>

      </div>


    </div>
  );
}
