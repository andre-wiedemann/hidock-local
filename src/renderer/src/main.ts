import './styles.css';
import { init } from './app.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => console.error('init failed:', err));
  });
} else {
  init().catch((err) => console.error('init failed:', err));
}
