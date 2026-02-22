import { render } from 'preact';
import { App } from './App';

// Set theme before first render to prevent flash
const theme = localStorage.getItem('xtil-theme') || localStorage.getItem('tldr-theme') || 'system';
const resolved = theme === 'system'
  ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  : theme;
document.documentElement.setAttribute('data-theme', resolved);

render(<App />, document.getElementById('app')!);
