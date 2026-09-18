import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Spec } from '@json-render/core';
import { canonicalUrl, pageSchema, searchSchema } from '../src/domain';
import { compilePage, compileSearch } from './catalog';
import { Navigation, WorldView } from './registry';
import './style.css';

function App() {
  const [route, setRoute] = useState(location.pathname + location.search);
  const [reload, setReload] = useState(0);
  const [input, setInput] = useState('');
  const [spec, setSpec] = useState<Spec | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('…');
  const [meta, setMeta] = useState('');
  const navigate = useCallback((href: string) => {
    if (!(href === '/' || href.startsWith('/view?') || href.startsWith('/search?'))) return;
    if (href === location.pathname + location.search) setReload(n => n + 1);
    else { history.pushState(null, '', href); setRoute(href); }
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const pop = () => { setRoute(location.pathname + location.search); setReload(n => n + 1); };
    addEventListener('popstate', pop);
    fetch('/api/health').then(r => r.json()).then(j => setMode(j.mode)).catch(() => setMode('unavailable'));
    return () => removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    const ac = new AbortController();
    const u = new URL(route, location.origin);
    const page = u.pathname === '/view';
    const q = u.searchParams.get(page ? 'url' : 'q') || '';
    setInput(q); setError(''); setSpec(null); setMeta('');
    if (u.pathname === '/') { setLoading(false); document.title = 'AgentWorld'; return; }
    setLoading(true);
    const data = page ? { url: q, from: u.searchParams.get('from') || '', ctx: u.searchParams.get('ctx') || '' } : { query: q };
    fetch(page ? '/api/page' : '/api/search', { method: 'POST', signal: ac.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(async response => { const j = await response.json(); if (!response.ok) throw new Error(j.error || 'Request failed'); return j; })
      .then(result => {
        if (ac.signal.aborted) return;
        const document = result.data;
        setSpec(page ? compilePage(pageSchema.parse(document)) : compileSearch(q,
          searchSchema.parse({ results: document.results, related: document.related })));
        setMode(result.mode);
        setMeta(`${result.cached ? 'Cached observation' : 'New observation'} · ${result.elapsedMs} ms · policy: ${document.policy.source} · generation: ${result.generation}`);
        window.document.title = `${page ? document.title : q} — AgentWorld`;
      })
      .catch(e => { if (!ac.signal.aborted) setError(e.message || 'Unable to materialize'); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [route, reload]);
  const submit = (e: FormEvent) => {
    e.preventDefault(); const value = input.trim(); if (!value) return;
    try {
      const isUrl = /^[a-z][a-z\d+.-]*:/i.test(value) || /^[^\s/]+\.[^\s/]+(?:\/[^\s]*)?$/.test(value);
      navigate(isUrl ? '/view?' + new URLSearchParams({ url: canonicalUrl(value) }) : '/search?' + new URLSearchParams({ q: value }));
    } catch { setError('Enter an http(s) address without credentials, or a search query.'); }
  };
  return <Navigation.Provider value={navigate}>
    <header className="chrome"><div className="topline"><button className="wordmark" onClick={() => navigate('/')}>◈ AgentWorld</button>
      <span className={`mode ${mode === 'mock' ? 'mock' : ''}`}>{mode === 'mock' ? 'MOCK · NO MODEL CALLS' : mode.toUpperCase()}</span></div>
      <div className="toolbar"><button title="Back" aria-label="Back" onClick={() => history.back()}>←</button>
        <button title="Forward" aria-label="Forward" onClick={() => history.forward()}>→</button>
        <button title="Reload" aria-label="Reload" onClick={() => setReload(n => n + 1)}>↻</button>
        <form onSubmit={submit}><label className="sr-only" htmlFor="address">Search or URL</label>
          <input id="address" autoComplete="off" value={input} onChange={e => setInput(e.target.value)} placeholder="Search the simulated internet, or enter a URL" maxLength={2048} />
          <button type="submit">Go</button></form></div></header>
    <div className="disclaimer">FICTIONAL INTERNET — generated observations, not real websites or verified facts.</div>
    <main>
      {route === '/' && <section className="welcome"><span className="eyebrow">JEV × JSON-RENDER × YOUR LLM</span>
        <h1>An internet that<br />materializes as you explore.</h1>
        <p>Search for anything. Open a result. Follow another link.<br />The world remembers every page you discover.</p>
        <div className="examples">{['deep sea exploration', 'history of computing', 'https://docs.rust-lang.org/book/'].map(q =>
          <button key={q} onClick={() => navigate((q.startsWith('https:') ? '/view?url=' : '/search?q=') + encodeURIComponent(q))}>{q} ↗</button>)}</div>
        <p className="footnote">Jev chooses the page policy. Your configured model writes structured content. json-render builds the interface.</p>
      </section>}
      {loading && <section className="status" role="status"><div className="spinner" /><h2>Materializing this observation…</h2><p>Policy → content generation → validation → rendering</p></section>}
      {error && <section className="status error" role="alert"><h2>This observation could not materialize.</h2><p>{error}</p><button onClick={() => setReload(n => n + 1)}>Retry</button></section>}
      {spec && <><div className="metadata">{meta}</div><WorldView spec={spec} /></>}
    </main>
    <footer className="app-footer">SIMULATED, NOT SCRAPED. · Local links only. · No generated scripts.</footer>
  </Navigation.Provider>;
}
createRoot(document.getElementById('root')!).render(<App />);
