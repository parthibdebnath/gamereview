import { useEffect, useRef } from 'react';
import type { Sensitivity } from '../core/config';
import { PRESETS, type PresetName } from '../engine/analyzer';
import type { EngineInfo } from '../engine/types';
import { canUseThreads, defaultThreads } from '../engine/workerEngine';
import { Icon } from './icons';
import { Tabs } from './parts';
import { BACKGROUNDS, BOARD_STYLES, DEFAULT_SETTINGS, normalizeHex, type BoardStyle, type Settings } from './settings';

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <div className="t">{title}</div>
        {desc && <div className="d">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function Slider(p: { title: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="slider-row">
      <span className="top">
        <span>{p.title}</span>
        <span>{p.format(p.value)}</span>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  );
}

const SENS: { id: Sensitivity; label: string }[] = [
  { id: 'strict', label: 'Strict' },
  { id: 'normal', label: 'Normal' },
  { id: 'generous', label: 'Generous' },
];

export function SettingsSheet({ settings, onChange, onClose, engine }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void; engine?: EngineInfo }) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const depth = settings.depth ?? PRESETS[settings.preset].depth;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const threadsOk = canUseThreads();

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={ref} role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Settings</h2>
          <button className="orb sm" aria-label="Close settings" onClick={onClose}>
            <Icon.close />
          </button>
        </header>

        <section>
          <h3>Analysis</h3>
          <Tabs<PresetName>
            label="Engine preset"
            items={[
              { id: 'fast', label: 'Fast' },
              { id: 'standard', label: 'Standard' },
              { id: 'deep', label: 'Deep' },
            ]}
            value={settings.preset}
            onChange={(v) => onChange({ ...settings, preset: v, depth: undefined, verify: undefined, multipv: PRESETS[v].multipv })}
          />
          <div className="label">Engine strength</div>
          <Tabs<'full' | 'lite'>
            label="Engine strength"
            items={[
              { id: 'full', label: 'Full net (strongest)' },
              { id: 'lite', label: 'Lite net (faster)' },
            ]}
            value={settings.engineNet}
            onChange={(v) => set('engineNet', v)}
          />
          <p className="note">
            The full net evaluates positions more accurately; it is a one-time 76 MB download (kept for offline use) and needs ~250 MB of memory per engine. Lite is 7 MB
            and quicker; the Fast preset always uses it.
          </p>
          <Slider title="Search depth" value={depth} min={8} max={24} step={1} format={(v) => `${v}`} onChange={(v) => set('depth', v)} />
          <Slider
            title="Double-check critical moves"
            value={settings.verify ?? PRESETS[settings.preset].verify ?? 0}
            min={0}
            max={8}
            step={2}
            format={(v) => (v ? `+${v} plies deeper` : 'off')}
            onChange={(v) => set('verify', v)}
          />
          <Row title="Engine lines" desc="Lines per position; 3 gives the most consistent judgments, 2 is faster.">
            <Tabs<string> label="Engine lines" items={[{ id: '2', label: '2' }, { id: '3', label: '3' }]} value={String(settings.multipv)} onChange={(v) => set('multipv', Number(v))} />
          </Row>
          <Row title="Adaptive depth" desc="Search book moves, forced replies and decided positions less deeply.">
            <Switch label="Adaptive depth" checked={settings.adaptive} onChange={(v) => set('adaptive', v)} />
          </Row>
          <Row title="One multi-threaded engine" desc={threadsOk ? 'Instead of several single-threaded engines working on different moves. Usually slower at fixed depth.' : 'Needs cross-origin isolation, which this page doesn’t have.'}>
            <Switch label="One multi-threaded engine" checked={settings.engineMode === 'threads' && threadsOk} onChange={(v) => set('engineMode', v && threadsOk ? 'threads' : 'pool')} />
          </Row>
          <Slider
            title={settings.engineMode === 'threads' && threadsOk ? 'Threads' : 'Parallel engines'}
            value={settings.threads || defaultThreads()}
            min={1}
            max={Math.max(2, Math.min(8, navigator.hardwareConcurrency || 2))}
            step={1}
            format={(v) => `${v}${settings.threads ? '' : ' (auto)'}`}
            onChange={(v) => set('threads', v)}
          />
          {engine && <p className="note">Engine: {engine.name}</p>}
        </section>
        <hr className="dotted" />

        <section>
          <h3>Classification</h3>
          <div className="label">Brilliant sensitivity</div>
          <Tabs<Sensitivity> label="Brilliant sensitivity" items={SENS} value={settings.brilliant} onChange={(v) => set('brilliant', v)} />
          <div className="label">Great sensitivity</div>
          <Tabs<Sensitivity> label="Great sensitivity" items={SENS} value={settings.great} onChange={(v) => set('great', v)} />
          <p className="note">Thresholds are the most a move may cost (in winning chances) to stay in a class.</p>
          {(['excellent', 'good', 'inaccuracy', 'mistake'] as const).map((k) => (
            <Slider
              key={k}
              title={k[0].toUpperCase() + k.slice(1)}
              value={settings.thresholds[k]}
              min={0.005}
              max={0.4}
              step={0.005}
              format={pct}
              onChange={(v) => onChange({ ...settings, thresholds: { ...settings.thresholds, [k]: v } })}
            />
          ))}
          <div>
            <button className="pill small" onClick={() => onChange({ ...settings, thresholds: DEFAULT_SETTINGS.thresholds, brilliant: 'normal', great: 'normal' })}>
              Reset classification
            </button>
          </div>
        </section>
        <hr className="dotted" />

        <section>
          <h3>Appearance</h3>
          <div className="label">Background</div>
          <div className="colors">
            {BACKGROUNDS.map((b) => (
              <button key={b.hex} aria-label={b.name} title={b.name} aria-pressed={normalizeHex(settings.background) === b.hex} style={{ background: b.hex }} onClick={() => set('background', b.hex)} />
            ))}
            <input
              className="field"
              style={{ width: 120, padding: '8px 10px' }}
              aria-label="Custom background colour (hex)"
              defaultValue={settings.background}
              onBlur={(e) => set('background', normalizeHex(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && set('background', normalizeHex((e.target as HTMLInputElement).value))}
            />
          </div>
          <Row title="Glass surfaces" desc="Frosted panels instead of outlines.">
            <Switch label="Glass surfaces" checked={settings.glass} onChange={(v) => set('glass', v)} />
          </Row>
          <div className="label">Board</div>
          <div className="boards">
            {(Object.keys(BOARD_STYLES) as BoardStyle[]).map((k) => (
              <button key={k} aria-pressed={settings.boardStyle === k} onClick={() => set('boardStyle', k)}>
                <span
                  className="mini"
                  style={{ background: `repeating-conic-gradient(${BOARD_STYLES[k].dark} 0 25%, ${BOARD_STYLES[k].light} 0 50%) 0 0 / 50% 50%` }}
                />
                {BOARD_STYLES[k].name}
              </button>
            ))}
          </div>
          <Row title="Coordinates">
            <Switch label="Coordinates" checked={settings.coords} onChange={(v) => set('coords', v)} />
          </Row>
          <Row title="Best-move arrows">
            <Switch label="Best-move arrows" checked={settings.arrows} onChange={(v) => set('arrows', v)} />
          </Row>
          <Row title="Threat arrows" desc="Show the opponent's punishing reply after mistakes.">
            <Switch label="Threat arrows" checked={settings.threats} onChange={(v) => set('threats', v)} />
          </Row>
          <Row title="Monochrome marks" desc="Classification marks without colour; their shapes still differ.">
            <Switch label="Monochrome marks" checked={settings.monoMarks} onChange={(v) => set('monoMarks', v)} />
          </Row>
        </section>
        <hr className="dotted" />

        <section>
          <h3>Online extras (optional)</h3>
          <p className="note">The review never needs the network. These features are off by default and only run when you use them.</p>
          <Row title="Online game lookup" desc="Find games by Lichess / Chess.com username, and import Lichess links.">
            <Switch label="Online game lookup" checked={settings.onlineImport} onChange={(v) => set('onlineImport', v)} />
          </Row>
          <Row title="Polish wording with an LLM" desc="Sends the move's verified facts (not your whole game) to an OpenAI-compatible endpoint you choose.">
            <Switch label="Polish wording with an LLM" checked={settings.llm.enabled} onChange={(v) => onChange({ ...settings, llm: { ...settings.llm, enabled: v } })} />
          </Row>
          {settings.llm.enabled && (
            <>
              <input className="field" placeholder="Endpoint, e.g. http://localhost:11434/v1/chat/completions" value={settings.llm.endpoint} onChange={(e) => onChange({ ...settings, llm: { ...settings.llm, endpoint: e.target.value } })} />
              <input className="field" placeholder="Model name" value={settings.llm.model} onChange={(e) => onChange({ ...settings, llm: { ...settings.llm, model: e.target.value } })} />
              <input className="field" type="password" placeholder="API key (optional, stored on this device)" value={settings.llm.apiKey} onChange={(e) => onChange({ ...settings, llm: { ...settings.llm, apiKey: e.target.value } })} />
            </>
          )}
        </section>
        <hr className="dotted" />

        <section>
          <h3>About</h3>
          <p className="legal">
            Hindsight is free software (GPL-3.0-or-later). Analysis by{' '}
            <a href="https://github.com/official-stockfish/Stockfish" target="_blank" rel="noreferrer">
              Stockfish
            </a>{' '}
            (GPLv3) compiled to WebAssembly by{' '}
            <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noreferrer">
              stockfish.js
            </a>
            . Opening names from the{' '}
            <a href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noreferrer">
              Lichess chess-openings
            </a>{' '}
            dataset (CC0). Board by chessground (GPLv3), pieces by Colin M.L. Burnett (GPLv2+). Rating model fitted on the open Lichess game database (CC0). Full
            notices in <code>LICENSES.md</code>; source is available at the project repository.
          </p>
          <div>
            <button className="pill small danger" onClick={() => onChange(DEFAULT_SETTINGS)}>
              Reset all settings
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
