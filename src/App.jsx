import { useEffect, useRef, useState } from 'react';
import { Engine } from './engine.js';
import { HudStore } from './ui/hudStore.js';
import { Hud } from './ui/Hud.jsx';
import { Menus } from './ui/Menus.jsx';

export default function App() {
  const canvasRef = useRef(null);
  const hudRef = useRef(null);
  if (!hudRef.current) hudRef.current = new HudStore();
  const [engine, setEngine] = useState(null);
  const [overlay, setOverlay] = useState({ type: 'menu' });

  useEffect(() => {
    const eng = new Engine(canvasRef.current, hudRef.current);
    eng.onUi = (payload) => {
      if (payload.type === 'hide') setOverlay(null);
      else setOverlay(payload);
    };
    setEngine(eng);
    return () => {
      eng.onUi = null;
    };
  }, []);

  const nav = (payload) => {
    if (payload.type === 'hide') setOverlay(null);
    else setOverlay(payload);
  };

  return (
    <>
      <canvas id="game" ref={canvasRef} />
      <div id="ui">
        <Hud store={hudRef.current} />
        <Menus engine={engine} overlay={engine ? overlay : null} nav={nav} />
      </div>
    </>
  );
}
