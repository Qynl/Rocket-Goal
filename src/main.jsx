import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './style.css';

// No StrictMode: the game engine owns a single rAF loop + WebGL context and
// must not be double-mounted in dev.
createRoot(document.getElementById('root')).render(<App />);
